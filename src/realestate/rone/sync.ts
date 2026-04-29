import { prisma } from "@/lib/prisma";
import { fetchRone, type RoneQuery } from "./client";

export interface RoneSyncOptions {
  buildingTypes: RoneQuery["buildingType"][];
  yearQuarters: string[]; // ["2024Q4","2025Q1"]
  region?: string;
}

export interface RoneSyncSummary {
  fetched: number;
  upserted: number;
  errors: { buildingType: string; quarter: string; error: string }[];
}

export async function syncRone(opts: RoneSyncOptions): Promise<RoneSyncSummary> {
  const summary: RoneSyncSummary = { fetched: 0, upserted: 0, errors: [] };
  for (const buildingType of opts.buildingTypes) {
    for (const yearQuarter of opts.yearQuarters) {
      try {
        const items = await fetchRone({
          endpoint: "rentRegional",
          buildingType,
          yearQuarter,
          region: opts.region,
        });
        summary.fetched += items.length;
        for (const it of items) {
          if (!it.region) continue;
          await prisma.roneStat.upsert({
            where: {
              buildingType_region_yearQuarter: {
                buildingType: it.buildingType,
                region: it.region,
                yearQuarter: it.yearQuarter,
              },
            },
            create: {
              buildingType: it.buildingType,
              region: it.region,
              regionCode: it.regionCode,
              yearQuarter: it.yearQuarter,
              rentPerM2: it.rentPerM2,
              vacancyRate: it.vacancyRate,
              yieldRate: it.yieldRate,
              capRate: it.capRate,
              raw: it.raw as never,
            },
            update: {
              rentPerM2: it.rentPerM2,
              vacancyRate: it.vacancyRate,
              yieldRate: it.yieldRate,
              capRate: it.capRate,
              raw: it.raw as never,
              fetchedAt: new Date(),
            },
          });
          summary.upserted++;
        }
      } catch (e) {
        summary.errors.push({ buildingType, quarter: yearQuarter, error: (e as Error).message });
      }
    }
  }
  return summary;
}

/** 가장 최근 분기 N개 (현재 시점 기준 역산). */
export function recentQuarters(n: number): string[] {
  const now = new Date();
  const m = now.getMonth(); // 0~11
  let q = Math.floor(m / 3) + 1; // 1~4
  let y = now.getFullYear();
  // 현재 분기는 데이터가 아직 없을 가능성이 크므로 직전 분기부터
  q -= 1;
  if (q === 0) { q = 4; y -= 1; }
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}Q${q}`);
    q -= 1;
    if (q === 0) { q = 4; y -= 1; }
  }
  return out;
}
