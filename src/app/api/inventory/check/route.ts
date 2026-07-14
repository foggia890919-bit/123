import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Stock check: by default returns the most recent snapshot per site from the
// scheduled batch (DB query — fast). Pass `?live=1` to bypass cache and trigger
// a real-time scrape via the worker (slow, can take 30s+).

export const maxDuration = 300;

interface ResultRow {
  siteKey: string;
  insuranceCode: string;
  productName: string;
  spec: string | null;
  manufacturer: string | null;
  unitPrice: number | null;
  stock: number | null;
  scrapedAt: string;
}

function isNetworkError(msg: string): boolean {
  return (
    msg === "fetch failed" ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("UND_ERR") ||
    msg.includes("TimeoutError") ||
    msg.includes("The operation was aborted") ||
    msg.includes("network")
  );
}

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

  const codes = Array.isArray(body.codes)
    ? body.codes.filter((c): c is string => typeof c === "string" && /^\d{9,12}$/.test(c))
    : [];
  if (codes.length === 0) {
    return NextResponse.json(
      { error: "codes (string[]) required, must be 9-12 digit insurance codes" },
      { status: 400 }
    );
  }
  const live = req.nextUrl.searchParams.get("live") === "1";
  const sites = Array.isArray(body.sites)
    ? body.sites.filter((s): s is string => typeof s === "string")
    : undefined;

  // Live path proxies to the worker (slow per-code) so cap at 50.
  // Snapshot path is just a DB query; allow up to 1000 codes.
  if (live && codes.length > 50) {
    return NextResponse.json({ error: "max 50 codes per live request" }, { status: 400 });
  }
  if (!live && codes.length > 1000) {
    return NextResponse.json({ error: "max 1000 codes per request" }, { status: 400 });
  }

  if (!live) {
    // DB path — read latest snapshot per (siteKey, insuranceCode, spec).
    // spec 포함: 같은 보험코드 안에 포장단위(30T/500T) 다른 행을 각각 최신 1개씩 반환.
    const rows = await prisma.$queryRaw<ResultRow[]>`
      SELECT DISTINCT ON ("siteKey", "insuranceCode", "spec")
        "siteKey", "insuranceCode", "productName", "spec", "manufacturer",
        "unitPrice", "stock", "scrapedAt"
      FROM "InventorySnapshot"
      WHERE "insuranceCode" = ANY(${codes}::text[])
      ORDER BY "siteKey", "insuranceCode", "spec", "scrapedAt" DESC
    `;
    interface OutRow {
      siteKey: string;
      insuranceCode: string;
      items: Array<{
        insuranceCode: string;
        productName: string;
        spec: string | null;
        manufacturer: string | null;
        unitPrice: number | null;
        stock: number | null;
      }>;
      scrapedAt?: string;
      error?: string;
    }
    const results: OutRow[] = codes.flatMap<OutRow>(code => {
      const matched = rows.filter(r => r.insuranceCode === code);
      if (matched.length === 0) return [];
      return matched.map(r => ({
        siteKey: r.siteKey,
        insuranceCode: code,
        items: [
          {
            insuranceCode: r.insuranceCode,
            productName: r.productName,
            spec: r.spec,
            manufacturer: r.manufacturer,
            unitPrice: r.unitPrice,
            stock: r.stock,
          },
        ],
        scrapedAt: r.scrapedAt,
      }));
    });
    return NextResponse.json({ results, source: "snapshot" });
  }

  // Live fallback path — proxy to worker (Playwright/Chromium on Lightsail).
  // The scrapers use a headless browser and cannot run inline in this API route.
  //
  // Outer try-catch ensures any unexpected synchronous throw (e.g. bad URL
  // construction, AbortSignal unavailable) still produces a JSON response
  // instead of a bare 500 with no body, which the browser reports as a
  // network-level "fetch failed" error.
  try {
    const workerUrl = process.env.WORKER_URL;
    const workerToken = process.env.WORKER_TOKEN;
    if (!workerUrl || !workerToken) {
      return NextResponse.json(
        {
          error:
            "실시간 조회 서버가 설정되지 않았습니다. " +
            "Vercel 환경변수에 WORKER_URL과 WORKER_TOKEN을 설정하고 Lightsail 워커를 실행하세요. " +
            "캐시 데이터는 자동으로 매일 06시/12시/18시(KST)에 갱신됩니다.",
          workerConfigured: false,
        },
        { status: 503 }
      );
    }

    const base = workerUrl.replace(/\/$/, "");

    // Fast reachability pre-flight before the potentially 280-second /scrape call.
    // Caps failure latency at ~5 s when the Lightsail server is down.
    try {
      const health = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!health.ok) {
        return NextResponse.json(
          {
            error:
              `실시간 조회 서버가 응답하지 않습니다 (HTTP ${health.status}). ` +
              "Lightsail 워커 프로세스 상태를 확인하세요.",
          },
          { status: 503 }
        );
      }
    } catch (healthErr) {
      const hmsg = (healthErr as Error).message ?? "";
      return NextResponse.json(
        {
          error: isNetworkError(hmsg)
            ? "실시간 조회 서버에 연결할 수 없습니다. " +
              "Lightsail 워커가 실행 중인지, 방화벽(포트 8080)이 열려 있는지 확인하세요. " +
              "캐시 데이터는 자동으로 매일 06시/12시/18시(KST)에 갱신됩니다."
            : `실시간 조회 서버 연결 확인 중 오류: ${hmsg}`,
        },
        { status: 503 }
      );
    }

    const r = await fetch(`${base}/scrape`, {
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

    // Persist live results to InventorySnapshot so subsequent default-path
    // requests see the data without re-scraping (shared cache for all users).
    if (Array.isArray(data?.results)) {
      const snapshots: Array<{
        siteKey: string;
        insuranceCode: string;
        productName: string | null;
        spec: string | null;
        manufacturer: string | null;
        unitPrice: number | null;
        stock: number | null;
      }> = [];
      for (const row of data.results) {
        if (!row || row.error || !Array.isArray(row.items)) continue;
        for (const item of row.items) {
          if (!row.siteKey || !row.insuranceCode) continue;
          snapshots.push({
            siteKey: row.siteKey,
            insuranceCode: row.insuranceCode,
            productName: item.productName ?? null,
            spec: item.spec ?? null,
            manufacturer: item.manufacturer ?? null,
            unitPrice: item.unitPrice ?? null,
            stock: item.stock ?? null,
          });
        }
      }
      if (snapshots.length > 0) {
        await prisma.inventorySnapshot.createMany({ data: snapshots, skipDuplicates: true }).catch(err => {
          console.error("[inventory/check] persist live snapshots failed:", err);
        });
      }
    }

    return NextResponse.json({ ...data, source: "live" });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    return NextResponse.json(
      {
        error: isNetworkError(msg)
          ? "실시간 조회 서버와의 통신이 끊어졌습니다. Lightsail 워커 상태를 확인하세요."
          : `실시간 조회 중 오류가 발생했습니다: ${msg}`,
      },
      { status: 504 }
    );
  }
}
