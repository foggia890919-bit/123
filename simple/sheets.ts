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

function colLetter(idx: number): string {
  let result = "";
  let n = idx;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/**
 * 키 기준 upsert. 이미 있으면 그 행 덮어쓰기, 없으면 append.
 * 동일 키가 시트에 여러 번 있으면 첫 번째만 남기고 나머지 삭제 (자동 dedup).
 */
export async function upsertRows(
  c: SheetCreds,
  tabName: string,
  rows: (string | number)[][],
  getKey: (row: (string | number)[]) => string,
): Promise<{ updated: number; appended: number; deduped: number }> {
  if (rows.length === 0) return { updated: 0, appended: 0, deduped: 0 };
  const numCols = rows[0].length;
  const lastCol = colLetter(numCols - 1);
  const token = await getToken(c);

  const existing = await readRange(c, `${tabName}!A2:${lastCol}100000`);
  const keyToRow = new Map<string, number>();
  const dupRows: number[] = [];
  // 첫 번째 발견된 행은 유지(거기에 update). 이후 중복 행은 삭제 대상.
  existing.forEach((row, idx) => {
    const k = getKey(row as (string | number)[]);
    if (!k) return;
    const rowNum = idx + 2;
    if (keyToRow.has(k)) dupRows.push(rowNum);
    else keyToRow.set(k, rowNum);
  });

  if (dupRows.length > 0) {
    const meta = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (meta.ok) {
      const json = (await meta.json()) as {
        sheets?: { properties: { title: string; sheetId: number } }[];
      };
      const sheetId = json.sheets?.find((s) => s.properties.title === tabName)?.properties.sheetId;
      if (sheetId != null) {
        const sortedDesc = [...dupRows].sort((a, b) => b - a);
        const requests = sortedDesc.map((rowNum) => ({
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowNum - 1, endIndex: rowNum },
          },
        }));
        const res = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}:batchUpdate`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ requests }),
          },
        );
        if (!res.ok) throw new Error(`dedup ${res.status}: ${await res.text()}`);
        // 첫 번째 행이 삭제된 중복들 위에 있었으면 행 번호가 그대로지만,
        // 아래에 있었으면 (드물지만) 행 번호가 위로 밀림. 보정.
        const sortedAsc = [...dupRows].sort((a, b) => a - b);
        for (const [k, rowNum] of keyToRow.entries()) {
          let shift = 0;
          for (const dup of sortedAsc) {
            if (dup < rowNum) shift++;
            else break;
          }
          if (shift > 0) keyToRow.set(k, rowNum - shift);
        }
      }
    }
  }

  const seen = new Set<string>();
  const updates: { range: string; values: (string | number)[][] }[] = [];
  const appends: (string | number)[][] = [];
  for (const row of rows) {
    const k = getKey(row);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    if (k && keyToRow.has(k)) {
      const rowNum = keyToRow.get(k)!;
      updates.push({ range: `${tabName}!A${rowNum}:${lastCol}${rowNum}`, values: [row] });
    } else {
      appends.push(row);
    }
  }

  if (updates.length > 0) {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}/values:batchUpdate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updates }),
      },
    );
    if (!res.ok) throw new Error(`values:batchUpdate ${res.status}: ${await res.text()}`);
  }
  if (appends.length > 0) {
    await appendRows(c, `${tabName}!A2`, appends);
  }
  return { updated: updates.length, appended: appends.length, deduped: dupRows.length };
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

export async function writeRange(
  c: SheetCreds,
  rangeA1: string,
  values: (string | number)[][],
): Promise<void> {
  const token = await getToken(c);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}/values/${encodeURIComponent(rangeA1)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`writeRange ${res.status}: ${await res.text()}`);
}

export async function ensureTab(c: SheetCreds, name: string, headers: string[]): Promise<void> {
  const token = await getToken(c);
  const meta = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!meta.ok) throw new Error(`meta ${meta.status}: ${await meta.text()}`);
  const json = (await meta.json()) as { sheets?: { properties: { title: string } }[] };
  const exists = json.sheets?.some((s) => s.properties.title === name);
  if (!exists) {
    const add = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}:batchUpdate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: name } } }] }),
      },
    );
    if (!add.ok) throw new Error(`addSheet ${add.status}: ${await add.text()}`);
  }
  if (headers.length > 0) {
    // 항상 헤더 덮어쓰기 (idempotent: 같으면 변화 없음, 칼럼 추가 시 자동 업데이트)
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
 * 같은 패턴의 기존 룰이 있으면 모두 제거 후 새로 추가 (idempotent + repair).
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
  const colL = String.fromCharCode(65 + statusColIndex);
  const formula = `=REGEXMATCH(TO_TEXT($${colL}2),"취소|환불|반품|cancel|refund|return")`;

  const existing = sheet.conditionalFormats ?? [];
  const ourIndices: number[] = [];
  existing.forEach((cf, idx) => {
    const v = cf.booleanRule?.condition?.values?.[0]?.userEnteredValue ?? "";
    if (v.includes("취소") || v.includes("환불") || v.includes("반품")) ourIndices.push(idx);
  });

  const requests: unknown[] = [];
  // 인덱스 큰 것부터 삭제 (삭제하면 인덱스 밀림)
  for (const idx of [...ourIndices].sort((a, b) => b - a)) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: idx } });
  }
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalCols },
        ],
        booleanRule: {
          condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: formula }] },
          format: {
            textFormat: {
              foregroundColor: { red: 0.85, green: 0.1, blue: 0.1 },
              strikethrough: true,
            },
          },
        },
      },
      index: 0,
    },
  });

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${c.sheetId}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    },
  );
  if (!res.ok) throw new Error(`condFormat ${res.status}: ${await res.text()}`);
}

export function loadCredsFromEnv(): SheetCreds | null {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!sheetId || !email || !privateKey) return null;
  return { sheetId, email, privateKey };
}
