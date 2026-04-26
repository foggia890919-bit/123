import type { WholesaleAdapter } from "../core/types";
import { ibjp } from "./ibjp";
import { inchun } from "./inchun";
import { family } from "./family";
import { picomall } from "./picomall";
import { goy } from "./goy";

// Registry of all supported wholesale sites. Up to 5 sites per plan.
// Add new adapters by implementing WholesaleAdapter and registering here.
export const ALL_ADAPTERS: Record<string, WholesaleAdapter> = {
  ibjp,
  inchun,
  family,
  picomall,
  goy,
};

export function resolveAdapters(keys: string[]): WholesaleAdapter[] {
  return keys.map(k => {
    const a = ALL_ADAPTERS[k];
    if (!a) throw new Error(`Unknown adapter "${k}". Registered: ${Object.keys(ALL_ADAPTERS).join(", ")}`);
    return a;
  });
}
