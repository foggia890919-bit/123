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
    // DB path — read latest snapshot per (siteKey, insuranceCode)
    const rows = await prisma.$queryRaw<ResultRow[]>`
      SELECT DISTINCT ON ("siteKey", "insuranceCode")
        "siteKey", "insuranceCode", "productName", "spec", "manufacturer",
        "unitPrice", "stock", "scrapedAt"
      FROM "InventorySnapshot"
      WHERE "insuranceCode" = ANY(${codes}::text[])
      ORDER BY "siteKey", "insuranceCode", "scrapedAt" DESC
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
      if (matched.length === 0) return [{ siteKey: "", insuranceCode: code, items: [], error: "no snapshot yet" }];
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

  // Live fallback path — proxy to worker
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
        await prisma.inventorySnapshot.createMany({ data: snapshots }).catch(err => {
          console.error("[inventory/check] persist live snapshots failed:", err);
        });
      }
    }

    return NextResponse.json({ ...data, source: "live" });
  } catch (err) {
    return NextResponse.json(
      { error: `worker unreachable: ${(err as Error).message}` },
      { status: 504 }
    );
  }
}
