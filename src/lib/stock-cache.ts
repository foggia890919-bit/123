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

export function fetchStock(code: string, productName: string, live = false) {
  if (cache.get(code)?.status === "loading") return;
  cache.set(code, { status: "loading" });
  notify(code);

  const url = live ? "/api/inventory/check?live=1" : "/api/inventory/check";
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes: [code] }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.error) {
        cache.set(code, { status: "error", error: data.error });
      } else {
        cache.set(code, {
          status: "done",
          results: data.results ?? [],
          source: data.source,
          fetchedAt: new Date(),
        });
      }
      notify(code);
    })
    .catch((err) => {
      cache.set(code, { status: "error", error: String(err) });
      notify(code);
    });
}
