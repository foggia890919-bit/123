// 메디컬 빌딩 가설계(매싱) 엔진.
//
// 입력: 대지면적 + 용도지역(BCR/FAR) + 시나리오(층고·전용률·주차규칙)
// 출력: 최대 건축면적·연면적·층수·주차대수·임대가능면적·추정 공사비
//
// 한계:
//   - 일조권 사선 제한, 주차장 출입구 폭, 정북방향 인접지 거리 등은
//     필지 폴리곤 + 인접지 분석이 필요하므로 본 엔진에서는 단순 패널티로만 반영.
//   - 정밀 가설계는 추후 랜드북·플랜잇 API 또는 자체 GIS 엔진(turf.js)으로 보강.

import { lookupZoning } from "./zoning";

export interface ParcelInput {
  pnu: string;
  area: number;            // ㎡
  zoneName: string;        // V월드에서 가져온 용도지역명
}

export interface MassingScenario {
  buildingType: "medical" | "office" | "mixed";
  floorHeight: number;     // m, medical 기본 4.2
  efficiency: number;      // 전용률, 0.65~0.75
  parkingRule: "medical" | "office";
  constructionUnitCost?: number; // 평당 공사비 (만원/평) — 메디컬 평균 700~900
}

export const DEFAULT_MEDICAL: MassingScenario = {
  buildingType: "medical",
  floorHeight: 4.2,
  efficiency: 0.7,
  parkingRule: "medical",
  constructionUnitCost: 850,
};

export interface MassingResult {
  pnu: string;
  zoneName: string;
  area: number;
  bcrLimit: number;
  farLimit: number;
  // 산출
  maxBuildArea: number;     // ㎡ — 한 층 최대 건축면적
  maxFloorArea: number;     // ㎡ — 총 연면적 한도
  maxFloors: number;        // 지상층 (층고 + FAR 기반)
  parkingRequired: number;
  basementFloors: number;   // 주차 수용을 위한 지하층 추정
  netRentableArea: number;  // 임대가능면적 = 연면적 × 전용률
  estimatedConstructionCost: number; // 만원
  notes: string[];
  scenario: MassingScenario;
}

/** 시설 유형별 주차대수 산정. 시설면적 기준. */
function parkingRequiredOf(rule: MassingScenario["parkingRule"], floorArea: number): number {
  if (rule === "medical") {
    // 주차장법 시행령 별표 1 — 의료시설(병원·의원 제외) 150㎡당 1대
    // 단, 병원/의원/종합병원 등은 시설면적 100㎡당 1대 (지자체 가산 시 0.7~1.5배)
    return Math.ceil(floorArea / 100);
  }
  // 일반 업무시설: 134㎡당 1대 (서울시 조례 기준)
  return Math.ceil(floorArea / 134);
}

/** 한 층 주차 수용 가능 대수 = (대지면적 × 0.4) / 30 (대당 30㎡ 가정). */
function basementFloorsFor(parking: number, parcelArea: number): number {
  const perFloor = Math.max(1, Math.floor((parcelArea * 0.4) / 30));
  return Math.ceil(parking / perFloor);
}

export function compute(parcel: ParcelInput, scenario: MassingScenario = DEFAULT_MEDICAL): MassingResult {
  const z = lookupZoning(parcel.zoneName);
  const notes: string[] = [];
  const bcrLimit = z?.bcr ?? 60;
  const farLimit = z?.far ?? 250;
  if (!z) notes.push(`용도지역 매칭 실패(${parcel.zoneName}) — BCR 60% / FAR 250% 가정 적용`);

  const maxBuild = (parcel.area * bcrLimit) / 100;
  const maxFloorArea = (parcel.area * farLimit) / 100;

  // 지상층수 = floor(연면적 / 층면적). 단, 한 층은 maxBuild 이하.
  const maxFloors = Math.max(1, Math.floor(maxFloorArea / maxBuild));

  const parking = parkingRequiredOf(scenario.parkingRule, maxFloorArea);
  const basements = basementFloorsFor(parking, parcel.area);

  const netRentable = maxFloorArea * scenario.efficiency;
  const py = maxFloorArea / 3.3058; // ㎡ → 평
  const cost = scenario.constructionUnitCost
    ? Math.round(py * scenario.constructionUnitCost)
    : 0;

  if (scenario.buildingType === "medical") {
    notes.push("층고 4.2m — MRI·수술실 가능. 침대용 엘리베이터 ≥1대 권장.");
  }
  if (basements > 5) notes.push(`주차 ${parking}대 수용을 위해 지하 ${basements}층 — 굴토비 부담 큼`);
  if (z && z.zone.includes("녹지")) notes.push("녹지지역 — 의료시설 시행 부적합");

  return {
    pnu: parcel.pnu,
    zoneName: parcel.zoneName,
    area: parcel.area,
    bcrLimit,
    farLimit,
    maxBuildArea: +maxBuild.toFixed(1),
    maxFloorArea: +maxFloorArea.toFixed(1),
    maxFloors,
    parkingRequired: parking,
    basementFloors: basements,
    netRentableArea: +netRentable.toFixed(1),
    estimatedConstructionCost: cost,
    notes,
    scenario,
  };
}
