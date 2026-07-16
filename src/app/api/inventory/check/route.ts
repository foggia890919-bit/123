import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Stock check: by default returns the most recent snapshot per site from the
// scheduled batch (DB query — fast). Pass `?live=1` to request a real-time scrape.
//
// Live path uses a DB-mediated job queue instead of a direct worker call:
// Vercel cannot reach the office PC (no inbound), so it inserts a RefreshRequest
// row (PENDING) and polls until the PC worker picks it up, scrapes, writes fresh
// InventorySnapshot rows, and flips the request to DONE/ERROR. The response shape
// is identical to the snapshot path so the frontend is unchanged.

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

// SiteResult 형태 (src/lib/stock-cache.ts) 그대로 — 프런트 계약 불변.
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

// 최신 스냅샷을 (siteKey, insuranceCode) 단위로 읽어 프런트 SiteResult 형태로 변환.
// 스냅샷 경로와 라이브 완료(DONE) 경로가 동일한 결과 형태를 반환하도록 공용화.
async function queryLatestSnapshots(codes: string[]): Promise<OutRow[]> {
  const rows = await prisma.$queryRaw<ResultRow[]>`
    SELECT DISTINCT ON ("siteKey", "insuranceCode")
      "siteKey", "insuranceCode", "productName", "spec", "manufacturer",
      "unitPrice", "stock", "scrapedAt"
    FROM "InventorySnapshot"
    WHERE "insuranceCode" = ANY(${codes}::text[])
    ORDER BY "siteKey", "insuranceCode", "scrapedAt" DESC
  `;
  return codes.flatMap<OutRow>(code => {
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
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

  // Live path enqueues one job per request (worker scrapes per-code) so cap at 50.
  // Snapshot path is just a DB query; allow up to 1000 codes.
  if (live && codes.length > 50) {
    return NextResponse.json({ error: "max 50 codes per live request" }, { status: 400 });
  }
  if (!live && codes.length > 1000) {
    return NextResponse.json({ error: "max 1000 codes per request" }, { status: 400 });
  }

  if (!live) {
    // DB path — read latest snapshot per (siteKey, insuranceCode)
    const results = await queryLatestSnapshots(codes);
    return NextResponse.json({ results, source: "snapshot" });
  }

  // ---------------- Live path — DB job queue ----------------
  // 1) 오래된 잔여 요청 정리 (1시간 지난 PENDING/RUNNING → EXPIRED). best effort.
  // 2) RefreshRequest(PENDING) 생성. 사무실 PC 워커가 폴링으로 집어 처리한다.
  // 3) 요청 status 를 폴링 (2초 간격, 최대 240초). DONE 이면 갱신된 스냅샷을 읽어
  //    { results, source: "live" } 로 반환. ERROR/타임아웃은 기존 에러 포맷 유지.
  try {
    // 1) stale 요청 정리
    await prisma.refreshRequest
      .updateMany({
        where: {
          status: { in: ["PENDING", "RUNNING"] },
          createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
        },
        data: { status: "EXPIRED" },
      })
      .catch(err => {
        console.warn("[inventory/check] stale RefreshRequest 정리 실패:", (err as Error).message);
      });

    // 2) 대기줄에 요청 등록
    const request = await prisma.refreshRequest.create({
      data: { codes, sites: sites ?? [], status: "PENDING" },
      select: { id: true, createdAt: true },
    });
    const requestCreatedAt = request.createdAt;

    // 3) 폴링 루프
    const POLL_MS = 2_000;
    const DEADLINE = Date.now() + 240_000;
    while (Date.now() < DEADLINE) {
      await sleep(POLL_MS);
      const row = await prisma.refreshRequest.findUnique({
        where: { id: request.id },
        select: { status: true, error: true },
      });
      if (!row) {
        // 방어적: 정리 배치 등으로 사라졌으면 계속 폴링해봐야 소용 없음.
        return NextResponse.json(
          { error: "재고 요청이 사라졌습니다. 다시 시도해 주세요." },
          { status: 500 }
        );
      }
      if (row.status === "ERROR") {
        return NextResponse.json(
          { error: row.error || "PC 크롤러가 재고 조회 중 오류를 반환했습니다." },
          { status: 502 }
        );
      }
      if (row.status === "DONE") {
        // 워커는 saveSnapshots 완료 후에야 DONE 으로 표시하므로, 이 시점의 스냅샷은
        // 이번 요청 시각(requestCreatedAt) 이후로 갱신된 최신값이다.
        const results = await queryLatestSnapshots(codes);
        const fresh = results.filter(
          r => r.scrapedAt && new Date(r.scrapedAt) >= requestCreatedAt
        ).length;
        console.log(
          `[inventory/check] live DONE ${request.id} — ${results.length} rows (${fresh} fresh)`
        );
        return NextResponse.json({ results, source: "live" });
      }
      // PENDING / RUNNING → 계속 폴링
    }

    // 240초 초과 — 워커가 응답하지 않음
    return NextResponse.json(
      {
        error:
          "PC 크롤러가 응답하지 않습니다. 사무실 PC가 켜져 있는지 확인하세요 " +
          "(자동 갱신은 하루 6번 계속됩니다).",
      },
      { status: 504 }
    );
  } catch (err) {
    const msg = (err as Error).message ?? "";
    return NextResponse.json(
      { error: `실시간 조회 요청 처리 중 오류가 발생했습니다: ${msg}` },
      { status: 500 }
    );
  }
}
