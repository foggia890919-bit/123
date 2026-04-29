import { decrypt } from "./crypto";

/**
 * 구글시트 동기화. Service Account 자격증명이 환경변수로 설정되어야 동작.
 * 미설정 시 no-op 으로 통과 (사장님이 시트 공유 후 키만 채우면 자동으로 켜짐).
 */
export interface SheetRow {
  values: (string | number)[];
}

export interface SheetsConfig {
  sheetId: string;
  email: string;
  privateKey: string;
}

export interface WorkspaceSheetCreds {
  googleSheetsId?: string | null;
  googleServiceAccountEmail?: string | null;
  googleServiceAccountKey?: string | null;
}

function getConfig(ws?: WorkspaceSheetCreds): SheetsConfig | null {
  const sheetId = ws?.googleSheetsId || process.env.GOOGLE_SHEETS_ID;
  const email = ws?.googleServiceAccountEmail || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = ws?.googleServiceAccountKey
    ? decrypt(ws.googleServiceAccountKey)
    : process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "";
  const privateKey = rawKey?.replace(/\\n/g, "\n");
  if (!sheetId || !email || !privateKey) return null;
  return { sheetId, email, privateKey };
}

export function getWorkspaceSheetUrl(sheetId?: string | null): string | null {
  const id = sheetId || process.env.GOOGLE_SHEETS_ID;
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
}

async function getAccessToken(cfg: SheetsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: cfg.email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const unsigned = `${encode(header)}.${encode(claim)}`;
  const { createSign, createPrivateKey } = await import("node:crypto");
  const key = createPrivateKey(cfg.privateKey);
  const sig = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(key)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const jwt = `${unsigned}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Sheets token ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export async function appendRows(
  rangeA1: string,
  rows: (string | number)[][],
  ws?: WorkspaceSheetCreds,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const cfg = getConfig(ws);
  if (!cfg) return { ok: true, skipped: true };
  try {
    const token = await getAccessToken(cfg);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function overwriteSheet(
  rangeA1: string,
  rows: (string | number)[][],
  ws?: WorkspaceSheetCreds,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const cfg = getConfig(ws);
  if (!cfg) return { ok: true, skipped: true };
  try {
    const token = await getAccessToken(cfg);
    const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(rangeA1)}:clear`;
    await fetch(clearUrl, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(rangeA1)}?valueInputOption=USER_ENTERED`;
    const res = await fetch(updateUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    });
    if (!res.ok) return { ok: false, error: `${res.status} ${await res.text()}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function getSheetUrl(): string | null {
  const id = process.env.GOOGLE_SHEETS_ID;
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
}

export const SHEET_TABS = {
  raw: process.env.SHEET_TAB_RAW || "주문원본",
  daily: process.env.SHEET_TAB_DAILY || "일일집계",
  cost: process.env.SHEET_TAB_COST || "원가",
};

export async function ensureTabExists(
  tabName: string,
  headers: string[],
  ws?: WorkspaceSheetCreds,
): Promise<{ ok: boolean; created?: boolean; error?: string }> {
  const cfg = getConfig(ws);
  if (!cfg) return { ok: true };
  try {
    const token = await getAccessToken(cfg);
    const meta = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!meta.ok) return { ok: false, error: `${meta.status} ${await meta.text()}` };
    const json = (await meta.json()) as { sheets?: { properties: { title: string } }[] };
    const exists = json.sheets?.some((s) => s.properties.title === tabName);
    if (exists) return { ok: true, created: false };

    const add = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}:batchUpdate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: tabName } } }],
        }),
      },
    );
    if (!add.ok) return { ok: false, error: `addSheet ${add.status} ${await add.text()}` };
    if (headers.length > 0) {
      await overwriteSheet(`${tabName}!A1`, [headers], ws);
    }
    return { ok: true, created: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
