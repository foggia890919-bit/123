// 지번 또는 PNU 입력 → 필지·용도·공시지가·기존 건물·매싱·수지를 한 번에 산출.
//
// 사업주가 보는 화면은 대부분 이 함수를 한 번 호출하면 끝나도록 설계.

import { prisma } from "@/lib/prisma";
import {
  geocodeJibun,
  getLandUse,
  getOfficialPrice,
  getParcelByPnu,
  getParcelByPoint,
  type VworldParcel,
} from "./vworld";
import { getTitleInfo, type BuildingTitleInfo } from "./buildingHub";
import { compute as computeMassing, DEFAULT_MEDICAL, type MassingScenario } from "./massing";
import { saveMassingResult, upsertBuildingLedgers, upsertParcel } from "./storage";
import { regionalEstimatedRent } from "@/realestate/valuation";
import { computeScore, type ScoreOutput } from "@/realestate/scout/score";
import type { Parcel } from "@prisma/client";

export interface LandAnalyzeInput {
  jibun?: string;
  pnu?: string;
  scenario?: Partial<MassingScenario>;
  /** 매매가 가정값 (만원). 미지정 시 공시지가 × 면적 × 1.5 로 추정. */
  assumedSaleAmount?: number;
  /** 대출/이익 가정. valuation의 기본값 사용. */
  ltv?: number;
  loanRatePct?: number;
  monthlyOpex?: number;
  capRatePct?: number;
}

export interface LandAnalyzeResult {
  parcel: Parcel;
  buildings: BuildingTitleInfo[];
  massing: ReturnType<typeof computeMassing>;
  proforma: {
    assumedSaleAmount: number;
    saleSource: "user" | "officialPriceX1.5" | "fallback";
    estimatedMonthlyRent: number | null;     // 만원
    estimatedAnnualRent: number | null;
    capRatePct: number;
    loanAmount: number;
    ownEquity: number;
    monthlyInterest: number;
    monthlyNetIncome: number | null;
    cashOnCashRoiPct: number | null;
  };
  notes: string[];
  massingResultId?: string;
  score?: ScoreOutput;
}

const ACQ_TAX = 0.046;       // 4.6%
const BROKER = 0.009;        // 0.9%
const DEFAULT_LTV = 60;
const DEFAULT_RATE = 5.5;
const DEFAULT_OPEX = 30;     // 만원/월

