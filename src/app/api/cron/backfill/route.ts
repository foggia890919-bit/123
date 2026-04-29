import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runBackfillChunk } from "@/lib/naver/backfill";

const CRON_SECRET = process.env.CRON_SECRET;
export const maxDuration = 300;

/**
 * 5분마다 호출되어 PENDING/FAILED 인 백필 잡을 한 번에 7일씩 진행시킴.
 * 사용자가 UI 안 켜놔도 백그라운드에서 자동으로 1년치 차곡차곡 채워짐.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const jobs = await prisma.backfillJob.findMany({
    where: { status: { in: ["PENDING", "FAILED"] } },
    orderBy: { updatedAt: "asc" },
    take: 5,
  });
  const results = [];
  for (const job of jobs) {
    try {
      const r = await runBackfillChunk(job.id, 7);
      results.push(r);
    } catch (err) {
      results.push({ jobId: job.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}
