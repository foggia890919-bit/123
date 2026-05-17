import { createSign } from "node:crypto";

// ── JWT / 토큰 ─────────────────────────────────────────────────────────────

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
].join(" ");

let _cached: { token: string; exp: number } | null = null;

function b64u(v: Buffer | string) {
  return (typeof v === "string" ? Buffer.from(v) : v)
    .toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getToken(): Promise<string> {
  if (_cached && _cached.exp > Date.now() + 60_000) return _cached.token;

  const email = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const key   = process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("GOOGLE_DRIVE_CLIENT_EMAIL / PRIVATE_KEY 미설정");

  const now = Math.floor(Date.now() / 1000);
  const hdr = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const pay = b64u(JSON.stringify({ iss: email, scope: SCOPES, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${hdr}.${pay}`).sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${hdr}.${pay}.${b64u(sig)}` }),
  });
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google 토큰 발급 실패");
  _cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

// ── Sheets / Drive API 헬퍼 ────────────────────────────────────────────────

async function sheetsApi(path: string, method = "GET", body?: unknown) {
  const token = await getToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Sheets API ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function driveApi(path: string, method = "GET", body?: unknown) {
  const token = await getToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Drive API ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── 스프레드시트 찾기 or 생성 ─────────────────────────────────────────────

const SPREADSHEET_NAME = "KMD 데이터 현황";

async function findOrCreateSpreadsheet(): Promise<string> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const q = `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${folderId ? ` and '${folderId}' in parents` : ""}`;
  const list = await driveApi(`/files?q=${encodeURIComponent(q)}&fields=files(id,name)`) as { files: { id: string }[] };
  if (list.files.length > 0) return list.files[0].id;

  // 없으면 새로 생성
  const created = await sheetsApi("", "POST", {
    properties: { title: SPREADSHEET_NAME, locale: "ko_KR", timeZone: "Asia/Seoul" },
  }) as { spreadsheetId: string };

  if (folderId) {
    await driveApi(`/files/${created.spreadsheetId}?addParents=${folderId}&fields=id`, "PATCH");
  }
  return created.spreadsheetId;
}

// ── 시트 데이터 쓰기 ───────────────────────────────────────────────────────

export type SheetData = {
  name: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
};

export async function syncToSheets(sheets: SheetData[]): Promise<string> {
  const id = await findOrCreateSpreadsheet();

  // 현재 시트 목록 조회
  const meta = await sheetsApi(`/${id}?fields=sheets.properties`) as { sheets: { properties: { sheetId: number; title: string } }[] };
  const existingSheets = new Map(meta.sheets.map(s => [s.properties.title, s.properties.sheetId]));

  const requests: unknown[] = [];

  for (const sheet of sheets) {
    if (!existingSheets.has(sheet.name)) {
      requests.push({ addSheet: { properties: { title: sheet.name } } });
    }
  }

  // 기본 Sheet1 삭제 (새로 만든 경우에만 존재)
  const sheet1Id = existingSheets.get("Sheet1") ?? existingSheets.get("시트1");
  if (sheet1Id !== undefined && sheets.length > 0) {
    requests.push({ deleteSheet: { sheetId: sheet1Id } });
  }

  if (requests.length > 0) {
    await sheetsApi(`/${id}:batchUpdate`, "POST", { requests });
  }

  // 각 시트에 데이터 쓰기
  const data = sheets.map(sheet => ({
    range: `${sheet.name}!A1`,
    values: [sheet.headers, ...sheet.rows.map(r => r.map(c => c == null ? "" : String(c)))],
  }));

  await sheetsApi(`/${id}/values:batchUpdate`, "POST", {
    valueInputOption: "USER_ENTERED",
    data,
  });

  // 헤더 행 굵게 + 배경색 지정
  const finalMeta = await sheetsApi(`/${id}?fields=sheets.properties`) as { sheets: { properties: { sheetId: number; title: string } }[] };
  const sheetIdMap = new Map(finalMeta.sheets.map(s => [s.properties.title, s.properties.sheetId]));

  const formatRequests = sheets.flatMap(sheet => {
    const sid = sheetIdMap.get(sheet.name);
    if (sid === undefined) return [];
    return [
      {
        repeatCell: {
          range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.2, green: 0.4, blue: 0.7 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      },
      { autoResizeDimensions: { dimensions: { sheetId: sid, dimension: "COLUMNS", startIndex: 0, endIndex: sheet.headers.length } } },
    ];
  });

  if (formatRequests.length > 0) {
    await sheetsApi(`/${id}:batchUpdate`, "POST", { requests: formatRequests });
  }

  return `https://docs.google.com/spreadsheets/d/${id}`;
}
