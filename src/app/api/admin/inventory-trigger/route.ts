import { NextRequest, NextResponse } from "next/server";
import { isNextResponse, requireRole } from "@/lib/auth-guard";

/**
 * POST /api/admin/inventory-trigger
 *
 * Server-side proxy that forwards a "start batch now" request to the
 * inventory worker's /scrape-batch endpoint.  Requires BIZ or ADMIN role.
 *
 * Query params forwarded to worker:
 *   ?limit=N        only scrape first N codes (smoke test)
 *   ?sites=a,b      only these adapter keys
 *   ?mode=label     ScrapeJob.mode label (default "manual")
 *
 * Also exposes GET for a quick worker health + credential check that the
 * admin UI can use to surface diagnostic info without triggering a run.
 */

async function getWorkerConfig(): Promise<
  { ok: false; reason: string } | { ok: true; url: string; token: string }
> {
  const url = process.env.WORKER_URL?.replace(/\/$/, "");
  const token = process.env.WORKER_TOKEN;
  if (!url) return { ok: false, reason: "WORKER_URL 환경변수가 설정되지 않았습니다." };
  if (!token) return { ok: false, reason: "WORKER_TOKEN 환경변수가 설정되지 않았습니다." };
  return { ok: true, url, token };
}

export async function GET(req: NextRequest) {
  const auth = await requireRole("BIZ");
  if (isNextResponse(auth)) return auth;

  const cfg = await getWorkerConfig();
  if (!cfg.ok) {
    return NextResponse.json({
      workerConfigured: false,
      reason: cfg.reason,
      sites: [],
    });
  }

  try {
    const r = await fetch(`${cfg.url}/sites`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) {
      return NextResponse.json({
        workerConfigured: true,
        workerReachable: false,
        reason: `Worker responded ${r.status}`,
        sites: [],
      });
    }
    const data = await r.json();

    // Also fetch health to see if a job is already running
    let health: { jobRunning?: boolean; db?: boolean } = {};
    try {
      const hr = await fetch(`${cfg.url}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (hr.ok) health = await hr.json();
    } catch {
      // health is best-effort
    }

    return NextResponse.json({
      workerConfigured: true,
      workerReachable: true,
      jobRunning: health.jobRunning ?? null,
      dbConfigured: health.db ?? null,
      sites: Array.isArray(data.sites) ? data.sites : [],
    });
  } catch (err) {
    return NextResponse.json({
      workerConfigured: true,
      workerReachable: false,
      reason: (err as Error).message,
      sites: [],
    });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("BIZ");
  if (isNextResponse(auth)) return auth;

  const cfg = await getWorkerConfig();
  if (!cfg.ok) {
    return NextResponse.json({ error: cfg.reason }, { status: 503 });
  }

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const sitesRaw = req.nextUrl.searchParams.get("sites");
  const modeRaw = req.nextUrl.searchParams.get("mode") ?? "manual";
  const params = new URLSearchParams();
  if (limitRaw) params.set("limit", limitRaw);
  if (sitesRaw) params.set("sites", sitesRaw);
  params.set("mode", modeRaw);

  try {
    const r = await fetch(`${cfg.url}/scrape-batch?${params}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(
        { error: `Worker responded ${r.status}: ${JSON.stringify(body)}` },
        { status: r.status === 409 ? 409 : 502 }
      );
    }
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: `Worker unreachable: ${(err as Error).message}` },
      { status: 504 }
    );
  }
}
