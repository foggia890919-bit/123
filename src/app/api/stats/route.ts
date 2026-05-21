import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri, deleteObject } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  // ?yearMonth=2026-04&clientId=xxx  → 특정 거래처+월 조회
  // ?yearMonth=2026-04               → 해당 월 전체 (거래처별 최신 1건씩)
  // (파라미터 없음)                   → 전체 목록
  const yearMonthParam = req.nextUrl.searchParams.get("yearMonth");
  const clientIdParam  = req.nextUrl.searchParams.get("clientId");

  const yearInt  = yearMonthParam ? parseInt(yearMonthParam.split("-")[0] ?? "") : null;
  const monthInt = yearMonthParam ? parseInt(yearMonthParam.split("-")[1] ?? "") : null;

  const where: Prisma.PrescriptionReportWhereInput = {
    userId: user.id,
    ...(yearInt  && { year: yearInt }),
    ...(monthInt && { month: monthInt }),
    ...(clientIdParam && { clientId: clientIdParam }),
  };

  // Exclude heavy imageData from list responses — fetch individual image via /api/files/prescription-report/[id]
  try {
    const reports = await prisma.prescriptionReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, userId: true, clientId: true, year: true, month: true,
        hospitalName: true, companyName: true, ocrData: true, status: true,
        totalFee: true, clientApprovedAtSave: true, createdAt: true, updatedAt: true,
        imageKey: true,
        client: { select: { id: true, clientName: true, bizNumber: true, approved: true } },
      },
    });
    return NextResponse.json(reports.map((r) => ({ ...r, imageData: null, hasImage: !!r.imageKey })));
  } catch {
    const reports = await prisma.prescriptionReport.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, userId: true, clientId: true, year: true, month: true,
        hospitalName: true, companyName: true, ocrData: true, status: true,
        totalFee: true, clientApprovedAtSave: true, createdAt: true, updatedAt: true,
        imageKey: true,
      },
    });
    return NextResponse.json(reports.map((r) => ({ ...r, imageData: null, hasImage: !!r.imageKey })));
  }
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  try {
    const body = await req.json();
    const { clientId, year, month, hospitalName, companyName, imageData, ocrData, totalFee } = body;
    if (!year || !month) return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });

    let clientApprovedAtSave = false;
    if (clientId) {
      const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { approved: true, userId: true } });
      if (client && user.role !== "ADMIN" && client.userId !== user.id) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      clientApprovedAtSave = client?.approved ?? false;
    }

    const { fileKey: imageKey, fileData: imageDataFallback } =
      await persistDataUri(BUCKETS.prescriptionImage, user.id, imageData);

    const report = await prisma.prescriptionReport.create({
      data: {
        userId: user.id,
        clientId: clientId || null,
        year,
        month,
        hospitalName,
        companyName,
        imageData: imageDataFallback,
        imageKey,
        ocrData,
        totalFee,
        clientApprovedAtSave,
        updatedAt: new Date(),
      },
    });
    return NextResponse.json({ ...report, imageData: null });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  try {
    const { id, status, ocrData, totalFee, clientId } = await req.json();
    if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

    const existing = await prisma.prescriptionReport.findUnique({ where: { id }, select: { userId: true } });
    if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (user.role !== "ADMIN" && existing.userId !== user.id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    let clientApprovedAtSave: boolean | undefined;
    if (clientId !== undefined) {
      if (clientId) {
        const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { approved: true, userId: true } });
        if (client && user.role !== "ADMIN" && client.userId !== user.id) {
          return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
        }
        clientApprovedAtSave = client?.approved ?? false;
      } else {
        clientApprovedAtSave = false;
      }
    }

    const report = await prisma.prescriptionReport.update({
      where: { id },
      data: {
        status,
        ocrData,
        totalFee,
        ...(clientId !== undefined && { clientId: clientId || null }),
        ...(clientApprovedAtSave !== undefined && { clientApprovedAtSave }),
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });
  const existing = await prisma.prescriptionReport.findUnique({
    where: { id },
    select: { userId: true, imageKey: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && existing.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  // 제출완료 상태인 행은 ADMIN 만 삭제 가능 — 데이터 안정성 보호
  if (existing.status === "SUBMITTED" && user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "이미 제출완료된 행입니다. 관리자에게 문의하세요." },
      { status: 409 },
    );
  }
  // 1) Storage 파일 먼저 삭제 — 실패해도 DB 는 진행 (storage 가비지는 별도 cleanup 가능)
  if (existing.imageKey) {
    try {
      await deleteObject(BUCKETS.prescriptionImage, existing.imageKey);
    } catch (e) {
      console.error("[stats DELETE storage]", id, String(e).slice(0, 200));
    }
  }
  await prisma.prescriptionReport.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

// 거래처×월 단위 제출완료 마킹 — 그 그룹의 모든 row status 를 SUBMITTED 로 일괄 변경.
// 이후 같은 거래처×월에 새 업로드 차단.
export async function PUT(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const body = await req.json() as { clientId?: string; year?: number; month?: number; action?: "submit" | "reopen" };
  const { clientId, year, month, action } = body;
  if (!clientId || !year || !month || !action) {
    return NextResponse.json({ error: "clientId/year/month/action 필수" }, { status: 400 });
  }

  // 권한: 본인 거래처거나 ADMIN
  const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { userId: true } });
  if (!client) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && client.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const newStatus = action === "submit" ? "SUBMITTED" : "PENDING_REVIEW";
  const result = await prisma.prescriptionReport.updateMany({
    where: {
      clientId,
      year,
      month,
      ...(user.role !== "ADMIN" ? { userId: user.id } : {}),
    },
    data: { status: newStatus, updatedAt: new Date() },
  });

  return NextResponse.json({ updated: result.count, status: newStatus });
}

// 거래처×월 제출 상태 조회 — 업로드 페이지가 차단 여부 판단용.
// GET /api/stats/submission?clientId=X&year=Y&month=M
// 응답: { submitted: boolean, rowCount: number, photoCount: number, latestAt: string | null }
//
// 이 핸들러를 별도 라우트로 만들 수도 있지만 stats/route.ts 에 inline 두는 게 코드 간결.
// 호출: POST /api/stats 와 충돌 X — searchParams.has("submission") 로 분기.
