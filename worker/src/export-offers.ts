import { getPool, hasDb } from "./db.ts";
import { resolveConfig, type YkConfig } from "./export-ykorder.ts";
import { normalizeProductKey, normalizeCompanyKey } from "./normalize.ts";

// ykpharm-order 도도매(자동수집) 내보내기.
//
// 크롤 배치가 끝난 뒤, 각 도매 사이트(ibjp=백제약품, family=훼밀리팜)의 최근 24시간
// InventorySnapshot 을 ykpharm-order 의 public.wholesaler_offers 테이블로 **전체 교체**한다.
//   - 도매상 id 는 wholesalers 를 email 로 조회 (없으면 하드코딩 폴백).
//   - 사이트별로 기존 offers 를 delete 후, 새 offers 를 insert (source='api', uploaded_at=now).
//
// ⚠ 단위(포장) 정규화 — 데이터로 확인된 핵심 사실:
//   크롤 단가(unitPrice)는 "포장 단위 가격"(예: 30정 한 통 13,110원)이고,
//   보험약가(products.base_price)는 "낱개(1정) 가격"(예: 437원)이다.
//   실제로 크롤 단가 ≈ 보험약가 × 포장수량 이 정확히 성립한다(할인 없을 때).
//   따라서 화면(매입비교)이 약가 대비 비교를 하려면 낱개 기준으로 맞춰야 한다:
//     포장수량 packQty = round(단가 ÷ 약가)  (약가>0 일 때) 또는 규격/제품명 텍스트에서 파싱
//     낱개 매입가 = 단가 ÷ packQty
//     discount_rate = (1 − 낱개매입가 ÷ 약가) × 100  (0~100 클램프, 소수1자리)
//     supply_price  = 낱개 매입가 (round)
//   → supply_price·discount_rate 모두 "낱개" 기준으로 저장한다(수기 시드 데이터도 낱개 단위였음).
//   약가가 없거나 0이면 packQty 판별 불가 → discount_rate=0, supply_price=포장단가 그대로.
//
// std_code(표준코드): 크롤 원본엔 없음. ykorder product_skus(제품→포장별 표준코드)에서
//   포장수량이 일치하는 SKU 를 골라 채운다. 여러 SKU 가 같은 포장수량이거나 판별 불가면 비움
//   (빈 값이면 화면이 보험코드 매칭으로 폴백 — 틀린 표준코드보다 빈 값이 안전).
//
// 비급여(NC:): 기존 export-ykorder 의 이름·제약사 정규화 매칭으로 제품 특정,
//   discount_rate=8 고정(비급여 매입가는 이미 8% 할인가), supply_price=매입가.
//   std_code 는 매칭된 제품의 product_skus 를 규격 텍스트로 대조해 채움(불명확 시 비움).
//
// 인증(service_role 키)·Supabase URL 은 export-ykorder 의 resolveConfig 를 재사용한다.
// 키는 어떤 로그에도 출력하지 않는다.

// wholesalers 이메일 → 하드코딩 폴백 id (2026-07-29 발주자 제공).
const SITE_WHOLESALERS: Record<string, { email: string; fallbackId: string }> = {
  ibjp: { email: "auto-ibjp@ykpharm.local", fallbackId: "c868a636-6943-45af-8727-a8dd7519d3b5" },
  family: { email: "auto-family@ykpharm.local", fallbackId: "e6e8148d-a604-4b3d-9e2f-72bb85a60d27" },
};

interface OfferRow {
  wholesaler_id: string;
  insurance_code: string;
  std_code: string;
  name: string;
  spec: string;
  stock_qty: number;
  discount_rate: number;
  supply_price: number;
  source: string;
  uploaded_at: string;
}

interface YkProductLite {
  id: string;
  code: string | null;
  name: string;
  maker: string | null;
  coverage: string | null;
  base_price: number | null;
  std_code: string | null;
  spec: string | null;
}

interface YkSku {
  std_code: string | null;
  pack_qty: number | null;
  sort_order: number | null;
}

