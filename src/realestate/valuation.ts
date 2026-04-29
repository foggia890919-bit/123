// 매매가 + R-ONE 통계 + 매물 정보를 결합한 평가 엔진.
//
// ── 핵심 공식 ──────────────────────────────────────────────────────────
//
//   적정 월 임대료(만원) = 매매가(만원) × 소득수익률%/100 ÷ 12
//   적정 보증금(만원)    = 월 임대료 × 보증금배수 (보통 10~20)
//   대출가능액(만원)     = 매매가 × LTV / 100
//   자기자본(만원)       = 매매가 - 대출가능액 + 취득세 + 중개수수료
//   월 이자(만원)        = 대출가능액 × 연금리%/100 / 12
//   월 순수익(만원)      = 월 임대료 - 월 이자 - 관리비 가정
//   자기자본 ROI(%)      = 월 순수익 × 12 / 자기자본 × 100
//
// ── 단위 ──────────────────────────────────────────────────────────────
//   매매가/임대료/보증금: 만원 (네이버·MOLIT 표기 그대로)
//   R-ONE rentPerM2:    원/㎡ (월)
//   결과는 모두 만원·% 단위로 반올림.

import { prisma } from "@/lib/prisma";
import type { REListing, RoneStat } from "@prisma/client";

export interface ValuationAssumptions {
  /** 대출 비율 (%). 기본 60. 임대사업자 대출 보수적 가정. */
  ltv: number;
  /** 연 대출금리 (%). 기본 5.5. */
  loanRatePct: number;
  /** 취득세율 (%, 매매가 대비). 상가/오피스텔 4.6 통상. */
  acquisitionTaxPct: number;
  /** 중개수수료율 (%, 매매가 대비). 상한 0.9. */
  brokerageFeePct: number;
  /** 월 관리비 (만원, 절대값 가정). */
  monthlyOpex: number;
  /** 보증금 배수 (보증금 / 월세). */
  depositMultiplier: number;
}

export const DEFAULT_ASSUMPTIONS: ValuationAssumptions = {
  ltv: 60,
  loanRatePct: 5.5,
  acquisitionTaxPct: 4.6,
  brokerageFeePct: 0.9,
  monthlyOpex: 30,
  depositMultiplier: 12,
};

export interface ValuationResult {
  // 입력
  saleAmount: number; // 만원
  areaM2: number | null;
  region: string;
  buildingType: string; // 매핑된 R-ONE 유형
  // 통계
  capRatePct: number | null;
  yieldPct: number | null;
  roneRentPerM2: number | null; // 원/㎡
  vacancyPct: number | null;
  // 추정 임대조건
  estimatedMonthlyRent: number | null;     // 만원
  estimatedDeposit: number | null;          // 만원
  rentBy: "cap-rate" | "rone-rent" | "blended" | "n/a";
  // 대출/이익
  loanAmount: number;       // 만원
  ownEquity: number;        // 만원
  monthlyInterest: number;  // 만원
  monthlyNetIncome: number | null; // 만원
  annualNetIncome: number | null;  // 만원
  cashOnCashRoiPct: number | null; // %
  // 메타
  assumptions: ValuationAssumptions;
  notes: string[];
}

/**
 * 매물의 propertyType → R-ONE 건물유형 매핑.
 * 상가는 "중대형상가" / "소규모상가" 두 통계를 평균. 사무실은 오피스.
 */
function buildingTypeFor(propertyType: string): string[] {
  if (/오피스텔/.test(propertyType)) return ["오피스"]; // 오피스텔 통계는 R-ONE 별도
  if (/사무|오피스/.test(propertyType)) return ["오피스"];
  if (/상가|근생/.test(propertyType)) return ["중대형상가", "소규모상가"];
  if (/빌딩/.test(propertyType)) return ["오피스", "중대형상가"];
  return ["중대형상가"];
}

/** 시군구 추출 — "서울특별시 강남구 역삼동..." → "강남구". */
function sigunguOf(address: string | null): string | null {
  if (!address) return null;
  const m = /([가-힣]+(?:시|군|구))/.exec(address);
  return m ? m[1] : null;
}

