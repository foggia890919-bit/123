import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Real-time stock check: proxies to the worker running in Korea.
// Worker URL + token are set in Vercel env (WORKER_URL, WORKER_TOKEN).

// Vercel Pro tier max — Playwright across 5 sites can take a while on cold sessions.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { codes?: unknown; sites?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const codes = Array.isArray(body.codes) ? body.codes.filter((c): c is string => typeof c === "string" && /^\d{9,12}$/.test(c)) : [];
  if (codes.length === 0) {
    return NextResponse.json({ error: "codes (string[]) required, must be 9-12 digit insurance codes" }, { status: 400 });
  }
  if (codes.length > 50) {
    return NextResponse.json({ error: "max 50 codes per request" }, { status: 400 });
  }

  const sites = Array.isArray(body.sites) ? body.sites.filter((s): s is string => typeof s === "string") : undefined;

  const workerUrl = process.env.WORKER_URL;
  const workerToken = process.env.WORKER_TOKEN;
  if (!workerUrl || !workerToken) {
    return NextResponse.json(
      { error: "scraper worker not configured (set WORKER_URL and WORKER_TOKEN)" },
      { status: 503 }
    );
  }

  try {
    const r = await fetch(`${workerUrl.replace(/\/$/, "")}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ codes, sites }),
      signal: AbortSignal.timeout(280_000),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return NextResponse.json(
        { error: `worker error ${r.status}: ${text.slice(0, 500)}` },
        { status: 502 }
      );
    }
    const data = await r.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: `worker unreachable: ${(err as Error).message}` },
      { status: 504 }
    );
  }
}
