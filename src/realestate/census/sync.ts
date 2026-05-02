import { prisma } from "@/lib/prisma";
import { fetchCensus } from "./client";

export interface CensusSyncSummary {
  fetched: number;
  upserted: number;
  errors: { cortarNo: string; ym: string; error: string }[];
}

export async function syncCensus(opts: {
  cortarNos: string[];
  months?: number; // 최근 N개월
}): Promise<CensusSyncSummary> {
  const summary: CensusSyncSummary = { fetched: 0, upserted: 0, errors: [] };
  const ymds = recentYms(opts.months ?? 3);

  for (const cortarNo of opts.cortarNos) {
    for (const yearMonth of ymds) {
      try {
        const item = await fetchCensus({ cortarNo, yearMonth });
        if (!item) continue;
        summary.fetched++;
        await prisma.census.upsert({
          where: { cortarNo_yearMonth: { cortarNo, yearMonth } },
          create: {
            cortarNo,
            yearMonth,
            totalPop: item.totalPop,
            households: item.households,
            age0_9: item.age0_9,
            age10_19: item.age10_19,
            age20_29: item.age20_29,
            age30_39: item.age30_39,
            age40_49: item.age40_49,
            age50_59: item.age50_59,
            age60_69: item.age60_69,
            age70Plus: item.age70Plus,
            malePop: item.malePop,
            femalePop: item.femalePop,
            raw: item.raw as never,
          },
          update: {
            totalPop: item.totalPop ?? undefined,
            households: item.households ?? undefined,
            age0_9: item.age0_9 ?? undefined,
            age10_19: item.age10_19 ?? undefined,
            age20_29: item.age20_29 ?? undefined,
            age30_39: item.age30_39 ?? undefined,
            age40_49: item.age40_49 ?? undefined,
            age50_59: item.age50_59 ?? undefined,
            age60_69: item.age60_69 ?? undefined,
            age70Plus: item.age70Plus ?? undefined,
            malePop: item.malePop ?? undefined,
            femalePop: item.femalePop ?? undefined,
            fetchedAt: new Date(),
          },
        });
        summary.upserted++;
      } catch (e) {
        summary.errors.push({ cortarNo, ym: yearMonth, error: (e as Error).message });
      }
    }
  }
  return summary;
}

function recentYms(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  // 인구통계는 보통 1~2개월 지연이라 직전 달부터
  d.setMonth(d.getMonth() - 1);
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}
