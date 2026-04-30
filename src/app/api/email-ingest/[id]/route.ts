import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, storageEnabled, newStorageKey } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

type Params = { params: Promise<{ id: string }> };

// GET /api/email-ingest/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  const email = await prisma.incomingEmail.findUnique({
    where: { id },
    include: {
      attachments: true,
      processedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!email) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json(email);
}

// PATCH /api/email-ingest/[id]
// Body: { classifiedAs?, mappedCorpId?, mappedCompanyName?, applyMonth?, status? }
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;

  const email = await prisma.incomingEmail.findUnique({ where: { id } });
  if (!email) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = (await req.json()) as {
    classifiedAs?: string | null;
    mappedCorpId?: string | null;
    mappedCompanyName?: string | null;
    applyMonth?: string | null;
    status?: string;
  };

  const allowedStatuses = ["PENDING", "CLASSIFIED", "PROCESSED", "FAILED", "IGNORED"];
  if (body.status && !allowedStatuses.includes(body.status)) {
    return NextResponse.json({ error: "INVALID_STATUS" }, { status: 400 });
  }

  const updated = await prisma.incomingEmail.update({
    where: { id },
    data: {
      ...(body.classifiedAs !== undefined ? { classifiedAs: body.classifiedAs } : {}),
      ...(body.mappedCorpId !== undefined ? { mappedCorpId: body.mappedCorpId } : {}),
      ...(body.mappedCompanyName !== undefined ? { mappedCompanyName: body.mappedCompanyName } : {}),
      ...(body.applyMonth !== undefined ? { applyMonth: body.applyMonth } : {}),
      ...(body.status ? { status: body.status } : {}),
      // Promote to CLASSIFIED if classification fields are supplied without explicit status
      ...(body.classifiedAs && !body.status && email.status === "PENDING"
        ? { status: "CLASSIFIED" }
        : {}),
    },
    include: { attachments: true },
  });

  return NextResponse.json(updated);
}