/**
 * 통계 매칭: 가장 최근 분기의 R-ONE 데이터를 region 기준으로 가져온다.
 * region 매칭이 실패하면 시도 단위로 fallback.
 */
async function pickRoneStats(buildingTypes: string[], region: string | null): Promise<RoneStat[]> {
  if (!region) return [];
  const latest = await prisma.roneStat.findFirst({
    where: { buildingType: { in: buildingTypes } },
    orderBy: { yearQuarter: "desc" },
    select: { yearQuarter: true },
  });
  if (!latest) return [];
  return prisma.roneStat.findMany({
    where: {
      buildingType: { in: buildingTypes },
      yearQuarter: latest.yearQuarter,
      OR: [{ region }, { region: { contains: region } }],
    },
  });
}

/** 통계가 여럿이면 평균. */
function avg(nums: (number | null | undefined)[]): number | null {
  const xs = nums.filter((n): n is number => n != null && Number.isFinite(n));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export async function valuateListing(
  listing: REListing,
  opts: Partial<ValuationAssumptions> = {},
): Promise<ValuationResult> {
  const a: ValuationAssumptions = { ...DEFAULT_ASSUMPTIONS, ...opts };
  const notes: string[] = [];

  if (listing.priceSale == null) {
    return emptyValuation(listing, a, "매매가 없음 (전·월세 매물이라 매매 기준 평가 불가)");
  }

  const buildingTypes = buildingTypeFor(listing.propertyType);
  const region = sigunguOf(listing.address) ?? listing.region ?? null;
  const stats = await pickRoneStats(buildingTypes, region);

  const cap = avg(stats.map(s => s.capRate ?? s.yieldRate));
  const yieldPct = avg(stats.map(s => s.yieldRate));
  const ronePerM2 = avg(stats.map(s => s.rentPerM2));
  const vacancy = avg(stats.map(s => s.vacancyRate));

  const sale = listing.priceSale; // 만원
  const area = listing.areaExclusive ?? listing.areaSupply;

  // ── 임대료 추정: cap rate 우선, 부족하면 R-ONE 단가, 둘 다 없으면 n/a
  let estRent: number | null = null;
  let rentBy: ValuationResult["rentBy"] = "n/a";
  if (cap != null) {
    estRent = Math.round((sale * (cap / 100)) / 12);
    rentBy = "cap-rate";
  }
  if (ronePerM2 != null && area != null) {
    // 원/㎡/월 × ㎡ = 원/월 → 만원/월
    const fromArea = Math.round((ronePerM2 * area) / 10_000);
    if (estRent == null) {
      estRent = fromArea;
      rentBy = "rone-rent";
    } else {
      // 두 추정치를 평균 (블렌딩) — 한쪽이 비현실적으로 멀면 cap rate 신뢰
      const ratio = fromArea / estRent;
      if (ratio >= 0.5 && ratio <= 2) {
        estRent = Math.round((estRent + fromArea) / 2);
        rentBy = "blended";
      } else {
        notes.push(`cap-rate(${estRent}만) ↔ R-ONE단가(${fromArea}만) 차이 ${ratio.toFixed(2)}배 — cap rate 채택`);
      }
    }
  }

  const estDeposit = estRent != null ? estRent * a.depositMultiplier : null;

  // ── 대출 / 자기자본
  const loan = Math.round(sale * (a.ltv / 100));
  const acqTax = Math.round(sale * (a.acquisitionTaxPct / 100));
  const brokerage = Math.round(sale * (a.brokerageFeePct / 100));
  const equity = sale - loan + acqTax + brokerage;

  const monthlyInterest = +(loan * (a.loanRatePct / 100) / 12).toFixed(0);

  const monthlyNet =
    estRent != null ? +(estRent - monthlyInterest - a.monthlyOpex).toFixed(0) : null;
  const annualNet = monthlyNet != null ? monthlyNet * 12 : null;
  const roi = monthlyNet != null && equity > 0 ? +((annualNet! / equity) * 100).toFixed(2) : null;

  if (stats.length === 0) {
    notes.push(`R-ONE 통계 없음 (region=${region}, types=${buildingTypes.join("/")}). 'npm run re:rone' 먼저 실행 필요.`);
  }
  if (vacancy != null && vacancy > 0 && estRent != null) {
    notes.push(`공실률 ${vacancy.toFixed(1)}% 반영 시 실효 임대료 ≈ ${Math.round(estRent * (1 - vacancy / 100))}만원`);
  }

  return {
    saleAmount: sale,
    areaM2: area ?? null,
    region: region ?? "",
    buildingType: buildingTypes.join("/"),
    capRatePct: cap,
    yieldPct,
    roneRentPerM2: ronePerM2,
    vacancyPct: vacancy,
    estimatedMonthlyRent: estRent,
    estimatedDeposit: estDeposit,
    rentBy,
    loanAmount: loan,
    ownEquity: equity,
    monthlyInterest,
    monthlyNetIncome: monthlyNet,
    annualNetIncome: annualNet,
    cashOnCashRoiPct: roi,
    assumptions: a,
    notes,
  };
}

function emptyValuation(listing: REListing, a: ValuationAssumptions, note: string): ValuationResult {
  return {
    saleAmount: listing.priceSale ?? 0,
    areaM2: listing.areaExclusive ?? listing.areaSupply ?? null,
    region: "",
    buildingType: "",
    capRatePct: null,
    yieldPct: null,
    roneRentPerM2: null,
    vacancyPct: null,
    estimatedMonthlyRent: null,
    estimatedDeposit: null,
    rentBy: "n/a",
    loanAmount: 0,
    ownEquity: 0,
    monthlyInterest: 0,
    monthlyNetIncome: null,
    annualNetIncome: null,
    cashOnCashRoiPct: null,
    assumptions: a,
    notes: [note],
  };
}

/**
 * 권역 + 건물유형의 **추정 평균 임대료** 를 매매 실거래로부터 역산.
 * R-ONE 통계가 없을 때나 더 보수적인 기준이 필요할 때 사용.
 *
 * (시군구 매매 실거래 평균 단가 × ㎡) × (cap rate) / 12 = 추정 월세
 *
 * cap rate가 없을 때는 cap rate 인자를 명시적으로 받는다 (default 4%).
 */
export async function regionalEstimatedRent(opts: {
  lawdCd: string;
  capRatePct?: number;
  months?: number;
}): Promise<{
  count: number;
  medianSale: number | null;
  pricePerM2: number | null; // 만원/㎡
  estimatedMonthlyRentPerM2: number | null; // 만원/㎡
}> {
  const months = opts.months ?? 12;
  const cap = opts.capRatePct ?? 4;
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const ymdMin = `${since.getFullYear()}${String(since.getMonth() + 1).padStart(2, "0")}`;

  const trades = await prisma.molitTrade.findMany({
    where: {
      lawdCd: opts.lawdCd,
      tradeType: "매매",
      dealYearMonth: { gte: ymdMin },
      amount: { not: null },
      areaM2: { not: null },
    },
  });

  const ppm = trades
    .map(t => (t.amount! / t.areaM2!))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (ppm.length === 0) {
    return { count: 0, medianSale: null, pricePerM2: null, estimatedMonthlyRentPerM2: null };
  }
  const median = ppm[Math.floor(ppm.length / 2)];
  const medianSale = trades
    .map(t => t.amount!)
    .sort((a, b) => a - b)[Math.floor(trades.length / 2)];

  // 월세(만원/㎡) = 매매단가 × cap% / 100 / 12
  const rentPerM2 = +(median * (cap / 100) / 12).toFixed(2);
  return {
    count: trades.length,
    medianSale,
    pricePerM2: +median.toFixed(2),
    estimatedMonthlyRentPerM2: rentPerM2,
  };
}
