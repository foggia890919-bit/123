import { getPool, hasDb } from "./db.ts";
import { resolveConfig, patchProductStock, type YkConfig } from "./export-ykorder.ts";
import { normalizeProductKey, normalizeCompanyKey } from "./normalize.ts";
import {
  SITE_WHOLESALERS,
  loadYkMaps,
  lookupWholesalerId,
  buildInsuredRow,
  deleteOffersByCodes,
  insertOffers,
  headers,
  parsePackCount,
  pickStdCode,
  type YkMaps,
  type OfferRow,
} from "./export-offers.ts";

// ykpharm-order 준실시간(증분) 반영기.
//   배치가 크롤하는 순서대로, 새로 수집된 (도매상, 보험코드) 만 ykorder 에 즉시 반영한다:
//     - wholesaler_offers: 해당 (도매상, 보험코드) 행 delete 후 insert (고유 제약 없음).
//     - products.stock: 그 코드만 두 사이트 합계로 PATCH (export-ykorder 규칙과 동일).
//   배치 완료 시의 "전체 교체"(exportOffersToYkOrder / exportStockToYkOrder) 는 그대로 유지 —
//   증분은 근사, 전체 교체가 정합성 보정.
//   온디맨드 재조회 봇 풀(ondemand-pool)도 이 반영기의 reflectInsuredCodes 를 공유한다.
//
//   모든 반영은 best-effort — 실패해도 크롤/배치 진행에 지장 없게 오류는 로깅만.

export class YkIncrementalExporter {
  private dirtyInsured = new Set<string>();
  private dirtyNc = new Set<string>();
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private mapTimer: ReturnType<typeof setInterval> | undefined;
  private flushing = false;

  private constructor(
    private cfg: YkConfig,
    private maps: YkMaps,
    private whIds: Map<string, string>
  ) {}

  static async create(): Promise<YkIncrementalExporter | null> {
    const cfg = resolveConfig();
    if (!cfg) {
      console.log("[incr] ykorder 설정 없음 — 증분 반영기 비활성");
      return null;
    }
    if (!hasDb()) {
      console.log("[incr] DATABASE_URL 없음 — 증분 반영기 비활성");
      return null;
    }
    const maps = await loadYkMaps(cfg);
    const whIds = new Map<string, string>();
    for (const [site, wh] of Object.entries(SITE_WHOLESALERS)) {
      whIds.set(site, await lookupWholesalerId(cfg, wh.email, wh.fallbackId));
    }
    return new YkIncrementalExporter(cfg, maps, whIds);
  }

  // 제품 마스터 맵 재적재 — 장시간 구동(온디맨드 풀) 중 신규/변경 반영.
  async refreshMaps(): Promise<void> {
    try {
      this.maps = await loadYkMaps(this.cfg);
    } catch (e) {
      console.warn(`[incr] 맵 재적재 실패: ${(e as Error).message}`);
    }
  }

  startMapRefresh(intervalMs = 20 * 60 * 1000): void {
    if (this.mapTimer) return;
    this.mapTimer = setInterval(() => void this.refreshMaps(), intervalMs);
    this.mapTimer.unref?.();
  }

  markInsured(code: string): void {
    if (code && !code.startsWith("NC:")) this.dirtyInsured.add(code);
  }
  markNc(medicationId: string): void {
    if (medicationId) this.dirtyNc.add(medicationId);
  }

