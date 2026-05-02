import { prisma } from "@/lib/prisma";
import type { Parcel } from "@prisma/client";
import type { VworldParcel, VworldLandUse } from "./vworld";
import type { BuildingTitleInfo } from "./buildingHub";
import { lookupZoning } from "./zoning";
import type { MassingResult, MassingScenario } from "./massing";

/** V월드 응답 + 용도지역 + 공시지가를 합쳐서 Parcel upsert. */
export async function upsertParcel(
  raw: VworldParcel,
  landuse: VworldLandUse | null,
  officialPrice: { year: string; price: number } | null,
): Promise<Parcel> {
  const zone = landuse?.zones.find(z => z.type === "용도지역");
  const district = landuse?.zones.find(z => z.type === "용도지구");
  const extra = landuse?.zones.find(z => z.type === "용도구역");
  const limits = lookupZoning(zone?.name);

  return prisma.parcel.upsert({
    where: { pnu: raw.pnu },
    create: {
      pnu: raw.pnu,
      jibun: raw.jibun,
      cortarNo: raw.cortarNo,
      sigungu: raw.sigungu,
      area: raw.area,
      landUse: zone?.name,
      landUseDistrict: district?.name,
      landUseExtra: extra?.name,
      bcrLimit: limits?.bcr,
      farLimit: limits?.far,
      officialPrice: officialPrice?.price,
      centerLat: raw.centerLat,
      centerLng: raw.centerLng,
      geometry: raw.geometry as never,
      raw: raw.raw as never,
    },
    update: {
      jibun: raw.jibun,
      cortarNo: raw.cortarNo,
      sigungu: raw.sigungu,
      area: raw.area,
      landUse: zone?.name,
      landUseDistrict: district?.name,
      landUseExtra: extra?.name,
      bcrLimit: limits?.bcr,
      farLimit: limits?.far,
      officialPrice: officialPrice?.price ?? undefined,
      centerLat: raw.centerLat ?? undefined,
      centerLng: raw.centerLng ?? undefined,
      geometry: raw.geometry as never,
      raw: raw.raw as never,
    },
  });
}

export async function upsertBuildingLedgers(parcelId: string, items: BuildingTitleInfo[]) {
  // 표제부는 동별로 여러 행이 올 수 있음. (parcelId, bldgNm) 기준으로 갈음.
  for (const it of items) {
    const existing = await prisma.buildingLedger.findFirst({
      where: { parcelId, bldgNm: it.bldgNm ?? null },
      select: { id: true },
    });
    const data = {
      pnu: it.pnu,
      parcelId,
      bldgNm: it.bldgNm,
      totalFloorArea: it.totalFloorArea,
      buildArea: it.buildArea,
      bcr: it.bcr,
      far: it.far,
      groundFloors: it.groundFloors ?? null,
      undergroundFloors: it.undergroundFloors ?? null,
      mainPurpose: it.mainPurpose,
      structure: it.structure,
      approvedAt: it.approvedAt,
      raw: it.raw as never,
    };
    if (existing) {
      await prisma.buildingLedger.update({
        where: { id: existing.id },
        data: { ...data, fetchedAt: new Date() },
      });
    } else {
      await prisma.buildingLedger.create({ data });
    }
  }
}

export async function saveMassingResult(
  parcelId: string,
  scenario: MassingScenario,
  result: MassingResult,
  extra?: { estimatedAnnualRent?: number; estimatedRoi?: number },
): Promise<string> {
  const created = await prisma.massingResult.create({
    data: {
      parcelId,
      scenario: `${scenario.buildingType}-${scenario.parkingRule}-${scenario.floorHeight}`,
      buildingType: scenario.buildingType,
      floorHeight: scenario.floorHeight,
      efficiency: scenario.efficiency,
      parkingRule: scenario.parkingRule,
      bcrApplied: result.bcrLimit,
      farApplied: result.farLimit,
      maxBuildArea: result.maxBuildArea,
      maxFloorArea: result.maxFloorArea,
      maxFloors: result.maxFloors,
      parkingRequired: result.parkingRequired,
      basementFloors: result.basementFloors,
      netRentableArea: result.netRentableArea,
      estimatedConstructionCost: result.estimatedConstructionCost,
      notes: result.notes,
      estimatedAnnualRent: extra?.estimatedAnnualRent ?? null,
      estimatedRoi: extra?.estimatedRoi ?? null,
    },
    select: { id: true },
  });
  return created.id;
}
