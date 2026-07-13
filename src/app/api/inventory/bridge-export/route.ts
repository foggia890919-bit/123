import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_ADAPTERS, DISABLED_SITES } from "@/scrapers/adapters";

// 재고 다리 — 벌크 export (약국몰 PULL 전용, read-only).
//
// 약국몰(ykpharm)이 공유 토큰 YK_BRIDGE_TOKEN 으로 인증해 호출한다.
// 스케줄 배치가 쌓아둔 "사이트×보험코드당 최신 스냅샷"을 DB에서만 읽어 반환한다.
// 신규 크롤(워커 호출)은 절대 트리거하지 않는다 — 순수 DB 조회.
//
// 인증: Authorization: Bearer <YK_BRIDGE_TOKEN>
//   - env YK_BRIDGE_TOKEN 미설정  → 503 (다리 비활성)
//   - 토큰 불일치                 → 401
//
// 옵션:
//   ?sites=ibjp,family   대상 사이트 제한(미지정 시 활성 어댑터 전체)
//   ?since=<ISO>         그 시각 이후 scrapedAt 최신 스냅샷만
//   body { codes?: [] }  주면 그 보험코드만, 없으면 전체(상한 방어)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 전체 export 시 폭주 방어 상한.
const MAX_ROWS = 20_000;

interface ExportRow {
  siteKey: string;
  insuranceCode: string;
  stock: number | null;
  unitPrice: number | null;
  scrapedAt: Date;
  paymentType: string | null;
  hiraPrice: number | null;
  productName: string | null;
}

// 상수시간 비교. 길이가 다르면 timingSafeEqual 이 throw 하므로 먼저 걸러낸다.
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// 활성 대상 사이트 = 등록 어댑터 중 DISABLED_SITES 제외 (상수 하드코딩 금지, index.ts 기준 동적).
function activeSites(): string[] {
  return Object.keys(ALL_ADAPTERS).filter((k) => !DISABLED_SITES.has(k));
}

export async function POST(req: NextRequest) {
  // 1) 다리 활성 여부 — env 없으면 503
  const expectedToken = process.env.YK_BRIDGE_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { ok: false, error: "재고 다리가 비활성 상태입니다 (YK_BRIDGE_TOKEN 미설정)." },
      { status: 503 }
    );
  }

  // 2) Bearer 토큰 상수시간 비교
  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  if (!provided || !tokensMatch(provided, expectedToken)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    // 3) 대상 사이트 — 활성 집합 ∩ 요청(?sites=). 요청이 비활성/미등록이면 자동 제외.
    const active = new Set(activeSites());
    const sitesParam = req.nextUrl.searchParams.get("sites");
    let targetSites: string[];
    if (sitesParam) {
      targetSites = sitesParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => active.has(s));
    } else {
      targetSites = [...active];
    }

    // 4) ?since= 파싱 (있으면 유효성 검사)
    const sinceParam = req.nextUrl.searchParams.get("since");
    let sinceDate: Date | undefined;
    if (sinceParam) {
      const d = new Date(sinceParam);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { ok: false, error: "invalid 'since' (ISO datetime required)" },
          { status: 400 }
        );
      }
      sinceDate = d;
    }

    // 5) body { codes? } — 주면 그 코드만, 없으면 전체
    let codeFilter: string[] | undefined;
    try {
      const body = (await req.json()) as { codes?: unknown };
      if (Array.isArray(body?.codes)) {
        const valid = body.codes.filter(
          (c): c is string => typeof c === "string" && /^\d{9,12}$/.test(c)
        );
        if (valid.length > 0) codeFilter = valid;
      }
    } catch {
      // body 없음/비JSON → 전체 export 로 진행
    }

    // 대상 사이트가 하나도 없으면 즉시 빈 결과 (쿼리 생략)
    if (targetSites.length === 0) {
      return NextResponse.json({ ok: true, updatedAt: new Date().toISOString(), rows: [] });
    }

    // 6) 최신 스냅샷 조회 (DISTINCT ON) + Medication LEFT JOIN.
    //    check/route.ts 의 "사이트×보험코드당 최신 스냅샷" 쿼리를 재사용하되,
    //    Medication 을 insuranceCode 로 붙여 paymentType/price(→hiraPrice) 를 부착한다.
    //    Medication 은 같은 insuranceCode 가 복수일 수 있어 최신(updatedAt) 1건으로 dedupe.
    const conditions: Prisma.Sql[] = [
      Prisma.sql`s."siteKey" = ANY(${targetSites}::text[])`,
    ];
    if (codeFilter) {
      conditions.push(Prisma.sql`s."insuranceCode" = ANY(${codeFilter}::text[])`);
    }
    if (sinceDate) {
      conditions.push(Prisma.sql`s."scrapedAt" >= ${sinceDate}`);
    }
    const whereSql = Prisma.join(conditions, " AND ");

    const rows = await prisma.$queryRaw<ExportRow[]>(Prisma.sql`
      WITH latest AS (
        SELECT DISTINCT ON (s."siteKey", s."insuranceCode")
          s."siteKey", s."insuranceCode", s."stock", s."unitPrice",
          s."scrapedAt", s."productName"
        FROM "InventorySnapshot" s
        WHERE ${whereSql}
        ORDER BY s."siteKey", s."insuranceCode", s."scrapedAt" DESC
        LIMIT ${MAX_ROWS}
      ),
      med AS (
        SELECT DISTINCT ON ("insuranceCode")
          "insuranceCode", "paymentType", "price"
        FROM "Medication"
        WHERE "insuranceCode" IN (SELECT "insuranceCode" FROM latest)
        ORDER BY "insuranceCode", "updatedAt" DESC
      )
      SELECT
        l."siteKey", l."insuranceCode", l."stock", l."unitPrice", l."scrapedAt",
        m."paymentType" AS "paymentType",
        m."price" AS "hiraPrice",
        l."productName"
      FROM latest l
      LEFT JOIN med m ON m."insuranceCode" = l."insuranceCode"
    `);

    // updatedAt = 결과 중 가장 최근 scrapedAt (데이터 신선도 기준). 비면 now().
    let newest = 0;
    const outRows = rows.map((r) => {
      const t = r.scrapedAt instanceof Date ? r.scrapedAt.getTime() : new Date(r.scrapedAt).getTime();
      if (t > newest) newest = t;
      return {
        siteKey: r.siteKey,
        insuranceCode: r.insuranceCode,
        stock: r.stock,
        unitPrice: r.unitPrice,
        scrapedAt: new Date(t).toISOString(),
        paymentType: r.paymentType,
        hiraPrice: r.hiraPrice,
        productName: r.productName,
      };
    });
    const updatedAt = newest > 0 ? new Date(newest).toISOString() : new Date().toISOString();

    return NextResponse.json({ ok: true, updatedAt, rows: outRows });
  } catch (err) {
    console.error("[inventory/bridge-export] failed:", (err as Error).message);
    return NextResponse.json({ ok: false, error: "export failed" }, { status: 500 });
  }
}
