import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isNextResponse, requireRole } from "@/lib/auth-guard";

// GET /api/admin/inventory-status
// Returns recent ScrapeJob rows + latest InventorySnapshot timestamp per site
// + a self-diagnosis block so the admin UI can surface exactly why snapshots
// are empty without the user having to guess.
// Requires BIZ or ADMIN role.

export async function GET(req: NextRequest) {
  const auth = await requireRole("BIZ");
  if (isNextResponse(auth)) return auth;

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "20", 10) || 20, 1), 100);

  // ── Check whether the DB tables actually exist ──────────────────────────
  // If a migration was never applied the raw query below would throw; we catch
  // that and return a diag-only response so the UI can surface a clear message.
  let tableExists = true;
  try {
    await prisma.$queryRaw`SELECT 1 FROM "InventorySnapshot" LIMIT 1`;
  } catch {
    tableExists = false;
  }

  if (!tableExists) {
    return NextResponse.json({
      jobs: [],
      sites: [],
      diag: {
        tableExists: false,
        scrapeJobCount24h: 0,
        scrapeJobFailedCount24h: 0,
        scrapeJobSuccessCount24h: 0,
        snapshotCount24h: 0,
        workerEnvConfigured: !!(process.env.WORKER_URL && process.env.WORKER_TOKEN),
        diagMessage:
          "InventorySnapshot 테이블이 없습니다. Supabase에서 _MASTER_MIGRATION.sql을 실행해주세요.",
      },
    });
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [jobs, sites, snapshotMeta, recentJobStats, snapshot24h] = await Promise.all([
    // Most recent N scrape jobs across all sites
    prisma.scrapeJob.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    }),

    // All registered wholesale sites
    prisma.wholesaleSite.findMany({
      orderBy: { key: "asc" },
    }),

    // Latest scrapedAt + total count per site (all time)
    prisma.$queryRaw<Array<{ siteKey: string; latestAt: Date; totalCount: bigint }>>`
      SELECT
        "siteKey",
        MAX("scrapedAt")  AS "latestAt",
        COUNT(*)::bigint  AS "totalCount"
      FROM "InventorySnapshot"
      GROUP BY "siteKey"
    `,

    // Last-24h ScrapeJob summary
    prisma.scrapeJob.findMany({
      where: { startedAt: { gte: since24h } },
      select: { finishedAt: true, error: true, doneCodes: true, totalCodes: true },
    }),

    // Last-24h InventorySnapshot count per site
    prisma.$queryRaw<Array<{ siteKey: string; cnt: bigint }>>`
      SELECT "siteKey", COUNT(*)::bigint AS cnt
      FROM "InventorySnapshot"
      WHERE "scrapedAt" >= ${since24h}
      GROUP BY "siteKey"
    `,
  ]);

  const metaMap = new Map(snapshotMeta.map(r => [r.siteKey, r]));
  const snap24hMap = new Map(snapshot24h.map(r => [r.siteKey, Number(r.cnt)]));

  // ── Build self-diagnosis block ─────────────────────────────────────────
  const workerEnvConfigured = !!(process.env.WORKER_URL && process.env.WORKER_TOKEN);
  const totalJobs24h = recentJobStats.length;
  const successJobs24h = recentJobStats.filter(j => j.finishedAt && !j.error).length;
  const failedJobs24h = recentJobStats.filter(j => j.error).length;
  const totalSnaps24h = snapshot24h.reduce((s, r) => s + Number(r.cnt), 0);

  let diagMessage: string;
  if (totalJobs24h === 0) {
    diagMessage = workerEnvConfigured
      ? "Worker 환경변수는 설정됐지만 24시간 내 ScrapeJob이 없습니다. Worker 프로세스가 실행 중인지 확인하세요."
      : "24시간 내 ScrapeJob이 없습니다. Worker(Lightsail)가 실행되지 않았거나 WORKER_URL / WORKER_TOKEN이 설정되지 않았습니다.";
  } else if (successJobs24h === 0) {
    const lastError = jobs.find(j => j.error)?.error ?? "알 수 없음";
    diagMessage = `최근 24h ${totalJobs24h}건 시도 중 성공 0건. 자격증명 또는 사이트 이슈. 마지막 에러: ${lastError.slice(0, 200)}`;
  } else if (totalSnaps24h === 0) {
    diagMessage =
      "ScrapeJob은 성공했지만 InventorySnapshot이 저장되지 않았습니다. 어댑터 파싱 결함 또는 Worker의 DATABASE_URL 미설정 가능성.";
  } else {
    diagMessage = `정상. 최근 24h ${totalSnaps24h.toLocaleString()}건 스냅샷 저장됨.`;
  }

  return NextResponse.json({
    jobs: jobs.map(j => ({
      id: j.id,
      siteKey: j.siteKey,
      mode: j.mode,
      totalCodes: j.totalCodes,
      doneCodes: j.doneCodes,
      failedCodes: j.failedCodes,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      error: j.error,
      successRate:
        j.totalCodes > 0
          ? Math.round(((j.doneCodes) / j.totalCodes) * 100)
          : null,
      durationMs:
        j.finishedAt
          ? j.finishedAt.getTime() - j.startedAt.getTime()
          : null,
    })),
    sites: sites.map(s => {
      const meta = metaMap.get(s.key);
      return {
        key: s.key,
        name: s.name,
        active: s.active,
        latestSnapshotAt: meta?.latestAt ?? null,
        snapshotCount: meta ? Number(meta.totalCount) : 0,
        snapshotCount24h: snap24hMap.get(s.key) ?? 0,
      };
    }),
    diag: {
      tableExists: true,
      scrapeJobCount24h: totalJobs24h,
      scrapeJobSuccessCount24h: successJobs24h,
      scrapeJobFailedCount24h: failedJobs24h,
      snapshotCount24h: totalSnaps24h,
      workerEnvConfigured,
      diagMessage,
    },
  });
}