interface SiteResult {
  site: string;
  wholesalerId: string;
  insuredRows: number;
  insuredStdFilled: number;
  nonInsuredMatched: number;
  nonInsuredTotal: number;
  nonInsuredAmbiguous: number;
  nonInsuredStdFilled: number;
  stdFillPct: number;
  deleted: number | null;
  inserted: number;
  dryRun: boolean;
  error?: string;
}

function headers(cfg: YkConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 규격/제품명 텍스트에서 "포장 낱개 수량" 파싱. 낱개를 세는 단위(정/T/캡슐/C/포/P/EA/관/매/앰플/바이알)
// 뒤의 숫자만 인정하고, 용량 단위(g/mg/ml/mcg/kg/L/IU/%)는 무시한다.
// 마지막(가장 오른쪽) 매칭을 채택 — 제품명 끝에 포장이 오기 때문("몬테라정 10/28T" → 28).
const COUNT_UNIT = "(?:T|C|P|EA|정|캡슐|캅셀|포|매|관|앰플|바이알|VIAL|AMP|팩|PAC|병)";
function parsePackCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const re = new RegExp(`(\\d{1,4})\\s*${COUNT_UNIT}\\b`, "gi");
  let m: RegExpExecArray | null;
  let last: number | null = null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) last = n;
  }
  return last;
}

// SKU 목록에서 포장수량 후보들(우선순위 순)로 표준코드를 고른다.
// 어떤 후보에서 정확히 1개 SKU 가 매칭되면 그 표준코드, 복수 매칭(동일 포장수량 다중 표준코드)이면
// 비움(안전). 후보 모두 실패하면 비움.
function pickStdCode(skus: YkSku[], qtyCandidates: (number | null)[]): string {
  if (!skus || skus.length === 0) return "";
  for (const q of qtyCandidates) {
    if (q == null) continue;
    const matches = skus.filter(s => s.pack_qty === q && s.std_code && s.std_code.trim() !== "");
    if (matches.length === 1) return matches[0].std_code!.trim();
    if (matches.length > 1) return ""; // 동일 포장수량 다중 표준코드 → 판별 불가
  }
  return "";
}

