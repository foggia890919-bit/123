import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 와이케이팜(파트너) 직영재고 다리 — 도매 재고 스냅샷을 파트너 계약형 rows 로 반환.
// 파트너: POST {KMD_BRIDGE_URL}/api/inventory/bridge-export, Authorization: Bearer {YK_BRIDGE_TOKEN}
// 응답: { ok: true, count, rows: KmdSnapshotRow[] }
//
// 구현 노트:
// - SQL 조인(UNNEST+LTRIM LATERAL)은 인덱스를 못 타서 타임아웃 → 단순 쿼리 2번 + JS 조합.
// - 응답 크기 절감(Vercel 4.5MB 제한 대비): 같은 보험코드의 두 사이트 행은 매입가 최저
//   1행으로 병합(파트너 mergeToYkStock 과 동일 규칙), productName 은 null(파트너 미사용).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const YK_BRIDGE_TOKEN = process.env.YK_BRIDGE_TOKEN;

// 동가일 때 사이트 우선순위: 백제(ibjp) > 패밀리(family) — 파트너와 동일
const SITE_PRIORITY: Record<string, number> = { ibjp: 2, family: 1 };

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

type SnapRow = {
  siteKey: string;
  insuranceCode: string;
  stock: number | null;
  unitPrice: number | null;
  scrapedAt: Date;
};

type MedMeta = { price: number | null; paymentType: string | null };

// leading-zero 정규화 (fill-prices 크론과 동일한 HIRA 코드 매칭 규칙)
function normCode(code: string): string {
  return code.trim().replace(/^0+/, "");
}

// Medication.insuranceCode(콤마분리 다중코드) → 정규화코드 → { price, paymentType } 맵
function buildMedMap(
  meds: { insuranceCode: string | null; price: number | null; paymentType: string | null }[]
): Map<string, MedMeta> {
  const map = new Map<string, MedMeta>();
  for (const m of meds) {
    if (!m.insuranceCode) continue;
    for (const part of m.insuranceCode.split(",")) {
      const code = normCode(part);
      if (!code) continue;
      const existing = map.get(code);
      // 첫 매칭 유지하되, 기존 항목에 약가가 없고 새 항목에 있으면 교체
      if (!existing || (existing.price == null && m.price != null)) {
        map.set(code, { price: m.price, paymentType: m.paymentType });
      }
    }
  }
  return map;
}

/**
 * 같은 보험코드의 사이트별 스냅샷을 1행으로 병합 — 파트너 mergeToYkStock 과 동일 규칙:
 * 재고>0 & 매입가 有 중 매입가 최저 → 동가면 재고 많은 쪽 → ibjp>family.
 * 재고 전무면 최신 scrapedAt 행을 대표로 보존(파트너가 재고0 처리).
 */
function pickBest(list: SnapRow[]): SnapRow {
  const inStock = list.filter((r) => (r.stock ?? 0) > 0 && r.unitPrice != null);
  if (inStock.length) {
    let picked = inStock[0];
    for (const r of inStock.slice(1)) {
      const rp = r.unitPrice as number;
      const bp = picked.unitPrice as number;
      if (rp < bp) picked = r;
      else if (rp === bp) {
        const rs = r.stock ?? 0;
        const bs = picked.stock ?? 0;
        if (rs > bs) picked = r;
        else if (rs === bs && (SITE_PRIORITY[r.siteKey] || 0) > (SITE_PRIORITY[picked.siteKey] || 0)) picked = r;
      }
    }
    return picked;
  }
  // 재고 전무 → 최신 스냅샷을 대표로 (동시각이면 ibjp 우선)
  let picked = list[0];
  for (const r of list.slice(1)) {
    if (r.scrapedAt > picked.scrapedAt) picked = r;
    else if (
      r.scrapedAt.getTime() === picked.scrapedAt.getTime() &&
      (SITE_PRIORITY[r.siteKey] || 0) > (SITE_PRIORITY[picked.siteKey] || 0)
    ) {
      picked = r;
    }
  }
  return picked;
}

async function handle() {
  // 쿼리 A: 도매 스냅샷 (ibjp/family, 실코드만, 72시간 이내, 재고/매입가 중 하나라도 있는 행)
  const snapshots = await prisma.$queryRaw<SnapRow[]>`
    SELECT "siteKey", "insuranceCode", "stock", "unitPrice", "scrapedAt"
    FROM "InventorySnapshot"
    WHERE "siteKey" IN ('ibjp', 'family')
      AND "insuranceCode" NOT LIKE 'NC:%'
      AND "scrapedAt" >= NOW() - INTERVAL '72 hours'
      AND ("stock" IS NOT NULL OR "unitPrice" IS NOT NULL)
  `;

  // 쿼리 B: 약품 메타 (급여구분/약가)
  const meds = await prisma.medication.findMany({
    where: { insuranceCode: { not: null } },
    select: { insuranceCode: true, price: true, paymentType: true },
  });
  const medMap = buildMedMap(meds);

  // 보험코드(트림)별 그룹핑 → 사이트 병합
  const byCode = new Map<string, SnapRow[]>();
  for (const r of snapshots) {
    const code = r.insuranceCode.trim();
    if (!code) continue;
    const list = byCode.get(code);
    if (list) list.push(r);
    else byCode.set(code, [r]);
  }

  const rows: BridgeRow[] = [];
  for (const [code, list] of byCode) {
    const picked = list.length === 1 ? list[0] : pickBest(list);
    const meta = medMap.get(normCode(code));
    rows.push({
      siteKey: picked.siteKey,
      insuranceCode: code,
      stock: picked.stock ?? null,
      unitPrice: picked.unitPrice ?? null,
      scrapedAt: picked.scrapedAt instanceof Date ? picked.scrapedAt.toISOString() : String(picked.scrapedAt),
      paymentType: meta?.paymentType ?? null,
      hiraPrice: meta?.price ?? null,
      productName: null, // 파트너 시트에 미사용 — 응답 크기 절감
    });
  }

  return NextResponse.json({ ok: true, count: rows.length, rows });
}

function authorize(req: NextRequest): NextResponse | null {
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
  const denied = authorize(req);
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
  const denied = authorize(req);
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
