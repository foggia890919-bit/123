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
  if (cache.get(code)?.status === "loading") return;
  cache.set(code, { status: "loading" });
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
 * 여러 보험코드의 재고를 가져온다.
 *
 * @param force true 면 캐시의 loading/done 상태를 무시하고 재호출.
 *              "전체재고 새로고침" 처럼 사용자가 명시적으로 다시 받고 싶을 때.
 *
 * 라이브 경로는 `/api/inventory/check` 에 50개 한도가 있어서, 50개를 초과하면
 * 50개씩 청크로 쪼개 병렬 호출한다. snapshot 경로는 1000개 한도라 단일 호출.
 * 각 청크는 응답이 들어오는 대로 캐시에 반영 (즉시 화면 업데이트).
 */
export function fetchStockBatch(codes: string[], live = false, sites?: string[], force = false) {
  const targets = force
    ? codes.slice()
    : codes.filter((c) => {
        const e = cache.get(c);
        return !e || (e.status !== "loading" && e.status !== "done");
      });
  if (targets.length === 0) return;

  for (const code of targets) {
    cache.set(code, { status: "loading" });
    notify(code);
  }

  const url = live ? "/api/inventory/check?live=1" : "/api/inventory/check";
  const chunkSize = live ? 50 : 1000;

  for (let i = 0; i < targets.length; i += chunkSize) {
    const chunk = targets.slice(i, i + chunkSize);
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: chunk, ...(sites ? { sites } : {}) }),
    })
      .then(safeJson)
      .then(({ data, error }) => {
        if (error) {
          for (const c of chunk) applyError(c, error);
          return;
        }
        const d = data as { error?: string; results?: SiteResult[]; source?: "snapshot" | "live" };
        if (d?.error) {
          for (const c of chunk) applyError(c, d.error!);
          return;
        }
        for (const c of chunk) applyResult(c, d?.results ?? [], d?.source);
      })
      .catch((err) => {
        for (const c of chunk) applyError(c, String(err));
      });
  }
}
