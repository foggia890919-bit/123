import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri, storageEnabled } from "@/lib/storage";

export const maxDuration = 300;

// Move rows that still carry base64 blobs into Supabase Storage.
// Process a bounded batch per call so long runs are chunked; the admin can click again to continue.
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  if (!storageEnabled()) {
    return NextResponse.json(
      { error: "STORAGE_DISABLED", message: "SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았어요." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const batch = Math.min(Math.max(parseInt(body?.batch ?? "50") || 50, 1), 200);

  const result = {
    userDocuments: { migrated: 0, failed: 0, remaining: 0 },
    userClients: { migrated: 0, failed: 0, remaining: 0 },
    filterRequests: { migrated: 0, failed: 0, remaining: 0 },
    prescriptionReports: { migrated: 0, failed: 0, remaining: 0 },
  };

  // UserDocument
  {
    const rows = await prisma.userDocument.findMany({
      where: { fileKey: null, fileData: { not: null } },
      select: { id: true, userId: true, fileData: true },
      take: batch,
    });
    for (const row of rows) {
      if (!row.fileData) continue;
      const r = await persistDataUri(BUCKETS.userDocument, row.userId, row.fileData);
      if (r.fileKey) {
        await prisma.userDocument.update({ where: { id: row.id }, data: { fileKey: r.fileKey, fileData: null } });
        result.userDocuments.migrated++;
      } else {
        result.userDocuments.failed++;
      }
    }
    result.userDocuments.remaining = await prisma.userDocument.count({
      where: { fileKey: null, fileData: { not: null } },
    });
  }

  // UserClient
  {
    const rows = await prisma.userClient.findMany({
      where: { bizFileKey: null, bizDocument: { not: null } },
      select: { id: true, userId: true, bizDocument: true },
      take: batch,
    });
    for (const row of rows) {
      if (!row.bizDocument) continue;
      const r = await persistDataUri(BUCKETS.userClientBiz, row.userId, row.bizDocument);
      if (r.fileKey) {
        await prisma.userClient.update({ where: { id: row.id }, data: { bizFileKey: r.fileKey, bizDocument: null } });
        result.userClients.migrated++;
      } else {
        result.userClients.failed++;
      }
    }
    result.userClients.remaining = await prisma.userClient.count({
      where: { bizFileKey: null, bizDocument: { not: null } },
    });
  }

  // FilterRequest
  {
    const rows = await prisma.filterRequest.findMany({
      where: { bizFileKey: null, bizDocument: { not: null } },
      select: { id: true, userId: true, bizDocument: true },
      take: batch,
    });
    for (const row of rows) {
      if (!row.bizDocument) continue;
      const r = await persistDataUri(BUCKETS.filterRequestBiz, row.userId, row.bizDocument);
      if (r.fileKey) {
        await prisma.filterRequest.update({ where: { id: row.id }, data: { bizFileKey: r.fileKey, bizDocument: null } });
        result.filterRequests.migrated++;
      } else {
        result.filterRequests.failed++;
      }
    }
    result.filterRequests.remaining = await prisma.filterRequest.count({
      where: { bizFileKey: null, bizDocument: { not: null } },
    });
  }

  // PrescriptionReport
  {
    const rows = await prisma.prescriptionReport.findMany({
      where: { imageKey: null, imageData: { not: null } },
      select: { id: true, userId: true, imageData: true },
      take: batch,
    });
    for (const row of rows) {
      if (!row.imageData) continue;
      const r = await persistDataUri(BUCKETS.prescriptionImage, row.userId, row.imageData);
      if (r.fileKey) {
        await prisma.prescriptionReport.update({ where: { id: row.id }, data: { imageKey: r.fileKey, imageData: null } });
        result.prescriptionReports.migrated++;
      } else {
        result.prescriptionReports.failed++;
      }
    }
    result.prescriptionReports.remaining = await prisma.prescriptionReport.count({
      where: { imageKey: null, imageData: { not: null } },
    });
  }

  const totalRemaining =
    result.userDocuments.remaining +
    result.userClients.remaining +
    result.filterRequests.remaining +
    result.prescriptionReports.remaining;

  return NextResponse.json({ ok: true, batch, totalRemaining, ...result });
}

// Status-only GET for the admin UI
export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const [ud, uc, fr, pr] = await Promise.all([
    prisma.userDocument.count({ where: { fileKey: null, fileData: { not: null } } }),
    prisma.userClient.count({ where: { bizFileKey: null, bizDocument: { not: null } } }),
    prisma.filterRequest.count({ where: { bizFileKey: null, bizDocument: { not: null } } }),
    prisma.prescriptionReport.count({ where: { imageKey: null, imageData: { not: null } } }),
  ]);

  return NextResponse.json({
    storageEnabled: storageEnabled(),
    remaining: { userDocuments: ud, userClients: uc, filterRequests: fr, prescriptionReports: pr },
    totalRemaining: ud + uc + fr + pr,
  });
}
