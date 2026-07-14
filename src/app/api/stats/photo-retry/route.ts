import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, downloadAsDataUri, parseDataUri } from "@/lib/storage";
import { processRxPhoto } from "@/lib/process-rx-photo";

// 처방통계 사진 재분석 — Gemini 처리 실패(ERROR) 또는 단순 재실행 요청 시.
// reportId 로 기존 사진 가져와서 processRxPhoto helper 재호출.
//
// POST /api/stats/photo-retry  body: { reportId }
// 권한: report.userId 본인 또는 ADMIN/BIZ.
// status → "PROCESSING" 으로 즉시 reset 후 after() 백그라운드 분석.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  let body: { reportId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }
  const reportId = body.reportId;
  if (!reportId) return NextResponse.json({ error: "reportId 필수" }, { status: 400 });

  const report = await prisma.prescriptionReport.findUnique({
    where: { id: reportId },
    select: {
      id: true, userId: true, hospitalName: true, status: true,
      imageKey: true, imageData: true, ocrData: true,
      client: { select: { clientName: true } },
    },
  });
  if (!report) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && user.role !== "BIZ" && report.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // 이미지 가져오기 — Storage 우선, 없으면 DB 의 imageData fallback
  let dataUri: string | null = null;
  if (report.imageKey) {
    dataUri = await downloadAsDataUri(BUCKETS.prescriptionImage, report.imageKey).catch(() => null);
  }
  if (!dataUri && report.imageData) {
    dataUri = report.imageData;
  }
  if (!dataUri) {
    return NextResponse.json({ error: "원본 이미지를 찾을 수 없어요. 사진을 다시 업로드해주세요." }, { status: 410 });
  }
  const parsed = parseDataUri(dataUri);
  if (!parsed) {
    return NextResponse.json({ error: "이미지 데이터 파싱 실패" }, { status: 500 });
  }
  const base64 = parsed.data.toString("base64");
  const mimeType = parsed.contentType;

  // status 즉시 PROCESSING 으로 reset + 옛 에러/결과 지우기 (imageHash 등 메타는 보존)
  const baseOcr = (report.ocrData ?? {}) as Record<string, unknown>;
  await prisma.prescriptionReport.update({
    where: { id: report.id },
    data: {
      status: "PROCESSING",
      ocrData: {
        source: baseOcr.source ?? "gemini-direct-photo-auto",
        imageHash: baseOcr.imageHash ?? null,
        fileName: baseOcr.fileName ?? null,
        processingStartedAt: new Date().toISOString(),
        retriedAt: new Date().toISOString(),
        retryCount: ((baseOcr.retryCount as number | undefined) ?? 0) + 1,
      },
      updatedAt: new Date(),
    },
  });

  // 백그라운드 재분석
  const fileName = (baseOcr.fileName as string | undefined) ?? `retry-${report.id}.jpg`;
  const clientName = report.client?.clientName ?? report.hospitalName ?? "";
  after(() => processRxPhoto({
    reportId: report.id,
    base64,
    mimeType,
    userId: report.userId,
    clientName,
    fileName,
  }));

  return NextResponse.json({ ok: true, reportId: report.id, status: "processing" });
}
