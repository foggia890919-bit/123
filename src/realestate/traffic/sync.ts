import { prisma } from "@/lib/prisma";
import { fetchDailyRidership, fetchStations } from "./subway";

export interface SubwaySyncSummary {
  stationsFetched: number;
  stationsUpserted: number;
  ridershipDays: number;
  ridershipRows: number;
  errors: { context: string; error: string }[];
}

/**
 * 1) 역사 마스터 (좌표) 갱신.
 * 2) 최근 N일 일별 승하차를 합산해 월간 통계로 SubwayRidership에 저장.
 */
export async function syncSubway(opts: {
  days?: number;        // 기본 30
  yearMonth?: string;   // 미지정 시 가장 최근의 가능한 월(전월) 사용
} = {}): Promise<SubwaySyncSummary> {
  const summary: SubwaySyncSummary = {
    stationsFetched: 0, stationsUpserted: 0,
    ridershipDays: 0, ridershipRows: 0,
    errors: [],
  };

  // 1) 역사 마스터 — 한 번에 끌어오면 큼 (700+). 검색 페이지네이션 대신 빈 검색으로 전체 조회 시도.
  try {
    const stations = await fetchStations({ startIndex: 1, endIndex: 1000 });
    summary.stationsFetched = stations.length;
    for (const s of stations) {
      await prisma.subwayStation.upsert({
        where: { externalId: s.externalId },
        create: {
          externalId: s.externalId,
          name: s.name,
          lineNumber: s.lineNumber,
          latitude: s.latitude,
          longitude: s.longitude,
          raw: s.raw as never,
        },
        update: {
          name: s.name,
          lineNumber: s.lineNumber,
          latitude: s.latitude,
          longitude: s.longitude,
          fetchedAt: new Date(),
        },
      });
      summary.stationsUpserted++;
    }
  } catch (e) {
    summary.errors.push({ context: "stations", error: (e as Error).message });
  }

  // 2) 일별 승하차 → 월 합계로 정규화
  const days = opts.days ?? 30;
  const yearMonth = opts.yearMonth ?? defaultMonth();
  const targetDays = enumerateDaysInMonth(yearMonth, days);

  type Bucket = { stationName: string; lineNumber: string; ride: number; alight: number };
  const monthly = new Map<string, Bucket>();

  for (const ymd of targetDays) {
    try {
      const rows = await fetchDailyRidership(ymd);
      summary.ridershipDays++;
      summary.ridershipRows += rows.length;
      for (const r of rows) {
        const key = `${r.lineNumber}|${r.stationName}`;
        const cur = monthly.get(key) ?? { stationName: r.stationName, lineNumber: r.lineNumber, ride: 0, alight: 0 };
        cur.ride += r.rideCount;
        cur.alight += r.alightCount;
        monthly.set(key, cur);
      }
    } catch (e) {
      summary.errors.push({ context: `daily ${ymd}`, error: (e as Error).message });
    }
  }

  // 3) 월 합계 → SubwayRidership upsert (역명+노선으로 SubwayStation 매칭)
  for (const [, b] of monthly) {
    const station = await prisma.subwayStation.findFirst({
      where: { name: b.stationName, lineNumber: { contains: b.lineNumber.replace(/[^\d]/g, "") } },
    }) ?? await prisma.subwayStation.findFirst({ where: { name: b.stationName } });
    if (!station) continue;
    await prisma.subwayRidership.upsert({
      where: { stationId_yearMonth: { stationId: station.id, yearMonth } },
      create: {
        stationId: station.id,
        yearMonth,
        rideCount: b.ride,
        alightCount: b.alight,
      },
      update: {
        rideCount: b.ride,
        alightCount: b.alight,
        fetchedAt: new Date(),
      },
    });
  }

  return summary;
}

function defaultMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1); // 보통 1~2주 지연
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function enumerateDaysInMonth(yearMonth: string, maxDays: number): string[] {
  const y = +yearMonth.slice(0, 4);
  const m = +yearMonth.slice(4, 6) - 1;
  const last = new Date(y, m + 1, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= Math.min(last, maxDays); d++) {
    out.push(`${y}${String(m + 1).padStart(2, "0")}${String(d).padStart(2, "0")}`);
  }
  return out;
}
