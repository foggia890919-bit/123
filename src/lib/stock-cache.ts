// Module-level stock cache — persists across SPA navigation (until page refresh).
// fetch() calls started here are NOT cancelled on component unmount, so the user
// can navigate away and come back to find results already populated.

export type StockStatus = "idle" | "loading" | "done" | "error";

export interface SiteResult {
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
  error?: string;
  scrapedAt?: string;
}

export interface StockEntry {
  status: StockStatus;
  results?: SiteResult[];
  error?: string;
  source?: "snapshot" | "live";
  fetchedAt?: Date;
}

const cache = new Map<string, StockEntry>();
const listeners = new Map<string, Set<() => void>>();

function notify(code: string) {
  listeners.get(code)?.forEach((fn) => fn());
}

export function getStock(code: string): StockEntry {
  return cache.get(code) ?? { status: "idle" };
}

export function subscribeStock(code: string, fn: () => void): () => void {
  if (!listeners.has(code)) listeners.set(code, new Set());
  listeners.get(code)!.add(fn);
  return () => listeners.get(code)?.delete(fn);
}

async function safeJson(res: Response): Promise<{ data?: unknown; error?: string }> {
  const text = await res.text();
  if (!text) return { error: `Empty response (HTTP ${res.status})` };
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: `Invalid JSON (HTTP ${res.status})` };
  }
}

function applyResult(code: string, results: SiteResult[], source?: "snapshot" | "live") {
  const codeResults = results.filter((r) => r.insuranceCode === code);
  cache.set(code, {
    status: "done",
    results: codeResults,
    source,
    fetchedAt: new Date(),
  });
  notify(code);
}

function applyError(code: string, error: string) {
  cache.set(code, { status: "error", error });
  notify(code);
}

export function fetchStock(code: string, productName: string, live = false, sites?: string[]) {
  const prev = cache.get(code);
  if (prev?.status === "loading") return;
  // 로딩 중에도 화면에서 직전 값이 그대로 보이도록 results/source/fetchedAt 보존.
  cache.set(code, {
    status: "loading",
    results: prev?.results,
    source: prev?.source,
    fetchedAt: prev?.fetchedAt,
  });
  notify(code);

  const url = live ? "/api/inventory/check?live=1" : "/api/inventory/check";
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes: [code], ...(sites ? { sites } : {}) }),
  })
    .then(safeJson)
    .then(({ data, error }) => {
      if (error) return applyError(code, error);
      const d = data as { error?: string; results?: SiteResult[]; source?: "snapshot" | "live" };
      if (d?.error) return applyError(code, d.error);
      applyResult(code, d?.results ?? [], d?.source);
    })
    .catch((err) => applyError(code, String(err)));
}

/**
 * 여러 보험코드의 재고를 한 번의 API 호출로 가져온다.
 * 검색 결과 자동 워밍업처럼 50건+ 일괄 처리할 때 사용.
 * Vercel 동시 함수 호출 제한을 피하고 워커 부하도 줄임.
 */
export function fetchStockBatch(codes: string[], live = false, sites?: string[]) {
  const targets = codes.filter((c) => {
    const e = cache.get(c);
    return !e || (e.status !== "loading" && e.status !== "done");
  });
  if (targets.length === 0) return;

  for (const code of targets) {
    const prev = cache.get(code);
    // 로딩 중에도 직전 값을 화면에 유지 — results/source/fetchedAt 그대로 보존.
    cache.set(code, {
      status: "loading",
      results: prev?.results,
      source: prev?.source,
      fetchedAt: prev?.fetchedAt,
    });
    notify(code);
  }

  const url = live ? "/api/inventory/check?live=1" : "/api/inventory/check";
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes: targets, ...(sites ? { sites } : {}) }),
  })
    .then(safeJson)
    .then(({ data, error }) => {
      if (error) {
        for (const c of targets) applyError(c, error);
        return;
      }
      const d = data as { error?: string; results?: SiteResult[]; source?: "snapshot" | "live" };
      if (d?.error) {
        for (const c of targets) applyError(c, d.error!);
        return;
      }
      for (const c of targets) applyResult(c, d?.results ?? [], d?.source);
    })
    .catch((err) => {
      for (const c of targets) applyError(c, String(err));
    });
}
