import { createSign, createPrivateKey } from "node:crypto";

export interface SheetCreds {
  sheetId: string;
  email: string;
  privateKey: string;
}

let cached: { token: string; exp: number } | null = null;

async function getToken(c: SheetCreds): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: c.email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const unsigned = `${b64(header)}.${b64(claim)}`;
  const key = createPrivateKey(c.privateKey);
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
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

export async function appendRows(
  c: SheetCreds,
  rangeA1: string,
  rows: (string | number)[][],
): Promise<void> {
  if (rows.length === 0) return;
  const token = await getToken(c);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}/values/${encodeURIComponent(rangeA1)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`appendRows ${res.status}: ${await res.text()}`);
}

export async function readRange(c: SheetCreds, rangeA1: string): Promise<string[][]> {
  const token = await getToken(c);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}/values/${encodeURIComponent(rangeA1)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 400) return []; // tab missing
  if (!res.ok) throw new Error(`readRange ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

export async function ensureTab(c: SheetCreds, name: string, headers: string[]): Promise<void> {
  const token = await getToken(c);
  const meta = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!meta.ok) throw new Error(`meta ${meta.status}: ${await meta.text()}`);
  const json = (await meta.json()) as { sheets?: { properties: { title: string } }[] };
  if (json.sheets?.some((s) => s.properties.title === name)) return;
  const add = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: name } } }] }),
    },
  );
  if (!add.ok) throw new Error(`addSheet ${add.status}: ${await add.text()}`);
  if (headers.length > 0) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}/values/${encodeURIComponent(name + "!A1")}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [headers] }),
    });
    if (!res.ok) throw new Error(`headers ${res.status}: ${await res.text()}`);
  }
}

/**
 * 「상태」 칼럼이 취소/반품/환불 키워드 포함하면 행 전체 빨간 글씨.
 * 동일 조건의 룰이 이미 있으면 추가 안 함 (idempotent).
 */
export async function applyCancelRedRule(
  c: SheetCreds,
  tabName: string,
  statusColIndex: number, // 0-based
  totalCols: number,
): Promise<void> {
  const token = await getToken(c);
  const meta = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}?fields=sheets(properties(title,sheetId),conditionalFormats)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!meta.ok) throw new Error(`meta ${meta.status}: ${await meta.text()}`);
  const json = (await meta.json()) as {
    sheets?: {
      properties: { title: string; sheetId: number };
      conditionalFormats?: { booleanRule?: { condition?: { values?: { userEnteredValue?: string }[] } } }[];
    }[];
  };
  const sheet = json.sheets?.find((s) => s.properties.title === tabName);
  if (!sheet) return;
  const sheetId = sheet.properties.sheetId;
  const colLetter = String.fromCharCode(65 + statusColIndex);
  const formula = `=REGEXMATCH(TO_TEXT($${colLetter}2), "취소|환불|반품|cancel|refund|return")`;
  const exists = (sheet.conditionalFormats ?? []).some((cf) =>
    cf.booleanRule?.condition?.values?.some((v) => v.userEnteredValue === formula),
  );
  if (exists) return;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            addConditionalFormatRule: {
              rule: {
                ranges: [
                  {
                    sheetId,
                    startRowIndex: 1,
                    startColumnIndex: 0,
                    endColumnIndex: totalCols,
                  },
                ],
                booleanRule: {
                  condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: formula }] },
                  format: {
                    textFormat: {
                      foregroundColor: { red: 0.85, green: 0.1, blue: 0.1 },
                    },
                  },
                },
              },
              index: 0,
            },
          },
        ],
      }),
    },
  );
  if (!res.ok) throw new Error(`addConditionalFormatRule ${res.status}: ${await res.text()}`);
}

export function loadCredsFromEnv(): SheetCreds | null {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!sheetId || !email || !privateKey) return null;
  return { sheetId, email, privateKey };
}
