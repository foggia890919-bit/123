import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isNextResponse, requireRole } from "@/lib/auth-guard";

// GET /api/admin/inventory-status
// Returns recent ScrapeJob rows + latest InventorySnapshot timestamp per site.
// Requires BIZ or ADMIN role.

export async function GET(req: NextRequest) {
  const auth = await requireRole("BIZ");
  if (isNextResponse(auth)) return auth;

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? "20", 10) || 20, 1), 100);

  const [jobs, sites, snapshotMeta] = await Promise.all([
    // Most recent N scrape jobs across all sites
    prisma.scrapeJob.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    }),
    // All registered wholesale sites
    prisma.wholesaleSite.findMany({
      orderBy: { key: "asc" },
    }),
    // Latest scrapedAt per site
    prisma.$queryRaw<Array<{ siteKey: string; latestAt: Date; totalCount: bigint }>>`
      SELECT
        "siteKey",
        MAX("scrapedAt")  AS "latestAt",
        COUNT(*)::bigint  AS "totalCount"
      FROM "InventorySnapshot"
      GROUP BY "siteKey"
    `,
  ]);

  const metaMap = new Map(snapshotMeta.map(r => [r.siteKey, r]));

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
      };
    }),
  });
}
