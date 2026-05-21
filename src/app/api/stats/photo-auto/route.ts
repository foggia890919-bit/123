import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";
import { extractRxStatsFromImage } from "@/lib/gemini-rx-stats-extract";
import { fetchMasterByCodes, fetchMasterByNamePrefixes, matchMedication, type MergedDrug } from "@/lib/medication-master-match";
import { appendRxStats } from "@/lib/google-sheets-rx-append";
import { fetchRateEntries } from "@/lib/rate-utils";

// 사용자 의도: "사진 넣고 저장만 누르게 하고 나머지는 백단에서". 즉 클라이언트는 fetch
// 응답만 빨리 받고 페이지 이동 자유. 서버가 Gemini 분석 + DB 저장 + 시트 저장 다 처리.
//
// Next.js 16 `after()` API 활용: 응답 보낸 후에도 함수 invocation 이 maxDuration 까지
// 유지되면서 백그라운드 작업 계속.

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

  // 거래처 권한 검증 (응답 전에 동기적으로)
  const client = await prisma.userClient.findUnique({
    where: { id: clientId },
    select: { approved: true, userId: true, clientName: true },
  });
  if (!client) return NextResponse.json({ error: "거래처를 찾을 수 없습니다" }, { status: 404 });
  if (user.role !== "ADMIN" && client.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // 사진 buffer 를 응답 전에 미리 추출 — after() 콜백 안에선 req body 접근 불가
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const mimeType = file.type || "image/jpeg";
  const imageDataUri = `data:${mimeType};base64,${base64}`;
  const fileName = file.name;

  // 응답 보낸 후 백그라운드에서 Gemini 분석 + DB + 시트 저장.
  // 에러는 콘솔 로그만 (클라이언트로 알릴 길 없음). 향후 jobId 별 상태 테이블 가능.
  after(async () => {
    try {
      // 1) Gemini 분석
      const { data: rx } = await extractRxStatsFromImage(base64, mimeType);
      if (rx.drugs.length === 0) {
        console.error("[photo-auto bg]", fileName, "drugs 0건 — 인식 실패");
        return;
      }

      // 2) 마스터 매칭 — 보험코드 + 제품명 prefix 둘 다 일괄 조회
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

      // 3) DB 저장
      const { fileKey: imageKey, fileData: imageDataFallback } =
        await persistDataUri(BUCKETS.prescriptionImage, user.id, imageDataUri);

      const report = await prisma.prescriptionReport.create({
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

      // 4) 시트 저장
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
        await prisma.prescriptionReport.update({
          where: { id: report.id },
          data: {
            ocrData: {
              ...(report.ocrData as Record<string, unknown>),
              sheetBatchId: sheet.batchId,
              sheetUrl: sheet.spreadsheetUrl,
            },
          },
        });
      } catch (e) {
        console.error("[photo-auto bg sheet]", fileName, String(e).slice(0, 200));
        // DB 저장은 성공했으니 시트만 실패. 운영자가 사용자에게 안내 필요.
      }

      console.log(`[photo-auto bg] ${fileName} 완료 — ${finalDrugs.length}건, ${totalFee.toLocaleString()}원`);
    } catch (e) {
      console.error("[photo-auto bg]", fileName, String(e).slice(0, 500));
    }
  });

  // 즉시 응답 — 클라이언트는 이후 페이지 자유
  return NextResponse.json({ queued: true, fileName, sizeKB: Math.round(buffer.length / 1024) });
}
