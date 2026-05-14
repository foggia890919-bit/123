import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, safeParseInt } from "@/lib/auth-guard";
import { BUCKETS, storageEnabled, newStorageKey, deleteObject } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const CORP_DEALER_TYPES = ["CORPORATION", "UPPER_CORP", "LOWER_CORP", "SELF"] as const;

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

async function uploadFileToStorage(file: File, prefix: string): Promise<{ fileKey: string; error?: string }> {
  if (!storageEnabled()) {
    return { fileKey: "", error: "STORAGE_DISABLED" };
  }
  const ext = file.name.split(".").pop() ?? "bin";
  const key = newStorageKey(prefix, ext);
  const buf = await file.arrayBuffer();
  const url = `${process.env.SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1/object/${BUCKETS.bizRateFile}/${encodeURI(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: new Uint8Array(buf),
  });
  if (!res.ok) {
    return { fileKey: "", error: `STORAGE_ERROR:${res.status}` };
  }
  return { fileKey: key };
}

// GET /api/biz-rates?corpClientId&companyName&applyMonth&page&limit
export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const corpClientId = sp.get("corpClientId") ?? undefined;
  const companyName = sp.get("companyName") ?? undefined;
  const applyMonth = sp.get("applyMonth") ?? undefined;
  const page = safeParseInt(sp.get("page"), 1, 1);
  const limit = safeParseInt(sp.get("limit"), 20, 1, 100);
  const skip = (page - 1) * limit;

  const where = {
    ...(corpClientId ? { corpClientId } : {}),
    ...(companyName ? { companyName: { contains: companyName, mode: "insensitive" as const } } : {}),
    ...(applyMonth ? { applyMonth } : {}),
    corpClient: { dealerType: { in: [...CORP_DEALER_TYPES] } },
  };

  const [total, items] = await Promise.all([
    prisma.corpRateFile.count({ where }),
    prisma.corpRateFile.findMany({
      where,
      orderBy: [{ applyMonth: "desc" }, { companyName: "asc" }],
      skip,
      take: limit,
      select: {
        id: true,
        corpClientId: true,
        companyName: true,
        applyMonth: true,
        fileName: true,
        fileKey: true,
        columnMap: true,
        createdAt: true,
        updatedAt: true,
        corpClient: { select: { clientName: true } },
        uploadedBy: { select: { name: true } },
      },
    }),
  ]);

  return NextResponse.json({ total, page, limit, items });
}

// POST /api/biz-rates  — multipart/form-data: file, corpClientId, companyName, applyMonth
export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const corpClientId = (formData.get("corpClientId") as string | null)?.trim();
  // 신규 플로우에서는 제약사가 파일 내 컬럼으로 들어오므로 companyName은 선택값
  const companyName = (formData.get("companyName") as string | null)?.trim() ?? "";
  const applyMonth = (formData.get("applyMonth") as string | null)?.trim();

  if (!file || !corpClientId || !applyMonth) {
    return NextResponse.json({ error: "file, corpClientId, applyMonth 필수" }, { status: 400 });
  }

  const MAX_BYTES = 50 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });
  }

  const corpClient = await prisma.userClient.findUnique({
    where: { id: corpClientId },
    select: { id: true, dealerType: true },
  });
  if (!corpClient || !corpClient.dealerType || !CORP_DEALER_TYPES.includes(corpClient.dealerType as typeof CORP_DEALER_TYPES[number])) {
    return NextResponse.json({ error: "INVALID_CORP_CLIENT" }, { status: 400 });
  }

  const uploadResult = await uploadFileToStorage(file, `corp-rates/${corpClientId}`);
  if (uploadResult.error) {
    return NextResponse.json({ error: uploadResult.error }, { status: 500 });
  }
  const newFileKey = uploadResult.fileKey;
  const newFileName = file.name;

  const existing = await prisma.corpRateFile.findUnique({
    where: { corpClientId_companyName_applyMonth: { corpClientId, companyName, applyMonth } },
    select: { id: true, fileKey: true, fileName: true },
  });

  let result;
  if (existing) {
    const prevFileKey = existing.fileKey;
    const prevFileName = existing.fileName;
    result = await prisma.$transaction(async (tx) => {
      const updated = await tx.corpRateFile.update({
        where: { id: existing.id },
        data: { fileName: newFileName, fileKey: newFileKey, uploadedById: user.id },
      });
      await tx.corpRateFileHistory.create({
        data: {
          id: crypto.randomUUID(),
          rateFileId: existing.id,
          corpClientId,
          companyName,
          applyMonth,
          action: "REPLACE",
          prevFileKey,
          prevFileName,
          newFileKey,
          newFileName,
          performedById: user.id,
        },
      });
      return updated;
    });
    // best-effort old file deletion
    try {
      await deleteObject(BUCKETS.bizRateFile, prevFileKey);
    } catch {
      console.warn("[biz-rates] old file delete failed", prevFileKey);
    }
  } else {
    result = await prisma.$transaction(async (tx) => {
      const created = await tx.corpRateFile.create({
        data: {
          id: crypto.randomUUID(),
          corpClientId,
          companyName,
          applyMonth,
          fileName: newFileName,
          fileKey: newFileKey,
          uploadedById: user.id,
        },
      });
      await tx.corpRateFileHistory.create({
        data: {
          id: crypto.randomUUID(),
          rateFileId: created.id,
          corpClientId,
          companyName,
          applyMonth,
          action: "UPLOAD",
          newFileKey,
          newFileName,
          performedById: user.id,
        },
      });
      return created;
    });
  }

  return NextResponse.json(result, { status: existing ? 200 : 201 });
}
