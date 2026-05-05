import type { WholesaleAdapter } from "../core/types";
import { ibjp } from "./ibjp";
import { inchun } from "./inchun";
import { family } from "./family";

// Registry of all supported wholesale sites.
// picomall and goy were dropped because they don't support insurance-code
// search (picomall is product-name only) — keeping the worker focused on
// the three sites that actually return structured stock data.
export const ALL_ADAPTERS: Record<string, WholesaleAdapter> = {
  ibjp,
  inchun,
  family,
};

// Sites temporarily disabled at runtime. Adapter code is preserved for future re-activation.
// inchun: disabled — inchunpharm.com blocks AWS Lightsail IPs at network level
export const DISABLED_SITES = new Set<string>(["inchun"]);

export function resolveAdapters(keys: string[]): WholesaleAdapter[] {
  return keys.map(k => {
    const a = ALL_ADAPTERS[k];
    if (!a) throw new Error(`Unknown adapter "${k}". Registered: ${Object.keys(ALL_ADAPTERS).join(", ")}`);
    return a;
  });
}
