// 종합 입지 점수 계산기.
// PRD 6장 공식을 코드로 옮김.
//
//   PrescriptionScore = (배후세대 × 평균인구/세대 × 인당연처방횟수)
//                       / max(1, 반경500m_경쟁의원수)
//
//   Composite = w1·PrescriptionScore (정규화)
//             + w2·TrafficFlow
//             + w3·PIndex
//             + w4·VacancyPenalty
//             + w5·SupplyAdvantage
//             + w6·BuildableROI

import { prisma } from "@/lib/prisma";
import { haversine } from "./proximity";
import { nearestStation } from "@/realestate/traffic/walk";

// 인당 연 평균 처방횟수 (건강보험심사평가원 진료통계 평균값 — 2023년 기준 연 21회)
const PRESCRIPTION_PER_CAPITA = 21;
const HOUSEHOLD_SIZE = 2.2; // 통계청 평균

const DEFAULT_WEIGHTS = {
  w1: 0.30, // PrescriptionScore
  w2: 0.15, // TrafficFlow (placeholder)
  w3: 0.15, // PIndex (placeholder, 유료 데이터 필요)
  w4: 0.10, // VacancyPenalty (R-ONE 공실률)
  w5: 0.20, // SupplyAdvantage (자체 약국 데이터 필요)
  w6: 0.10, // BuildableROI (Phase 2/3 산출)
} as const;

export interface ScoreInput {
  parcelId: string;
  /** 반경 1km 내 배후 세대수 (분양·기존 단지 합산. 임시로 분양 공고만). */
  radiusForBackingM?: number;
  /** 경쟁의원 검색 반경 (m). */
  radiusForCompetitorM?: number;
  /** 가중치 오버라이드. */
  weights?: Partial<typeof DEFAULT_WEIGHTS>;
}

export interface ScoreOutput {
  parcelId: string;
  backingHouseholds: number;
  competitorClinics: number;
  populationDensity: number | null;
  prescriptionScore: number;
  buildableRoi: number | null;
  vacancyPct: number | null;
  trafficFlow: number;
  supplyAdvantage: number;
  nearestStationName: string | null;
  nearestStationWalkM: number | null;
  supplyMonthlyTotal: number;
  compositeScore: number;
  recommendedSpecialties: string[];
  notes: string[];
  weights: typeof DEFAULT_WEIGHTS;
}

/** 점수 정규화 — 큰 값을 0~100으로 압축. log 스케일. */
function normalize(v: number, k = 100_000): number {
  if (v <= 0) return 0;
  return Math.min(100, +(Math.log10(1 + v) / Math.log10(1 + k) * 100).toFixed(2));
}

