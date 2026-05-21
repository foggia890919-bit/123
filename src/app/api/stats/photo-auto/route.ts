import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";
import { extractRxStatsFromImage } from "@/lib/gemini-rx-stats-extract";
import { fetchMasterByCodes, fetchMasterByNamePrefixes, matchMedication, type MergedDrug } from "@/lib/medication-master-match";
import { appendRxStats } from "@/lib/google-sheets-rx-append";
import { fetchRateEntries } from "@/lib/rate-utils";

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

  // ── 3) 백그라운드 처리 — Gemini + 매칭 + 시트 + row update ───────────────
  // after() 가 silent fail 해도 row 는 PROCESSING 상태로 남아 검수 메뉴에서 보임.
  // 영업사원 입장에선 데이터 손실 X (관리자가 확인 후 대응).
  after(async () => {
    try {
      // Gemini 분석
      const { data: rx } = await extractRxStatsFromImage(base64, mimeType);
      if (rx.drugs.length === 0) {
        await prisma.prescriptionReport.update({
          where: { id: report.id },
          data: {
            status: "ERROR",
            ocrData: {
              ...(report.ocrData as Record<string, unknown>),
              error: "약품 0건 — Gemini 가 사진에서 약품 인식 실패",
              processingEndedAt: new Date().toISOString(),
            },
          },
        });
        return;
      }

      // 마스터 매칭
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

      // 시트 저장 — 실패해도 DB row 는 PENDING_REVIEW 로 진행
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
      } catch (e) {
        sheetWarning = String(e).slice(0, 200);
      }

      // 성공 (또는 시트만 실패) — row update
      await prisma.prescriptionReport.update({
        where: { id: report.id },
        data: {
          status: "PENDING_REVIEW",
          companyName: rx.pharma || "",
          totalFee,
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
            sheetBatchId,
            sheetUrl,
            sheetWarning,
            fileName,
            processingEndedAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        },
      });
    } catch (e) {
      // 어떤 단계든 실패 → status="ERROR" 로 변경
      try {
        await prisma.prescriptionReport.update({
          where: { id: report.id },
          data: {
            status: "ERROR",
            ocrData: {
              ...(report.ocrData as Record<string, unknown>),
              error: String(e).slice(0, 500),
              processingEndedAt: new Date().toISOString(),
            },
          },
        });
      } catch (updateErr) {
        console.error("[photo-auto background fail update]", report.id, String(updateErr).slice(0, 200));
      }
    }
  });

  // ── 4) 즉시 응답 — 클라이언트 free ────────────────────────────────────────
  return NextResponse.json({
    ok: true,
    reportId: report.id,
    fileName,
    status: "processing",
  });
}
