import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";
import { extractRxStatsFromImage } from "@/lib/gemini-rx-stats-extract";
import { fetchMasterByCodes, fetchMasterByNamePrefixes, matchMedication, type MergedDrug } from "@/lib/medication-master-match";
import { appendRxStats } from "@/lib/google-sheets-rx-append";
import { fetchRateEntries } from "@/lib/rate-utils";

// 사진 한 장당 Gemini 분석 + 마스터 매칭 + DB + 시트 저장 동기 처리.
// 이전 next/server after() 백그라운드 패턴은 일부 사진 silent fail 발생 (Vercel 함수
// 인스턴스 비활성화 + console.error 만 → 클라이언트에 안 알림).
// 동기로 바꿔서 사진별 실패를 정확히 클라이언트에 전달 — 데이터 무손실 우선.
// 응답 시간 30~60초/사진. 클라이언트가 concurrency 3 으로 묶어 7장이면 약 2분.

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

  // ── 동기 처리 시작 ───────────────────────────────────────────────────────

  // 1) Gemini 분석
  let rx;
  try {
    const result = await extractRxStatsFromImage(base64, mimeType);
    rx = result.data;
  } catch (e) {
    return NextResponse.json(
      { error: `Gemini 분석 실패 (${fileName}): ${String(e).slice(0, 300)}` },
      { status: 502 },
    );
  }
  if (rx.drugs.length === 0) {
    return NextResponse.json(
      { error: `약품 0건 — Gemini 가 사진(${fileName})에서 약품을 인식하지 못함. 사진이 흐릿하거나 처방통계 표가 아닌지 확인.` },
      { status: 422 },
    );
  }

  // 2) 마스터 매칭
  const codes = rx.drugs
    .map((d) => d.code.replace(/\D/g, ""))
    .filter((c) => c.length === 9);
  const names = rx.drugs.map((d) => d.name).filter(Boolean);
  const [masterByCode, masterByName] = await Promise.all([
    fetchMasterByCodes(codes),
    fetchMasterByNamePrefixes(names),
  ]);
  const rateEntries = await fetchRateEntries(user.id);
  const additionalByCompany = new Map(
    rateEntries.map((r) => [normCompany(r.companyName), r.additionalRate]),
  );

  const finalDrugs = rx.drugs.map((d) => {
    const merged: MergedDrug = {
      insuranceCode: d.code,
      productName: d.name,
      companyName: "",
      quantity: String(d.quantity ?? ""),
      confidence: d.code ? 90 : 60,
    };
    const match = matchMedication(merged, masterByCode, masterByName);
    const additionalRate = additionalByCompany.get(normCompany(match.companyName)) ?? null;
    return {
      insuranceCode: match.insuranceCode,
      companyName: match.companyName,
      productName: match.productName,
      quantity: String(d.quantity ?? ""),
      unitPrice: match.unitPrice ?? (d.unitPrice || null),
      commissionRate: match.commissionRate,
      additionalRate,
      matchedMedicationId: match.matchedMedicationId,
      bboxYPercent: null,
      bbox: d.bbox,
    };
  });

  const totalFee = finalDrugs.reduce((s, d) => {
    const qty = parseFloat(d.quantity) || 0;
    const unit = d.unitPrice ?? 0;
    return s + qty * unit;
  }, 0);

  // 3) 이미지 + DB 저장
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

  let report;
  try {
    report = await prisma.prescriptionReport.create({
      data: {
        userId: user.id,
        clientId,
        year,
        month,
        hospitalName: client.clientName,
        companyName: rx.pharma || "",
        imageData: imageDataFallback,
        imageKey,
        ocrData: {
          source: "gemini-direct-photo-auto",
          vendor: "unknown",
          captureType: "photo",
          finalDrugs,
          aiDrugs: finalDrugs,
          avgConfidence: 95,
          manualCheckCount: 0,
          geminiMeta: {
            pharma: rx.pharma,
            period: rx.period,
            periodRaw: rx.periodRaw,
            summary: rx.summary,
          },
          sheetBatchId: null as string | null,
          sheetUrl: null as string | null,
        },
        totalFee,
        clientApprovedAtSave: client.approved,
        updatedAt: new Date(),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `DB 저장 실패 (${fileName}): ${String(e).slice(0, 200)}` },
      { status: 500 },
    );
  }

  // 4) 시트 저장 — 실패해도 DB 는 보존
  let sheetUrl: string | null = null;
  let sheetBatchId: string | null = null;
  let sheetWarning: string | null = null;
  try {
    const sheet = await appendRxStats(
      {
        pharma: rx.pharma,
        period: rx.period,
        periodRaw: rx.periodRaw,
        hospital: client.clientName,
        summary: {
          drugCount: rx.drugs.length,
          totalPrescriptions: rx.summary.totalPrescriptions,
          totalQuantity: rx.summary.totalQuantity,
          totalAmountWon: Math.round(totalFee),
        },
        drugs: rx.drugs,
      },
      "manual",
    );
    sheetUrl = sheet.spreadsheetUrl;
    sheetBatchId = sheet.batchId;
    await prisma.prescriptionReport.update({
      where: { id: report.id },
      data: {
        ocrData: {
          ...(report.ocrData as Record<string, unknown>),
          sheetBatchId,
          sheetUrl,
        },
      },
    });
  } catch (e) {
    sheetWarning = String(e).slice(0, 200);
  }

  return NextResponse.json({
    ok: true,
    reportId: report.id,
    fileName,
    drugCount: rx.drugs.length,
    totalFee,
    sheetUrl,
    sheetBatchId,
    sheetWarning,
  });
}