export async function computeScore(input: ScoreInput): Promise<ScoreOutput> {
  const w = { ...DEFAULT_WEIGHTS, ...input.weights };
  const backingRadius = input.radiusForBackingM ?? 1000;
  const compRadius = input.radiusForCompetitorM ?? 500;
  const notes: string[] = [];

  const parcel = await prisma.parcel.findUnique({ where: { id: input.parcelId } });
  if (!parcel) throw new Error("Parcel not found");
  if (parcel.centerLat == null || parcel.centerLng == null) {
    throw new Error("Parcel has no coordinates — V월드에서 좌표 보강 필요");
  }
  const center = { lat: parcel.centerLat, lng: parcel.centerLng };

  // 1) 배후 세대수 — 반경 내 분양 공고 세대수 합산
  const dLat = backingRadius / 111000;
  const dLng = backingRadius / (111000 * Math.cos((center.lat * Math.PI) / 180));
  const notices = await prisma.apartmentNotice.findMany({
    where: {
      latitude: { gte: center.lat - dLat, lte: center.lat + dLat },
      longitude: { gte: center.lng - dLng, lte: center.lng + dLng },
    },
    select: { latitude: true, longitude: true, totalHouseholds: true },
  });
  let backing = 0;
  for (const n of notices) {
    if (n.latitude == null || n.longitude == null || n.totalHouseholds == null) continue;
    const d = haversine(center, { lat: n.latitude, lng: n.longitude });
    if (d <= backingRadius) backing += n.totalHouseholds;
  }

  // 2) 경쟁 의원 — 반경 500m 내 의원·종합병원
  const dLatC = compRadius / 111000;
  const dLngC = compRadius / (111000 * Math.cos((center.lat * Math.PI) / 180));
  const facilities = await prisma.medicalFacility.findMany({
    where: {
      latitude: { gte: center.lat - dLatC, lte: center.lat + dLatC },
      longitude: { gte: center.lng - dLngC, lte: center.lng + dLngC },
      status: "OPEN",
      facilityType: { in: ["의원", "종합병원", "병원", "치과의원", "한의원"] },
    },
    select: { latitude: true, longitude: true, facilityType: true, specialties: true },
  });
  let competitors = 0;
  const specialtyCount = new Map<string, number>();
  for (const f of facilities) {
    if (f.latitude == null || f.longitude == null) continue;
    if (haversine(center, { lat: f.latitude, lng: f.longitude }) <= compRadius) {
      competitors++;
      for (const s of f.specialties) specialtyCount.set(s, (specialtyCount.get(s) ?? 0) + 1);
    }
  }

  // 3) 처방수요 점수 (배후 가족 수 × 인당 처방 횟수 ÷ 경쟁수)
  const totalPopInBack = backing * HOUSEHOLD_SIZE;
  const expectedPrescriptions = totalPopInBack * PRESCRIPTION_PER_CAPITA;
  const prescriptionScoreRaw = expectedPrescriptions / Math.max(1, competitors);
  const prescriptionScore = normalize(prescriptionScoreRaw, 1_000_000);

  // 4) 인구밀도 — 행정동 인구 / 행정동 면적 (행정동 면적은 V월드 또는 하드코딩 필요. 임시로 인구만)
  let populationDensity: number | null = null;
  if (parcel.cortarNo) {
    const census = await prisma.census.findFirst({
      where: { cortarNo: parcel.cortarNo },
      orderBy: { yearMonth: "desc" },
    });
    if (census?.totalPop) populationDensity = census.totalPop;
  }

  // 5) Buildable ROI — 가장 최근 매싱 결과
  const lastMassing = await prisma.massingResult.findFirst({
    where: { parcelId: input.parcelId },
    orderBy: { createdAt: "desc" },
  });
  const roi = lastMassing?.estimatedRoi ?? null;

  // 6) Vacancy penalty — 권역 R-ONE 공실률
  let vacancyPct: number | null = null;
  if (parcel.sigungu) {
    const rone = await prisma.roneStat.findFirst({
      where: {
        OR: [{ region: parcel.sigungu }, { region: { contains: parcel.sigungu } }],
        buildingType: { in: ["중대형상가", "소규모상가", "오피스"] },
      },
      orderBy: { yearQuarter: "desc" },
    });
    vacancyPct = rone?.vacancyRate ?? null;
  }

  // 7) 추천 진료과 — 배후가족·경쟁 분포 기반
  // 인구 기반 기본 진료과 + 부족한 과목(공급 부족)
  const recommended: string[] = [];
  if (backing > 0) {
    recommended.push("내과", "소아과", "정형외과");
    // 경쟁 의원에 흔히 없는 과목을 보충
    const lacking = ["소아청소년과", "이비인후과", "피부과", "정형외과"]
      .filter(s => (specialtyCount.get(s) ?? 0) < 2);
    for (const s of lacking) if (!recommended.includes(s)) recommended.push(s);
  }

  if (competitors === 0) notes.push("경쟁의원 0 — 데이터 부족 또는 의료 공백 지역 (HIRA 동기화 확인)");
  if (backing === 0) notes.push("배후 세대 0 — 분양 공고 동기화 필요");

  // 7-A) TrafficFlow — 가장 가까운 지하철역의 월 승하차 합 / 도보거리 패널티
  let trafficFlow = 0;
  let nearestStationName: string | null = null;
  let nearestStationWalkM: number | null = null;
  try {
    const ns = await nearestStation(center, prisma);
    if (ns) {
      nearestStationName = `${ns.station.lineNumber} ${ns.station.name}`;
      nearestStationWalkM = ns.walk.walkingDistanceM;
      const latestRidership = await prisma.subwayRidership.findFirst({
        where: { stationId: ns.station.id },
        orderBy: { yearMonth: "desc" },
      });
      if (latestRidership) {
        // 월간 승차+하차 합 (보통 수십만~수백만 단위) → 도보 분 패널티(분당 5%) 반영 → 정규화
        const flowRaw = (latestRidership.rideCount + latestRidership.alightCount) /
          Math.max(1, 1 + ns.walk.walkingMinutes * 0.05);
        trafficFlow = normalize(flowRaw, 5_000_000);
      } else if (ns.walk.walkingDistanceM <= 800) {
        // 승하차 데이터 없으면 거리만 — 800m 이내면 50, 1500m면 0
        trafficFlow = Math.max(0, 50 * (1 - ns.walk.walkingMinutes / 20));
      }
    } else {
      notes.push("반경 1.5km 내 지하철역 없음 (또는 SubwayStation 미동기화)");
    }
  } catch (e) {
    notes.push(`TrafficFlow 계산 실패: ${(e as Error).message}`);
  }

  // 7-B) SupplyAdvantage — 자체 약국 공급 매출 (월) 합 / 거리 가중
  let supplyAdvantage = 0;
  let supplyMonthlyTotal = 0;
  try {
    const supplyRadius = 2000; // 2km
    const dLatS = supplyRadius / 111000;
    const dLngS = supplyRadius / (111000 * Math.cos((center.lat * Math.PI) / 180));
    const pharmacies = await prisma.ownedPharmacy.findMany({
      where: {
        active: true,
        latitude: { gte: center.lat - dLatS, lte: center.lat + dLatS },
        longitude: { gte: center.lng - dLngS, lte: center.lng + dLngS },
      },
      include: {
        supplies: { orderBy: { yearMonth: "desc" }, take: 3 },
      },
    });
    let weightedSum = 0;
    for (const p of pharmacies) {
      if (p.latitude == null || p.longitude == null) continue;
      const d = haversine(center, { lat: p.latitude, lng: p.longitude });
      if (d > supplyRadius) continue;
      const recent3 = p.supplies;
      if (recent3.length === 0) continue;
      const avgMonthly = recent3.reduce((a, s) => a + s.totalAmount, 0) / recent3.length;
      supplyMonthlyTotal += avgMonthly;
      // 거리 패널티: 500m 이내 1.0, 1km에서 0.5, 2km에서 0
      const w = Math.max(0, 1 - d / supplyRadius);
      weightedSum += avgMonthly * w;
    }
    // 만원 단위 → 정규화 (월 1억 = 10000 → 만점)
    supplyAdvantage = normalize(weightedSum, 10_000);
  } catch (e) {
    notes.push(`SupplyAdvantage 계산 실패: ${(e as Error).message}`);
  }

  // 7-C) PIndex (placeholder — 카드사 데이터 계약 후 채움)
  const pIndex = 0;

  // 8) 가중합 종합 점수
  const vacancyPenalty = vacancyPct != null ? Math.max(0, 100 - vacancyPct * 5) : 50;
  const buildableRoiNorm = roi != null ? Math.max(0, Math.min(100, roi * 10)) : 0;

  const composite =
    w.w1 * prescriptionScore +
    w.w2 * trafficFlow +
    w.w3 * pIndex +
    w.w4 * vacancyPenalty +
    w.w5 * supplyAdvantage +
    w.w6 * buildableRoiNorm;

  if (nearestStationName) {
    notes.push(`가장 가까운 역: ${nearestStationName} (도보 ${Math.round((nearestStationWalkM ?? 0) / 1.3 / 60)}분, ${nearestStationWalkM}m)`);
  }
  if (supplyMonthlyTotal > 0) {
    notes.push(`반경 2km 자체 약국 월 공급 합 ≈ ${supplyMonthlyTotal.toLocaleString()} 만원`);
  }

  const persistData = {
    backingHouseholds: backing,
    competitorClinics: competitors,
    populationDensity,
    prescriptionDemand: prescriptionScoreRaw,
    buildableRoi: roi ?? null,
    trafficFlow,
    pIndex,
    supplyAdvantage,
    prescriptionScore,
    compositeScore: +composite.toFixed(2),
    recommendedSpecialties: recommended,
    notes,
  };
  await prisma.locationScore.upsert({
    where: { parcelId: input.parcelId },
    create: { parcelId: input.parcelId, ...persistData },
    update: { computedAt: new Date(), ...persistData },
  });

  return {
    parcelId: input.parcelId,
    backingHouseholds: backing,
    competitorClinics: competitors,
    populationDensity,
    prescriptionScore,
    buildableRoi: roi,
    vacancyPct,
    trafficFlow,
    supplyAdvantage,
    nearestStationName,
    nearestStationWalkM,
    supplyMonthlyTotal,
    compositeScore: +composite.toFixed(2),
    recommendedSpecialties: recommended,
    notes,
    weights: w,
  };
}