  // 10초 주기 플러시 — 그 사이 dirty 로 쌓인 코드만 반영.
  startPeriodicFlush(intervalMs = 10_000): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(e => console.warn(`[incr] 플러시 오류: ${(e as Error).message}`));
    }, intervalMs);
    this.flushTimer.unref?.();
    console.log(`[incr] 준실시간 플러시 시작 — ${intervalMs}ms 주기`);
  }
  stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    const codes = [...this.dirtyInsured];
    this.dirtyInsured.clear();
    const meds = [...this.dirtyNc];
    this.dirtyNc.clear();
    if (codes.length === 0 && meds.length === 0) return;
    this.flushing = true;
    try {
      if (codes.length > 0) await this.reflectInsuredCodes(codes);
      if (meds.length > 0) await this.reflectNonInsuredMedIds(meds);
      console.log(`[incr] 플러시 반영 — 급여 ${codes.length} · 비급여 ${meds.length} 코드`);
    } catch (e) {
      console.warn(`[incr] 플러시 반영 실패: ${(e as Error).message}`);
    } finally {
      this.flushing = false;
    }
  }

  // 급여 보험코드 집합을 즉시 반영 — offers(delete+insert) + stock(SUM PATCH).
  // 온디맨드 풀이 단건([code])으로도 호출한다. 항상 best-effort.
  async reflectInsuredCodes(codesIn: string[]): Promise<void> {
    const codes = [...new Set(codesIn.filter(c => c && !c.startsWith("NC:")))];
    if (codes.length === 0) return;
    const nowIso = new Date().toISOString();
    const pool = getPool();

    // 1) offers: 해당 코드의 사이트별 최신 스냅샷 → OfferRow → (도매상,코드) delete 후 insert.
    let snaps: {
      siteKey: string;
      code: string;
      name: string;
      spec: string | null;
      stock: number | null;
      unitPrice: number | null;
    }[] = [];
    try {
      const res = await pool.query<(typeof snaps)[number]>(
        `SELECT "siteKey", "insuranceCode" AS code, "productName" AS name, "spec", "stock", "unitPrice"
           FROM "InventorySnapshot"
          WHERE "siteKey" IN ('ibjp','family')
            AND "insuranceCode" = ANY($1::text[])
            AND "insuranceCode" NOT LIKE 'NC:%'
            AND "scrapedAt" >= NOW() - INTERVAL '24 hours'`,
        [codes]
      );
      snaps = res.rows;
    } catch (e) {
      console.warn(`[incr] 급여 스냅샷 조회 실패: ${(e as Error).message}`);
    }

    const bySite = new Map<string, OfferRow[]>();
    for (const r of snaps) {
      const whId = this.whIds.get(r.siteKey);
      if (!whId) continue;
      const prod = this.maps.codeToProduct.get(r.code);
      const skus = prod ? this.maps.skusByProduct.get(String(prod.id)) ?? [] : [];
      const { row } = buildInsuredRow(r, prod, skus, whId, nowIso);
      const arr = bySite.get(r.siteKey);
      if (arr) arr.push(row);
      else bySite.set(r.siteKey, [row]);
    }
    for (const [site, siteRows] of bySite) {
      const whId = this.whIds.get(site)!;
      const siteCodes = [...new Set(siteRows.map(x => x.insurance_code))];
      try {
        await deleteOffersByCodes(this.cfg, whId, siteCodes);
        const { firstError } = await insertOffers(this.cfg, siteRows);
        if (firstError) console.warn(`[incr] ${site} offers insert 일부 실패: ${firstError}`);
      } catch (e) {
        console.warn(`[incr] ${site} offers 반영 실패: ${(e as Error).message}`);
      }
    }

    // 2) products.stock: 두 사이트 합계로 그 코드만 PATCH.
    try {
      const { rows: stk } = await pool.query<{ code: string; stock: number | null }>(
        `SELECT "insuranceCode" AS code, SUM("stock")::int AS stock
           FROM "InventorySnapshot"
          WHERE "siteKey" IN ('ibjp','family')
            AND "insuranceCode" = ANY($1::text[])
            AND "insuranceCode" NOT LIKE 'NC:%'
            AND "scrapedAt" >= NOW() - INTERVAL '24 hours'
          GROUP BY "insuranceCode"`,
        [codes]
      );
      const usable = stk.filter((r): r is { code: string; stock: number } => r.stock !== null);
      if (usable.length > 0) {
        const { firstError } = await patchProductStock(this.cfg, usable);
        if (firstError) console.warn(`[incr] stock PATCH 일부 실패: ${firstError}`);
      }
    } catch (e) {
      console.warn(`[incr] stock 반영 실패: ${(e as Error).message}`);
    }
  }

  // 비급여(NC:medicationId) 집합을 즉시 반영 — 이름키 유일 매칭 제품의 stock/cost_price PATCH.
  // (비급여 offers 는 코드가 비어있을 수 있어 증분에서 다루지 않고 배치 종료 시 전체 교체가 담당.)
  async reflectNonInsuredMedIds(medIdsIn: string[]): Promise<void> {
    const medIds = [...new Set(medIdsIn.filter(Boolean))];
    if (medIds.length === 0) return;
    const pool = getPool();

    let snaps: { medicationId: string; stock: number | null; unitPrice: number | null }[] = [];
    try {
      const res = await pool.query<(typeof snaps)[number]>(
        `SELECT SUBSTRING("insuranceCode" FROM 4) AS "medicationId",
                SUM("stock")::int AS stock, MIN("unitPrice")::float8 AS "unitPrice"
           FROM "InventorySnapshot"
          WHERE "siteKey" IN ('ibjp','family')
            AND "insuranceCode" LIKE 'NC:%'
            AND SUBSTRING("insuranceCode" FROM 4) = ANY($1::text[])
            AND "scrapedAt" >= NOW() - INTERVAL '24 hours'
          GROUP BY "insuranceCode"`,
        [medIds]
      );
      snaps = res.rows.filter(s => s.medicationId);
    } catch (e) {
      console.warn(`[incr] 비급여 스냅샷 조회 실패: ${(e as Error).message}`);
      return;
    }
    if (snaps.length === 0) return;

    let meds: { id: string; productName: string; companyName: string | null }[] = [];
    try {
      const res = await pool.query<(typeof meds)[number]>(
        `SELECT id, "productName", "companyName" FROM "Medication" WHERE id = ANY($1::text[])`,
        [medIds]
      );
      meds = res.rows;
    } catch (e) {
      console.warn(`[incr] Medication 조회 실패: ${(e as Error).message}`);
      return;
    }
    const medById = new Map(meds.map(m => [m.id, m]));

    // 이름키 유일 매칭 제품에 stock/cost_price PATCH.
    interface Task { id: string; body: Record<string, number> }
    const tasks: Task[] = [];
    for (const s of snaps) {
      const med = medById.get(s.medicationId);
      if (!med) continue;
      const key = `${normalizeProductKey(med.productName)}|${normalizeCompanyKey(med.companyName ?? "")}`;
      if (key === "|") continue;
      const ids = this.maps.productsByNameKey.get(key);
      if (!ids || ids.length !== 1) continue;
      const body: Record<string, number> = {};
      if (s.stock !== null) body.stock = s.stock;
      if (s.unitPrice !== null) body.cost_price = s.unitPrice;
      if (Object.keys(body).length === 0) continue;
      tasks.push({ id: ids[0], body });
    }
    if (tasks.length === 0) return;

    const restBase = `${this.cfg.url}/rest/v1/products`;
    for (const t of tasks) {
      try {
        const res = await fetch(`${restBase}?id=eq.${encodeURIComponent(t.id)}&select=id`, {
          method: "PATCH",
          headers: headers(this.cfg, { Prefer: "return=minimal" }),
          body: JSON.stringify(t.body),
        });
        if (!res.ok) {
          const body = await res.text();
          console.warn(`[incr] 비급여 PATCH 실패 HTTP ${res.status}: ${body.slice(0, 120)}`);
        }
      } catch (e) {
        console.warn(`[incr] 비급여 PATCH 오류: ${(e as Error).message}`);
      }
    }
  }
}

// 온디맨드 풀과 배치가 공유하는 싱글턴 반영기. 맵은 20분 주기로 재적재.
let sharedPromise: Promise<YkIncrementalExporter | null> | null = null;
export function getSharedExporter(): Promise<YkIncrementalExporter | null> {
  if (!sharedPromise) {
    sharedPromise = YkIncrementalExporter.create()
      .then(exp => {
        if (exp) exp.startMapRefresh();
        return exp;
      })
      .catch(err => {
        // 생성 실패(네트워크 등)면 싱글턴을 비워 다음 호출에서 재시도하게 한다.
        console.warn(`[incr] 공유 반영기 생성 실패: ${(err as Error).message}`);
        sharedPromise = null;
        return null;
      });
  }
  return sharedPromise;
}
