import type { Credentials } from "./types";

export function loadCredentialsFromEnv(siteKeys: string[]): Record<string, Credentials> {
  const out: Record<string, Credentials> = {};
  for (const key of siteKeys) {
    const prefix = `SCRAPER_${key.toUpperCase()}_`;
    const id = process.env[`${prefix}ID`];
    const pw = process.env[`${prefix}PW`];
    if (!id || !pw) continue;
    out[key] = { id, pw };
  }
  return out;
}

export function enabledSiteKeys(): string[] {
  const raw = process.env.SCRAPER_SITES;
  if (!raw || !raw.trim()) return [];
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}
