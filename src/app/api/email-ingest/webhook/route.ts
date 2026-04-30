import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BUCKETS, storageEnabled, newStorageKey, extensionFromMime } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MB

interface AttachmentPayload {
  fileName: string;
  mimeType: string;
  size: number;
  base64: string;
}

interface WebhookPayload {
  messageId: string;
  fromAddress: string;
  fromName?: string | null;
  subject: string;
  bodyPreview?: string | null;
  receivedAt: string;
  attachments?: AttachmentPayload[];
}

async function uploadBase64ToStorage(
  base64: string,
  mimeType: string,
  prefix: string
): Promise<{ fileKey: string; error?: string }> {
  if (!storageEnabled()) {
    return { fileKey: "", error: "STORAGE_DISABLED" };
  }
  const ext = extensionFromMime(mimeType);
  const key = newStorageKey(prefix, ext);
  const buf = Buffer.from(base64, "base64");

  const url = `${process.env.SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1/object/${BUCKETS.incomingEmail}/${encodeURI(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      "Content-Type": mimeType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: new Uint8Array(buf),
  });
  if (!res.ok) {
    return { fileKey: "", error: `STORAGE_ERROR:${res.status}` };
  }
  return { fileKey: key };
}

// Look up EmailSenderMapping for a given fromAddress.
// Checks EXACT match first, then DOMAIN match (stored as "*.domain.com" or "domain.com").
async function findSenderMapping(fromAddress: string) {
  const exact = await prisma.emailSenderMapping.findFirst({
    where: { fromAddress, matchType: "EXACT", active: true },
  });
  if (exact) return exact;

  const domain = fromAddress.split("@")[1];
  if (!domain) return null;

  const domainMapping = await prisma.emailSenderMapping.findFirst({
    where: {
      fromAddress: { in: [domain, `*.${domain}`] },
      matchType: "DOMAIN",
      active: true,
    },
  });
  return domainMapping;
}

// POST /api/email-ingest/webhook
export async function POST(req: NextRequest) {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 401 });
  }

  const incoming = req.headers.get("x-webhook-secret");
  if (incoming !== secret) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: WebhookPayload;
  try {
    body = (await req.json()) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const { messageId, fromAddress, fromName, subject, bodyPreview, receivedAt, attachments = [] } = body;

  if (!messageId || !fromAddress || !subject || !receivedAt) {
    return NextResponse.json({ error: "MISSING_REQUIRED_FIELDS" }, { status: 400 });
  }

  // Idempotency: already processed?
  const existing = await prisma.incomingEmail.findUnique({ where: { messageId } });
  if (existing) {
    return NextResponse.json({ ok: true, emailId: existing.id, duplicate: true });
  }

  // Upload attachments to storage
  const savedAttachments: { fileName: string; mimeType: string; size: number; fileKey: string }[] = [];

  for (const att of attachments) {
    if (att.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `ATTACHMENT_TOO_LARGE: ${att.fileName}` },
        { status: 400 }
      );
    }
    const { fileKey, error } = await uploadBase64ToStorage(
      att.base64,
      att.mimeType,
      `emails/${new Date().toISOString().slice(0, 7)}`
    );
    if (error) {
      return NextResponse.json({ error: `UPLOAD_FAILED: ${error}` }, { status: 500 });
    }
    savedAttachments.push({ fileName: att.fileName, mimeType: att.mimeType, size: att.size, fileKey });
  }

  // Auto-classify via sender mapping
  const mapping = await findSenderMapping(fromAddress);

  const status = mapping ? "CLASSIFIED" : "PENDING";
  const classifiedAs = mapping?.defaultClassification ?? null;
  const mappedCorpId = mapping?.corpClientId ?? null;

  let mappedCompanyName: string | null = null;
  if (mappedCorpId) {
    const corpClient = await prisma.userClient.findUnique({
      where: { id: mappedCorpId },
      select: { clientName: true },
    });
    mappedCompanyName = corpClient?.clientName ?? null;
  }

  const emailId = crypto.randomUUID();

  await prisma.$transaction(async (tx) => {
    await tx.incomingEmail.create({
      data: {
        id: emailId,
        messageId,
        fromAddress,
        fromName: fromName ?? null,
        subject,
        bodyPreview: bodyPreview?.slice(0, 500) ?? null,
        receivedAt: new Date(receivedAt),
        status,
        classifiedAs,
        mappedCorpId,
        mappedCompanyName,
      },
    });

    if (savedAttachments.length > 0) {
      await tx.emailAttachment.createMany({
        data: savedAttachments.map((a) => ({
          id: crypto.randomUUID(),
          emailId,
          fileName: a.fileName,
          mimeType: a.mimeType,
          size: a.size,
          fileKey: a.fileKey,
        })),
      });
    }
  });

  return NextResponse.json({ ok: true, emailId });
}