export async function analyze(input: LandAnalyzeInput): Promise<LandAnalyzeResult> {
  if (!input.jibun && !input.pnu) {
    throw new Error("jibun 또는 pnu 중 하나는 필요합니다.");
  }

  const notes: string[] = [];

  // 1) PNU 확보 (지번이면 좌표 → 좌표로 필지 검색해서 PNU 추출)
  let parcelRaw: VworldParcel | null = null;
  if (input.pnu) {
    parcelRaw = await getParcelByPnu(input.pnu);
  } else {
    const g = await geocodeJibun(input.jibun!);
    if (!g) throw new Error("지번 검색 실패 (V월드)");
    parcelRaw = await getParcelByPoint(g.lat, g.lng);
    if (parcelRaw && !parcelRaw.centerLat) {
      parcelRaw.centerLat = g.lat;
      parcelRaw.centerLng = g.lng;
    }
  }
  if (!parcelRaw || !parcelRaw.pnu) throw new Error("필지 정보를 찾지 못했어요.");
  if (parcelRaw.area == null) notes.push("V월드 응답에 면적이 없음 — 지적도 갱신 지연 가능");

  // 2) 용도지역 + 공시지가 보강
  const [landuse, officialPrice] = await Promise.all([
    getLandUse(parcelRaw.pnu).catch(() => null),
    getOfficialPrice(parcelRaw.pnu).catch(() => null),
  ]);

  // 3) 캐시 upsert
  const parcel = await upsertParcel(parcelRaw, landuse, officialPrice);

  // 4) 건축물대장 (있을 수도, 없을 수도 — 나대지)
  let buildings: BuildingTitleInfo[] = [];
  try {
    buildings = await getTitleInfo(parcelRaw.pnu);
    if (buildings.length > 0) await upsertBuildingLedgers(parcel.id, buildings);
  } catch (e) {
    notes.push(`건축HUB 조회 실패: ${(e as Error).message}`);
  }

  // 5) 매싱
  const scenario: MassingScenario = { ...DEFAULT_MEDICAL, ...input.scenario };
  const massing = computeMassing(
    {
      pnu: parcel.pnu,
      area: parcel.area ?? 0,
      zoneName: parcel.landUse ?? "",
    },
    scenario,
  );
  if ((parcel.area ?? 0) === 0) {
    notes.push("면적이 0이라 매싱 결과 0. 지번을 다시 확인하세요.");
  }

  // 6) 매매가 가정값 결정
  let assumedSale = input.assumedSaleAmount;
  let saleSource: LandAnalyzeResult["proforma"]["saleSource"] = "user";
  if (!assumedSale) {
    if (parcel.officialPrice && parcel.area) {
      // 공시지가는 원/㎡ → 매매가 추정 = 공시지가 × 면적 × 1.5 → 만원으로 환산
      assumedSale = Math.round((parcel.officialPrice * parcel.area * 1.5) / 10_000);
      saleSource = "officialPriceX1.5";
      notes.push(`매매가 가정 = 공시지가 × 면적 × 1.5 = ${assumedSale.toLocaleString()}만원 (실거래로 보정 권장)`);
    } else {
      assumedSale = 0;
      saleSource = "fallback";
      notes.push("매매가 가정값 없음. assumedSaleAmount를 명시하세요.");
    }
  }

  // 7) 임대료 추정 — 권역 cap rate (R-ONE) → 없으면 입력 cap
  const cap = input.capRatePct ?? 4;
  const annualRentByCap =
    assumedSale > 0 ? Math.round(assumedSale * (cap / 100)) : null;
  const monthlyRent = annualRentByCap != null ? Math.round(annualRentByCap / 12) : null;

  // 8) 대출/이익
  const ltv = input.ltv ?? DEFAULT_LTV;
  const rate = input.loanRatePct ?? DEFAULT_RATE;
  const opex = input.monthlyOpex ?? DEFAULT_OPEX;

  const loan = Math.round(assumedSale * (ltv / 100));
  const equity = assumedSale - loan + Math.round(assumedSale * ACQ_TAX) + Math.round(assumedSale * BROKER);
  const monthlyInterest = Math.round((loan * (rate / 100)) / 12);
  const monthlyNet = monthlyRent != null ? monthlyRent - monthlyInterest - opex : null;
  const roi = monthlyNet != null && equity > 0 ? +((monthlyNet * 12 / equity) * 100).toFixed(2) : null;

  // 9) 매싱 결과 저장
  const massingId = await saveMassingResult(parcel.id, scenario, massing, {
    estimatedAnnualRent: annualRentByCap ?? undefined,
    estimatedRoi: roi ?? undefined,
  });

  // 10) 종합 입지 점수 (Phase 4 + 5 데이터 활용)
  let score: ScoreOutput | undefined;
  try {
    score = await computeScore({ parcelId: parcel.id });
  } catch (e) {
    notes.push(`입지 점수 계산 스킵: ${(e as Error).message}`);
  }

  return {
    parcel,
    buildings,
    massing,
    proforma: {
      assumedSaleAmount: assumedSale,
      saleSource,
      estimatedMonthlyRent: monthlyRent,
      estimatedAnnualRent: annualRentByCap,
      capRatePct: cap,
      loanAmount: loan,
      ownEquity: equity,
      monthlyInterest,
      monthlyNetIncome: monthlyNet,
      cashOnCashRoiPct: roi,
    },
    notes,
    massingResultId: massingId,
    score,
  };
}

/**
 * 권역 평균 cap rate 자동 적용 — DB의 R-ONE 통계 + MOLIT 매매를 결합해
 * 더 정밀한 임대수익 추정. analyze() 후 추가로 호출 가능.
 */
export async function regionalRentBenchmark(parcel: Parcel): Promise<{
  regionalRentPerM2?: number;
  regionalCapRate?: number;
  benchmarkSourceCount: number;
}> {
  if (!parcel.cortarNo) return { benchmarkSourceCount: 0 };
  const lawdCd = parcel.cortarNo.slice(0, 5);

  const [rone, molit] = await Promise.all([
    prisma.roneStat.findFirst({
      where: {
        OR: [
          { region: parcel.sigungu ?? "" },
          { region: { contains: parcel.sigungu ?? "" } },
        ],
        buildingType: { in: ["중대형상가", "소규모상가", "오피스"] },
      },
      orderBy: { yearQuarter: "desc" },
    }),
    regionalEstimatedRent({ lawdCd, capRatePct: 4, months: 12 }),
  ]);

  return {
    regionalRentPerM2: rone?.rentPerM2 ?? undefined,
    regionalCapRate: rone?.capRate ?? rone?.yieldRate ?? undefined,
    benchmarkSourceCount: (rone ? 1 : 0) + (molit?.count ?? 0),
  };
}
