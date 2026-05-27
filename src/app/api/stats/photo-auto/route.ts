import { NextRequest, NextResponse, after } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";
import { processRxPhoto } from "@/lib/document/process-rx-photo";

// "닥치고 저장" 패턴 — 사용자 의도: 영업사원은 사진만 던지면 끝.
//
// 흐름:
// 1. multipart 받자마자 Storage 저장 + DB row 생성 (status="PROCESSING")
// 2. 즉시 응답 (1~2초) → 클라이언트 free
// 3. after() 백그라운드: Gemini + 매칭 + 시트 → row update (status="PENDING_REVIEW" 또는 "ERROR")
//
// 데이터 손실 X — 사용자가 페이지 닫아도, after() 가 silent fail 해도 row 는 남음.
// 검수 메뉴에서 PROCESSING / ERROR 상태로 추적 가능 → 관리자가 삭제 / 재업로드 결정.

export const runtime = "nodejs";
export const maxDuration = 300;

function normCompany(s: string): string {
  return s.replace(/\(주\)|\(유\)|주식회사|㈜|\s+/g, "").toLowerCase();
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  let fd: FormData;
  try {
    fd = await req.formData();
  } catch (e) {
    return NextResponse.json({ error: `multipart 파싱 실패: ${String(e).slice(0, 200)}` }, { status: 400 });
  }

  const file = fd.get("image");
  const clientIdRaw = fd.get("clientId");
  const yearRaw = fd.get("year");
  const monthRaw = fd.get("month");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "이미지가 없습니다" }, { status: 400 });
  }
  if (file.size > 10_000_000) {
    return NextResponse.json({ error: "이미지가 10MB 를 넘습니다" }, { status: 400 });
  }
  const clientId = typeof clientIdRaw === "string" ? clientIdRaw : "";
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!clientId) return NextResponse.json({ error: "clientId 필수" }, { status: 400 });
  if (!year || !month) return NextResponse.json({ error: "year/month 필수" }, { status: 400 });

  // 거래처 권한 검증
  const client = await prisma.userClient.findUnique({
    where: { id: clientId },
    select: { approved: true, userId: true, clientName: true },
  });
  if (!client) return NextResponse.json({ error: "거래처를 찾을 수 없습니다" }, { status: 404 });
  if (user.role !== "ADMIN" && client.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const mimeType = file.type || "image/jpeg";
  const imageDataUri = `data:${mimeType};base64,${base64}`;
  const fileName = file.name;

  // ── 중복 사진 차단 — 같은 거래처×월에 같은 hash 사진 있으면 reject ──
  // 사용자가 페이지 새로고침 / 실수로 다시 업로드 시 N배 중복 들어가던 문제 fix.
  // 검수자가 "이게 같은 거? 다른 사진?" 헷갈리는 상황 차단.
  const imageHash = createHash("sha256").update(buffer).digest("hex");
  const existingSame = await prisma.prescriptionReport.findFirst({
    where: {
      userId: user.id,
      clientId,
      year,
      month,
      // ocrData JSON path 의 imageHash 값 비교 (Postgres jsonb)
      ocrData: { path: ["imageHash"], equals: imageHash },
    },
    select: { id: true, status: true },
  });
  if (existingSame) {
    return NextResponse.json({
      ok: false,
      duplicate: true,
      reportId: existingSame.id,
      error: `이미 같은 사진이 등록되어 있습니다 (${fileName}). 검수 페이지에서 확인하세요.`,
    }, { status: 409 });
  }

  // ── 1) Storage 저장 (응답 전에 동기) — 사용자가 보낸 사진 자체는 무조건 보존 ──
  let imageKey: string | null = null;
  let imageDataFallback: string | null = null;
  try {
    const persisted = await persistDataUri(BUCKETS.prescriptionImage, user.id, imageDataUri);
    imageKey = persisted.fileKey;
    imageDataFallback = persisted.fileData;
  } catch (e) {
    return NextResponse.json(
      { error: `이미지 저장 실패 (${fileName}): ${String(e).slice(0, 200)}` },
      { status: 500 },
    );
  }

  // ── 2) DB row 즉시 생성 (status="PROCESSING") ─────────────────────────────
  let report;
  try {
    report = await prisma.prescriptionReport.create({
      data: {
        userId: user.id,
        clientId,
        year,
        month,
        hospitalName: client.clientName,
        companyName: "",
        imageData: imageDataFallback,
        imageKey,
        status: "PROCESSING",
        ocrData: {
          source: "gemini-direct-photo-auto",
          finalDrugs: [],
          aiDrugs: [],
          processingStartedAt: new Date().toISOString(),
          fileName,
          imageHash,                                 // 중복 차단용
        },
        totalFee: 0,
        clientApprovedAtSave: client.approved,
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `DB row 생성 실패 (${fileName}): ${String(e).slice(0, 200)}` },
      { status: 500 },
    );
  }

  // ── 3) 백그라운드 처리 — processRxPhoto helper 호출 (photo-retry 와 공유) ─────
  after(() => processRxPhoto({
    reportId: report.id,
    base64,
    mimeType,
    userId: user.id,
    clientName: client.clientName,
    fileName,
  }));

  // ── 4) 즉시 응답 — 클라이언트 free ────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    reportId: report.id,
    fileName,
    status: "processing",
  });
}
