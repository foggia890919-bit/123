import { NextRequest, NextResponse, after } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";
import { extractRxStatsFromImage } from "@/lib/gemini-rx-stats-extract";
import { fetchMasterByCodes, fetchMasterByNamePrefixes, matchMedication, type MergedDrug, type MatchResult, type ValidationResult } from "@/lib/medication-master-match";
import { runSelfValidateBatch, type SelfValidateMeta } from "@/lib/gemini-self-validate";
import { appendRxStats } from "@/lib/google-sheets-rx-append";
import { fetchRateEntries } from "@/lib/rate-utils";
import { computeRowQuality, checkTotalSum } from "@/lib/rx-quality-checks";

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

      // match 결과를 self-validate 단계에서 재사용하려 별도 배열에 저장.
      const matchResults: MatchResult[] = [];
      const finalDrugs = rx.drugs.map((d, idx) => {
        const merged: MergedDrug = {
          insuranceCode: d.code,
          productName: d.name,
          companyName: d.companyName,
          quantity: String(d.quantity ?? ""),
          confidence: d.code ? 90 : 60,
          priceHint: d.unitPrice || undefined,
        };
        const match = matchMedication(merged, masterByCode, masterByName);
        matchResults[idx] = match;
        const additionalRate = additionalByCompany.get(normCompany(match.companyName)) ?? null;
        const codeOk = match.matchedMedicationId !== null && d.code.replace(/\D/g, "").length === 9;
        const finalUnitPrice = match.unitPrice ?? (d.unitPrice || null);

        const { checks, score } = computeRowQuality({
          matchedMedicationId: match.matchedMedicationId,
          codeOk,
          nameSimilar: !!match.matchedMedicationId && (match.nameCodeMismatch == null || match.nameAutoReplaced),
          masterProductName: match.productName,
          ocrProductName: d.name,
          quantity: d.quantity ?? 0,
          geminiUnitPrice: d.unitPrice || undefined,
          masterUnitPrice: match.unitPrice,
          geminiTotalPrice: d.totalPrice || undefined,
          finalUnitPrice,
        });

        const geminiCompany = d.companyName.trim();
        const masterCompany = (match.companyName || "").trim();
        const companyNameMismatch =
          geminiCompany && masterCompany &&
          normCompany(geminiCompany) !== normCompany(masterCompany)
            ? { geminiCompanyName: geminiCompany, masterCompanyName: masterCompany }
            : null;

        // Phase 1 의 Case B (nameAutoReplaced=true) 는 마스터 매칭이 코드를 신뢰하고 이름을 교체한
        // 케이스로, 이미 결정론적 검증 완료. 노란 "검증대상" 마킹 대상 아님 (UI 도 파란 우선).
        // 자동교체 안 됐는데 nameCodeMismatch 만 있는 케이스는 현재 흐름상 발생 안 하지만 방어용 분기.
        const initReviewReason: string | null =
          match.nameCodeMismatch && !match.nameAutoReplaced ? "nameCodeMismatch" : null;

        return {
          insuranceCode: match.insuranceCode,
          // Gemini 행별 추출값 우선 — 사진의 실제 제약사 보존
          companyName: geminiCompany || masterCompany,
          productName: match.productName,
          quantity: String(d.quantity ?? ""),
          unitPrice: finalUnitPrice,
          commissionRate: match.commissionRate,
          additionalRate,
          matchedMedicationId: match.matchedMedicationId,
          finalConfidence: score.overall,
          bboxYPercent: null,
          bbox: d.bbox,
          mismatch: match.nameCodeMismatch
            ? { kind: "code-name-mismatch" as const, ...match.nameCodeMismatch }
            : null,
          companyNameMismatch,
          qualityChecks: checks,
          originalProductName: match.originalProductName,
          nameAutoReplaced: match.nameAutoReplaced,
          reviewReason: initReviewReason as string | null,
          validation: null as ValidationResult | null,
        };
      });

      // ── Gemini 자가검증 (ENV gate) ── B2 fix: 별도 try/catch 로 OCR 보호 ──
      // 마스터DB 가 못 잡은 row (matchedMedicationId === null) 에만 적용. 마스터 매칭된 row 는
      // 결정론적 결과를 신뢰 — Skeptic 우려 흡수, 비용 절감.
      // 실패 (timeout/parse/API down) 시 rethrow 절대 안 함 — OCR 결과는 그대로 저장.
      let selfValidateMeta: SelfValidateMeta | null = null;
      try {
        const batchResult = await runSelfValidateBatch(
          rx.drugs.map((d, idx) => ({
            index: idx,
            matchResult: matchResults[idx],
            ocrUnitPrice: d.unitPrice || null,
          })),
        );
        selfValidateMeta = batchResult.meta;
        for (const [idx, v] of batchResult.validations) {
          finalDrugs[idx].reviewReason = "selfValidateMismatch";
          finalDrugs[idx].validation = v;
        }
      } catch (selfErr) {
        // graceful — 절대 throw 위로 안 넘김. OCR row 는 PENDING_REVIEW 로 그대로 저장됨.
        console.error("[photo-auto self-validate]", report.id, String(selfErr).slice(0, 300));
      }

      const totalFee = finalDrugs.reduce((s, d) => {
        const qty = parseFloat(d.quantity) || 0;
        const unit = d.unitPrice ?? 0;
        return s + qty * unit;
      }, 0);

      const avgConfidence = finalDrugs.length
        ? Math.round(finalDrugs.reduce((s, d) => s + d.finalConfidence, 0) / finalDrugs.length)
        : 0;
      const manualCheckCount = finalDrugs.filter((d) => d.finalConfidence < 90).length;

      // 사진 단위 합계 검증 — Gemini summary 와 행 합산 비교 (Gemini 추출 매출 기준)
      const rowSumGemini = rx.drugs.reduce((s, d) => s + (d.totalPrice || 0), 0);
      const totalSumCheck = checkTotalSum(rowSumGemini, rx.summary.totalAmountWon);

      // 한 사진 안의 모든 제약사 (행별 companyName set)
      const companySet = new Set<string>();
      for (const fd of finalDrugs) {
        const v = fd.companyName.trim();
        if (v) companySet.add(v);
      }
      const companiesInPhoto = Array.from(companySet);

      // PrescriptionReport.companyName 단일 컬럼은 "가장 행이 많은 제약사" 로 결정.
      // 옛 의미("사진의 단일 제약사") → 새 의미("주된 제약사"). 행별 정확도는 finalDrugs[].companyName 에 있음.
      const companyRowCount = new Map<string, number>();
      for (const fd of finalDrugs) {
        const k = fd.companyName.trim();
        if (!k) continue;
        companyRowCount.set(k, (companyRowCount.get(k) ?? 0) + 1);
      }
      const dominantCompany = Array.from(companyRowCount.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? rx.pharma ?? "";

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
          companyName: dominantCompany,
          totalFee,
          ocrData: {
            source: "gemini-direct-photo-auto",
            vendor: "unknown",
            captureType: "photo",
            finalDrugs,
            aiDrugs: finalDrugs,
            avgConfidence,
            manualCheckCount,
            totalSumCheck,
            companiesInPhoto,
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
            // Gemini 자가검증 메타 (ENV gate off 면 null). 행별 reviewReason 은 finalDrugs[i] 에.
            selfValidate: selfValidateMeta,
          } as unknown as Prisma.InputJsonObject,
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