// POST /api/email-ingest/[id]
// Body: { processAction: "process_rate" | "process_settlement" }
export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  const email = await prisma.incomingEmail.findUnique({
    where: { id },
    include: { attachments: true },
  });
  if (!email) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const body = (await req.json()) as { processAction?: string };
  const action = body.processAction;

  if (action !== "process_rate" && action !== "process_settlement") {
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  }

  if (!email.mappedCorpId || !email.classifiedAs || !email.applyMonth) {
    return NextResponse.json(
      { error: "MISSING_CLASSIFICATION: mappedCorpId, classifiedAs, applyMonth 모두 필요" },
      { status: 422 }
    );
  }

  if (email.attachments.length === 0) {
    return NextResponse.json({ error: "NO_ATTACHMENTS" }, { status: 422 });
  }

  const firstAtt = email.attachments[0];

  try {
    if (action === "process_rate") {
      // Copy attachment to biz-rate-files bucket
      let newFileKey = firstAtt.fileKey;

      if (storageEnabled()) {
        const ext = firstAtt.fileName.split(".").pop() ?? "bin";
        newFileKey = newStorageKey(`corp-rates/${email.mappedCorpId}`, ext);

        const srcUrl = `${process.env.SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1/object/${BUCKETS.incomingEmail}/${encodeURI(firstAtt.fileKey)}`;
        const dstUrl = `${process.env.SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1/object/${BUCKETS.bizRateFile}/${encodeURI(newFileKey)}`;

        const srcRes = await fetch(srcUrl, {
          headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}` },
        });
        if (!srcRes.ok) {
          throw new Error(`SOURCE_FETCH_FAILED:${srcRes.status}`);
        }
        const buf = await srcRes.arrayBuffer();
        const dstRes = await fetch(dstUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            "Content-Type": firstAtt.mimeType || "application/octet-stream",
            "x-upsert": "true",
          },
          body: new Uint8Array(buf),
        });
        if (!dstRes.ok) {
          throw new Error(`DST_UPLOAD_FAILED:${dstRes.status}`);
        }
      }

      const corpClient = await prisma.userClient.findUnique({
        where: { id: email.mappedCorpId },
        select: { id: true },
      });
      if (!corpClient) throw new Error("CORP_CLIENT_NOT_FOUND");

      const companyName = email.mappedCompanyName ?? "알 수 없음";
      const applyMonth = email.applyMonth!;

      const existingRate = await prisma.corpRateFile.findUnique({
        where: {
          corpClientId_companyName_applyMonth: {
            corpClientId: email.mappedCorpId,
            companyName,
            applyMonth,
          },
        },
        select: { id: true, fileKey: true, fileName: true },
      });

      let rateFile;
      await prisma.$transaction(async (tx) => {
        if (existingRate) {
          rateFile = await tx.corpRateFile.update({
            where: { id: existingRate.id },
            data: { fileName: firstAtt.fileName, fileKey: newFileKey, uploadedById: user.id },
          });
          await tx.corpRateFileHistory.create({
            data: {
              id: crypto.randomUUID(),
              rateFileId: existingRate.id,
              corpClientId: email.mappedCorpId!,
              companyName,
              applyMonth,
              action: "REPLACE",
              prevFileKey: existingRate.fileKey,
              prevFileName: existingRate.fileName,
              newFileKey,
              newFileName: firstAtt.fileName,
              performedById: user.id,
            },
          });
        } else {
          const newId = crypto.randomUUID();
          rateFile = await tx.corpRateFile.create({
            data: {
              id: newId,
              corpClientId: email.mappedCorpId!,
              companyName,
              applyMonth,
              fileName: firstAtt.fileName,
              fileKey: newFileKey,
              uploadedById: user.id,
            },
          });
          await tx.corpRateFileHistory.create({
            data: {
              id: crypto.randomUUID(),
              rateFileId: newId,
              corpClientId: email.mappedCorpId!,
              companyName,
              applyMonth,
              action: "UPLOAD",
              newFileKey,
              newFileName: firstAtt.fileName,
              performedById: user.id,
            },
          });
        }

        await tx.incomingEmail.update({
          where: { id },
          data: {
            status: "PROCESSED",
            processedAt: new Date(),
            processedById: user.id,
            rateFileId: (rateFile as { id: string }).id,
          },
        });
      });

      return NextResponse.json({ ok: true, action, rateFileId: (rateFile as { id: string }).id });
    }

    if (action === "process_settlement") {
      // Copy attachment to settlement-documents bucket
      let newFileKey = firstAtt.fileKey;

      if (storageEnabled()) {
        const ext = firstAtt.fileName.split(".").pop() ?? "bin";
        newFileKey = newStorageKey(`settlement/${email.mappedCorpId}`, ext);

        const srcUrl = `${process.env.SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1/object/${BUCKETS.incomingEmail}/${encodeURI(firstAtt.fileKey)}`;
        const dstUrl = `${process.env.SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1/object/${BUCKETS.settlementDocument}/${encodeURI(newFileKey)}`;

        const srcRes = await fetch(srcUrl, {
          headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}` },
        });
        if (!srcRes.ok) throw new Error(`SOURCE_FETCH_FAILED:${srcRes.status}`);
        const buf = await srcRes.arrayBuffer();
        const dstRes = await fetch(dstUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            "Content-Type": firstAtt.mimeType || "application/octet-stream",
            "x-upsert": "true",
          },
          body: new Uint8Array(buf),
        });
        if (!dstRes.ok) throw new Error(`DST_UPLOAD_FAILED:${dstRes.status}`);
      }

      const corpName = email.mappedCompanyName ?? "알 수 없음";

      let settlementDoc;
      await prisma.$transaction(async (tx) => {
        const newDocId = crypto.randomUUID();
        settlementDoc = await tx.settlementDocument.create({
          data: {
            id: newDocId,
            userId: user.id,
            corpName,
            fileKey: newFileKey,
            fileName: firstAtt.fileName,
            period: email.applyMonth!,
            status: "PENDING",
          },
        });

        await tx.incomingEmail.update({
          where: { id },
          data: {
            status: "PROCESSED",
            processedAt: new Date(),
            processedById: user.id,
            settlementDocId: newDocId,
          },
        });
      });

      return NextResponse.json({
        ok: true,
        action,
        settlementDocId: (settlementDoc as { id: string }).id,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.incomingEmail.update({
      where: { id },
      data: { status: "FAILED", errorMessage: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ error: "UNEXPECTED" }, { status: 500 });
}

// DELETE /api/email-ingest/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  const email = await prisma.incomingEmail.findUnique({
    where: { id },
    include: { attachments: { select: { fileKey: true } } },
  });
  if (!email) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.incomingEmail.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
