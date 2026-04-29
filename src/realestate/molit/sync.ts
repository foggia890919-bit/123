import { prisma } from "@/lib/prisma";
import { fetchMolitTrades, type MolitEndpoint } from "./client";

export interface SyncRange {
  endpoint: MolitEndpoint;
  lawdCds: string[];
  /** 동기화할 월 개수 (현재 월 기준 N개월 이전까지). 기본 6개월. */
  months?: number;
}

export interface SyncSummary {
  fetched: number;
  inserted: number;
  skipped: number;
  errors: { lawdCd: string; ymd: string; error: string }[];
}

export async function syncMolit(range: SyncRange): Promise<SyncSummary> {
  const months = range.months ?? 6;
  const ymds = recentYmds(months);
  const summary: SyncSummary = { fetched: 0, inserted: 0, skipped: 0, errors: [] };

  for (const lawdCd of range.lawdCds) {
    for (const ymd of ymds) {
      try {
        const items = await fetchMolitTrades({ endpoint: range.endpoint, lawdCd, dealYmd: ymd });
        summary.fetched += items.length;
        for (const it of items) {
          // 중복 방지: (dealKind, lawdCd, dealYearMonth, buildingName, areaM2, floor, dealDay, amount)
          const dup = await prisma.molitTrade.findFirst({
            where: {
              dealKind: it.dealKind,
              lawdCd: it.lawdCd,
              dealYearMonth: it.dealYearMonth,
              dealDay: it.dealDay ?? undefined,
              buildingName: it.buildingName ?? undefined,
              areaM2: it.areaM2 ?? undefined,
              amount: it.amount ?? undefined,
            },
            select: { id: true },
          });
          if (dup) {
            summary.skipped++;
            continue;
          }
          await prisma.molitTrade.create({
            data: {
              dealKind: it.dealKind,
              tradeType: it.tradeType,
              region: it.region,
              lawdCd: it.lawdCd,
              dealYearMonth: it.dealYearMonth,
              dealDay: it.dealDay ?? null,
              buildingName: it.buildingName ?? null,
              areaM2: it.areaM2 ?? null,
              floor: it.floor ?? null,
              buildYear: it.buildYear ?? null,
              amount: it.amount ?? null,
              deposit: it.deposit ?? null,
              monthlyRent: it.monthlyRent ?? null,
              raw: it.raw as never,
            },
          });
          summary.inserted++;
        }
      } catch (e) {
        summary.errors.push({ lawdCd, ymd, error: (e as Error).message });
      }
    }
  }
  return summary;
}

function recentYmds(months: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push(ymd);
  }
  return out;
}
