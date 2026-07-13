import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 와이케이팜(파트너) 직영재고 다리 — 도매 재고 스냅샷을 파트너 계약형 rows 로 반환.
// 파트너: POST {KMD_BRIDGE_URL}/api/inventory/bridge-export, Authorization: Bearer {YK_BRIDGE_TOKEN}
// 응답: { ok: true, rows: KmdSnapshotRow[], count } — 파트너가 rows 를 보험코드별로 병합/가공.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const YK_BRIDGE_TOKEN = process.env.YK_BRIDGE_TOKEN;

// 파트너가 기대하는 rows 요소 형태(KmdSnapshotRow)
type BridgeRow = {
  siteKey: string;
  insuranceCode: string;
  stock: number | null;
  unitPrice: number | null;
  scrapedAt: string;
  paymentType: string | null;
  hiraPrice: number | null;
  productName: string | null;
};

// DB 조인 결과(원시)
type RawRow = {
  siteKey: string;
  insuranceCode: string;
  stock: number | null;
  unitPrice: number | null;
  scrapedAt: Date;
  paymentType: string | null;
  hiraPrice: number | null;
  productName: string | null;
};

async function handle() {
  // InventorySnapshot(도매 ibjp/family) × Medication(급여구분/약가/제품명) 조인.
  // - siteKey IN ('ibjp','family')
  // - insuranceCode 실코드만 ('NC:' 접두 제외)
  // - scrapedAt 72시간 이내 (오래된 스냅샷 제외)
  // - Medication.insuranceCode 는 콤마분리 다중코드 → UNNEST + leading-zero 정규화(LTRIM '0')로 매칭
  //   (fill-prices 크론과 동일한 HIRA 코드 정규화 규칙)
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      s."siteKey"        AS "siteKey",
      s."insuranceCode"  AS "insuranceCode",
      s."stock"          AS "stock",
      s."unitPrice"      AS "unitPrice",
      s."scrapedAt"      AS "scrapedAt",
      m."paymentType"    AS "paymentType",
      m."price"          AS "hiraPrice",
      m."productName"    AS "productName"
    FROM "InventorySnapshot" s
    LEFT JOIN LATERAL (
      SELECT med."paymentType", med."price", med."productName"
      FROM "Medication" med,
           UNNEST(string_to_array(med."insuranceCode", ',')) AS code
      WHERE med."insuranceCode" IS NOT NULL
        AND LTRIM(TRIM(code), '0') = LTRIM(TRIM(s."insuranceCode"), '0')
      LIMIT 1
    ) m ON TRUE
    WHERE s."siteKey" IN ('ibjp', 'family')
      AND s."insuranceCode" NOT LIKE 'NC:%'
      AND s."scrapedAt" >= NOW() - INTERVAL '72 hours'
  `;

  const out: BridgeRow[] = rows.map((r) => ({
    siteKey: r.siteKey,
    insuranceCode: r.insuranceCode,
    stock: r.stock ?? null,
    unitPrice: r.unitPrice ?? null,
    scrapedAt: r.scrapedAt instanceof Date ? r.scrapedAt.toISOString() : String(r.scrapedAt),
    paymentType: r.paymentType ?? null,
    hiraPrice: r.hiraPrice ?? null,
    productName: r.productName ?? null,
  }));

  return NextResponse.json({ ok: true, rows: out, count: out.length });
}

async function authorize(req: NextRequest): Promise<NextResponse | null> {
  // 토큰 미설정 시에도 반드시 거부 — 빈 토큰으로 인한 인증 우회 방지
  if (!YK_BRIDGE_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "YK_BRIDGE_TOKEN not configured" },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${YK_BRIDGE_TOKEN}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// 파트너 크론은 POST 로 호출. GET 도 동일 계약으로 허용(수동 점검용).
export async function POST(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  try {
    return await handle();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  try {
    return await handle();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