// products 전체를 Range 페이지네이션으로 수집 (급여 약가/이름매칭 + 비급여 이름매칭 공용).
async function fetchAllProducts(cfg: YkConfig): Promise<YkProductLite[]> {
  const PAGE = 1000;
  const base = `${cfg.url}/rest/v1/products?select=id,code,name,maker,coverage,base_price,std_code,spec`;
  const out: YkProductLite[] = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(base, {
      headers: headers(cfg, { "Range-Unit": "items", Range: `${offset}-${offset + PAGE - 1}` }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`products 조회 실패 HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const batch = (await res.json()) as YkProductLite[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// product_skus 전체 수집 → product_id 별 SKU 목록(포장수량·표준코드). sort_order 오름차순 정렬.
async function fetchSkusByProduct(cfg: YkConfig): Promise<Map<string, YkSku[]>> {
  const PAGE = 1000;
  const base = `${cfg.url}/rest/v1/product_skus?select=product_id,std_code,pack_qty,sort_order`;
  const map = new Map<string, YkSku[]>();
  let offset = 0;
  for (;;) {
    const res = await fetch(base, {
      headers: headers(cfg, { "Range-Unit": "items", Range: `${offset}-${offset + PAGE - 1}` }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`product_skus 조회 실패 HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const batch = (await res.json()) as ({ product_id: string } & YkSku)[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const s of batch) {
      const list = map.get(s.product_id);
      const sku: YkSku = { std_code: s.std_code, pack_qty: s.pack_qty, sort_order: s.sort_order };
      if (list) list.push(sku);
      else map.set(s.product_id, [sku]);
    }
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  return map;
}

async function lookupWholesalerId(cfg: YkConfig, email: string, fallbackId: string): Promise<string> {
  try {
    const url = `${cfg.url}/rest/v1/wholesalers?select=id&email=eq.${encodeURIComponent(email)}`;
    const res = await fetch(url, { headers: headers(cfg) });
    if (res.ok) {
      const rows = (await res.json()) as { id: string }[];
      if (Array.isArray(rows) && rows[0]?.id) return rows[0].id;
    }
  } catch {
    // fall through to fallback
  }
  console.warn(`[offers] wholesalers 이메일 조회 실패(${email}) — 폴백 id 사용`);
  return fallbackId;
}

// 한 사이트의 InventorySnapshot(24h)을 OfferRow[] 로 변환.
async function buildOffersForSite(
  siteKey: string,
  wholesalerId: string,
  codeToProduct: Map<string, YkProductLite>,
  productsByNameKey: Map<string, string[]>,
  productById: Map<string, YkProductLite>,
  skusByProduct: Map<string, YkSku[]>,
  nowIso: string
): Promise<{
  rows: OfferRow[];
  insuredStdFilled: number;
  ncMatched: number;
  ncTotal: number;
  ncAmbiguous: number;
  ncStdFilled: number;
}> {
  const pool = getPool();

  // ---- 급여: 보험코드별 최신 스냅샷 (siteKey 당 1행 보장 by ON CONFLICT) ----
  const { rows: insured } = await pool.query<{
    code: string;
    name: string;
    spec: string | null;
    stock: number | null;
    unitPrice: number | null;
  }>(
    `SELECT "insuranceCode" AS code, "productName" AS name, "spec",
            "stock", "unitPrice"
     FROM "InventorySnapshot"
     WHERE "siteKey" = $1
       AND "insuranceCode" NOT LIKE 'NC:%'
       AND "scrapedAt" >= NOW() - INTERVAL '24 hours'`,
    [siteKey]
  );

  const rows: OfferRow[] = [];
  let insuredStdFilled = 0;
  for (const r of insured) {
    if (!r.code) continue;
    const prod = codeToProduct.get(r.code);
    const basePrice = prod?.base_price ?? null;
    const unit = r.unitPrice; // 포장 단가
    const skus = prod ? skusByProduct.get(String(prod.id)) ?? [] : [];

    // 포장수량: 약가 대비 비율(주 신호) + 규격/제품명 텍스트(보조). 낱개 단위(정/T/캡슐...)만 인정.
    const qtyPrice =
      basePrice && basePrice > 0 && unit != null && unit > 0
        ? Math.max(1, Math.round(unit / basePrice))
        : null;
    const qtyText = parsePackCount(r.spec) ?? parsePackCount(r.name);
    const packQty = qtyPrice ?? qtyText ?? 1;

    // 표준코드: 텍스트 포장수량 → 가격추정 포장수량 순으로 SKU 매칭(유일할 때만).
    const stdCode = pickStdCode(skus, [qtyText, qtyPrice]);
    if (stdCode) insuredStdFilled++;

    // 낱개 기준 매입가 + 할인율.
    let discount = 0;
    let supply = unit != null ? Math.round(unit) : 0;
    if (basePrice && basePrice > 0 && unit != null && packQty > 0) {
      const perUnit = unit / packQty;
      supply = Math.round(perUnit);
      discount = round1((1 - perUnit / basePrice) * 100);
      if (discount < 0) discount = 0;
      if (discount > 100) discount = 100;
    }

    rows.push({
      wholesaler_id: wholesalerId,
      insurance_code: r.code,
      std_code: stdCode,
      name: r.name ?? prod?.name ?? "",
      spec: r.spec ?? "",
      stock_qty: r.stock != null ? Math.round(r.stock) : 0,
      discount_rate: discount,
      supply_price: supply,
      source: "api",
      uploaded_at: nowIso,
    });
  }

  // ---- 비급여(NC:): medicationId 별 스냅샷 → Medication 이름/제약사 → products 매칭 ----
  const { rows: ncSnaps } = await pool.query<{
    medicationId: string;
    spec: string | null;
    productName: string | null;
    stock: number | null;
    unitPrice: number | null;
  }>(
    `SELECT SUBSTRING("insuranceCode" FROM 4) AS "medicationId",
            "spec", "productName", "stock", "unitPrice"
     FROM "InventorySnapshot"
     WHERE "siteKey" = $1
       AND "insuranceCode" LIKE 'NC:%'
       AND "scrapedAt" >= NOW() - INTERVAL '24 hours'`,
    [siteKey]
  );
  const ncFiltered = ncSnaps.filter(n => !!n.medicationId);

  let ncMatched = 0;
  let ncAmbiguous = 0;
  let ncStdFilled = 0;
  if (ncFiltered.length > 0) {
    const medIds = ncFiltered.map(n => n.medicationId);
    const { rows: meds } = await pool.query<{ id: string; productName: string; companyName: string | null }>(
      `SELECT id, "productName", "companyName" FROM "Medication" WHERE id = ANY($1::text[])`,
      [medIds]
    );
    const medById = new Map(meds.map(m => [m.id, m]));

    for (const n of ncFiltered) {
      const med = medById.get(n.medicationId);
      if (!med) continue;
      const key = `${normalizeProductKey(med.productName)}|${normalizeCompanyKey(med.companyName ?? "")}`;
      if (key === "|") continue;
      const ids = productsByNameKey.get(key);
      if (!ids || ids.length === 0) continue;
      if (ids.length > 1) { ncAmbiguous++; continue; }
      const prod = productById.get(ids[0]);
      if (!prod) continue;
      ncMatched++;

      const skus = skusByProduct.get(String(prod.id)) ?? [];
      const qtyText = parsePackCount(n.spec) ?? parsePackCount(n.productName);
      const stdCode = pickStdCode(skus, [qtyText]);
      if (stdCode) ncStdFilled++;

      rows.push({
        wholesaler_id: wholesalerId,
        insurance_code: prod.code ?? "",
        std_code: stdCode,
        name: prod.name ?? med.productName,
        spec: prod.spec ?? n.spec ?? "",
        stock_qty: n.stock != null ? Math.round(n.stock) : 0,
        discount_rate: 8,
        supply_price: n.unitPrice != null ? Math.round(n.unitPrice) : 0,
        source: "api",
        uploaded_at: nowIso,
      });
    }
  }

  return { rows, insuredStdFilled, ncMatched, ncTotal: ncFiltered.length, ncAmbiguous, ncStdFilled };
}

async function deleteOffers(cfg: YkConfig, wholesalerId: string): Promise<number> {
  const url = `${cfg.url}/rest/v1/wholesaler_offers?wholesaler_id=eq.${encodeURIComponent(wholesalerId)}&select=id`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: headers(cfg, { Prefer: "return=representation" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`offers delete 실패 HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  const deleted = (await res.json()) as unknown;
  return Array.isArray(deleted) ? deleted.length : 0;
}

async function insertOffers(cfg: YkConfig, rows: OfferRow[]): Promise<{ inserted: number; firstError: string | null }> {
  const restBase = `${cfg.url}/rest/v1/wholesaler_offers`;
  const CHUNK = 500;
  let inserted = 0;
  let firstError: string | null = null;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    try {
      const res = await fetch(restBase, {
        method: "POST",
        headers: headers(cfg, { Prefer: "return=minimal" }),
        body: JSON.stringify(slice),
      });
      if (!res.ok) {
        const body = await res.text();
        if (!firstError) firstError = `HTTP ${res.status}: ${body.slice(0, 200)}`;
        continue;
      }
      inserted += slice.length;
    } catch (e) {
      if (!firstError) firstError = (e as Error).message;
    }
  }
  return { inserted, firstError };
}

export async function exportOffersToYkOrder(
  opts: { dryRun?: boolean } = {}
): Promise<{ dryRun: boolean; sites: SiteResult[] } | null> {
  const cfg = resolveConfig();
  if (!cfg) {
    console.log("[offers] Supabase 설정 없음 (YKORDER_SERVICE_KEY 또는 .env.local) — 내보내기 건너뜀");
    return null;
  }
  if (!hasDb()) {
    console.log("[offers] DATABASE_URL 미설정 — 내보내기 건너뜀");
    return null;
  }
  const dryRun = !!opts.dryRun;
  const nowIso = new Date().toISOString();

  // products + product_skus 를 1회만 수집해 급여/비급여 공용으로 쓴다.
  const products = await fetchAllProducts(cfg);
  const skusByProduct = await fetchSkusByProduct(cfg);
  const codeToProduct = new Map<string, YkProductLite>();
  const productById = new Map<string, YkProductLite>();
  const productsByNameKey = new Map<string, string[]>();
  for (const p of products) {
    productById.set(String(p.id), p);
    if (p.code) {
      if (!codeToProduct.has(p.code)) codeToProduct.set(p.code, p);
    }
    if (p.coverage === "비급여") {
      const key = `${normalizeProductKey(p.name)}|${normalizeCompanyKey(p.maker ?? "")}`;
      if (key === "|") continue;
      const list = productsByNameKey.get(key);
      if (list) list.push(String(p.id));
      else productsByNameKey.set(key, [String(p.id)]);
    }
  }
  console.log(
    `[offers] products ${products.length}개 · SKU맵 ${skusByProduct.size} 제품 로드 (코드맵 ${codeToProduct.size}, 비급여 이름키 ${productsByNameKey.size})`
  );

  const results: SiteResult[] = [];
  for (const [siteKey, wh] of Object.entries(SITE_WHOLESALERS)) {
    const result: SiteResult = {
      site: siteKey,
      wholesalerId: "",
      insuredRows: 0,
      insuredStdFilled: 0,
      nonInsuredMatched: 0,
      nonInsuredTotal: 0,
      nonInsuredAmbiguous: 0,
      nonInsuredStdFilled: 0,
      stdFillPct: 0,
      deleted: null,
      inserted: 0,
      dryRun,
    };
    try {
      const wholesalerId = await lookupWholesalerId(cfg, wh.email, wh.fallbackId);
      result.wholesalerId = wholesalerId;

      const built = await buildOffersForSite(
        siteKey, wholesalerId, codeToProduct, productsByNameKey, productById, skusByProduct, nowIso
      );
      const { rows, insuredStdFilled, ncMatched, ncTotal, ncAmbiguous, ncStdFilled } = built;
      result.insuredRows = rows.length - ncMatched;
      result.insuredStdFilled = insuredStdFilled;
      result.nonInsuredMatched = ncMatched;
      result.nonInsuredTotal = ncTotal;
      result.nonInsuredAmbiguous = ncAmbiguous;
      result.nonInsuredStdFilled = ncStdFilled;
      const stdFilled = insuredStdFilled + ncStdFilled;
      result.stdFillPct = rows.length > 0 ? round1((stdFilled / rows.length) * 100) : 0;

      if (dryRun) {
        console.log(
          `[offers] (dry) ${siteKey}: 급여 ${result.insuredRows} + 비급여 ${ncMatched}/${ncTotal} ` +
          `= 총 ${rows.length}행, 표준코드 ${stdFilled}행(${result.stdFillPct}%)`
        );
        results.push(result);
        continue;
      }

      // 전체 교체: 기존 offers delete → 새 offers insert.
      const deleted = await deleteOffers(cfg, wholesalerId);
      result.deleted = deleted;
      const { inserted, firstError } = await insertOffers(cfg, rows);
      result.inserted = inserted;
      if (firstError) {
        result.error = firstError;
        console.warn(`[offers] ${siteKey} 일부 insert 실패 (첫 오류): ${firstError}`);
      }
      console.log(
        `[offers] ${siteKey}: 삭제 ${deleted} → 삽입 ${inserted} ` +
        `(급여 ${result.insuredRows}, 비급여 ${ncMatched}/${ncTotal}, 표준코드 ${stdFilled}행 ${result.stdFillPct}%)`
      );
    } catch (err) {
      result.error = (err as Error).message;
      console.error(`[offers] ${siteKey} 실패:`, result.error);
    }
    results.push(result);
  }

  return { dryRun, sites: results };
}
