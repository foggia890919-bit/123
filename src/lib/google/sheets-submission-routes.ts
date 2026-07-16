// 통계제출처 관련 로우데이터 → 구글시트 한 곳으로 축적 (전체 가입자 관리 목적).
//
// 별도 스프레드시트 "통계제출처 매핑"(env GOOGLE_SHEETS_SUBMISSION_ROUTES_NAME 로 재정의 가능)
// 을 GOOGLE_DRIVE_FOLDER_ID 폴더에 생성/탐색, 3개 탭 전체 재기록(clear 후 write):
//   1) 매핑현황  — SubmissionRoute 전체
//   2) 거래처 명부 — UserClient(dealerType null) 전체 + 매핑에만 존재하는 고아 clientName
//   3) 법인 명부  — distinct 제출법인 + 회원 연결 상태 + 사용 매핑 수
//
// - env(GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY) 미설정 시 조용히 skip.
// - 실패해도 앱 동작에 영향 없게 try/catch + console.error.
// - 연속 변경 대비 3초 최소 간격 + 실행 중 재요청은 종료 후 1회 재실행(coalesce).
// - /api/submission-routes, /api/user-clients 의 성공 변경 후 after() 로 fire-and-forget 호출.

import { prisma } from "@/lib/prisma";
import { companyNameKey, normalizeCompanyName } from "@/lib/company-name";
import { sheetsApi, findOrCreateSpreadsheet } from "./google-sheets";

const MIN_INTERVAL_MS = 3000;

const TAB_ROUTES = "매핑현황";
const TAB_CLIENTS = "거래처 명부";
const TAB_ENTITIES = "법인 명부";

const HEADERS_ROUTES = ["가입아이디", "회원명", "제출법인", "거래처", "사업자번호", "제약사", "구분", "활성", "갱신시각"];
const HEADERS_CLIENTS = ["가입아이디", "회원명", "거래처명", "사업자번호", "등록일", "비고"];
const HEADERS_ENTITIES = ["법인명", "연결회원(가입아이디)", "연결상태", "사용중인 매핑 수"];

type Cell = string | number;
type TabData = { name: string; headers: string[]; rows: Cell[][] };

function envOk(): boolean {
  return !!process.env.GOOGLE_DRIVE_CLIENT_EMAIL && !!process.env.GOOGLE_DRIVE_PRIVATE_KEY;
}
function bizDisplay(biz: string): string {
  return biz && !biz.startsWith("temp-") ? biz : "";
}

let running = false;
let pending = false;
let lastRun = 0;

// 3초 최소 간격 debounce + 실행 중 재요청 coalesce.
export async function syncSubmissionRoutesSheet(): Promise<void> {
  if (!envOk()) return; // 시트 연동 env 미설정 → 조용히 skip
  if (running) { pending = true; return; }
  running = true;
  try {
    do {
      pending = false;
      const wait = MIN_INTERVAL_MS - (Date.now() - lastRun);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await doSync();
      lastRun = Date.now();
    } while (pending);
  } catch (e) {
    console.error("[submission-routes-sheet] sync 실패:", e);
  } finally {
    running = false;
  }
}

async function doSync(): Promise<void> {
  // ── 데이터 조회 ──
  const [routes, userClients] = await Promise.all([
    prisma.submissionRoute.findMany({
      orderBy: [{ submissionEntity: "asc" }, { clientName: "asc" }, { companyName: "asc" }],
      select: {
        ownerId: true,
        clientName: true,
        companyName: true,
        submissionEntity: true,
        requestType: true,
        active: true,
        updatedAt: true,
        parentUserId: true,
        owner: { select: { email: true, name: true } },
        parentUser: { select: { email: true, name: true } },
      },
    }),
    prisma.userClient.findMany({
      where: { dealerType: null },
      orderBy: { clientName: "asc" },
      select: {
        userId: true,
        clientName: true,
        bizNumber: true,
        createdAt: true,
        user: { select: { email: true, name: true } },
      },
    }),
  ]);

  // 사업자번호 map (매핑현황 탭용): (userId, clientName) → bizNumber
  const bizMap = new Map<string, string>();
  for (const u of userClients) {
    const key = `${u.userId}|${companyNameKey(u.clientName)}`;
    if (!bizMap.has(key)) bizMap.set(key, u.bizNumber);
  }

  // ── 탭1: 매핑현황 ──
  const routeRows: Cell[][] = routes.map((r) => [
    r.owner?.email ?? "",
    r.owner?.name ?? "",
    normalizeCompanyName(r.submissionEntity) || r.submissionEntity,
    r.clientName,
    bizDisplay(bizMap.get(`${r.ownerId}|${companyNameKey(r.clientName)}`) ?? ""),
    normalizeCompanyName(r.companyName) || r.companyName,
    r.requestType,
    r.active ? "활성" : "비활성",
    r.updatedAt.toISOString(),
  ]);

  // ── 탭2: 거래처 명부 (UserClient + 매핑 고아) ──
  const ucKeys = new Set(userClients.map((u) => `${u.userId}|${companyNameKey(u.clientName)}`));
  const clientRows: Cell[][] = userClients.map((u) => [
    u.user?.email ?? "",
    u.user?.name ?? "",
    u.clientName,
    bizDisplay(u.bizNumber),
    u.createdAt.toISOString().slice(0, 10),
    "",
  ]);
  const seenOrphan = new Set<string>();
  for (const r of routes) {
    const k = `${r.ownerId}|${companyNameKey(r.clientName)}`;
    if (ucKeys.has(k) || seenOrphan.has(k)) continue;
    seenOrphan.add(k);
    clientRows.push([r.owner?.email ?? "", r.owner?.name ?? "", r.clientName, "", "", "매핑에만 존재"]);
  }

  // ── 탭3: 법인 명부 (distinct submissionEntity) ──
  const entityMap = new Map<string, { name: string; linked: boolean; email: string | null; count: number }>();
  for (const r of routes) {
    let e = entityMap.get(r.submissionEntity);
    if (!e) { e = { name: r.submissionEntity, linked: false, email: null, count: 0 }; entityMap.set(r.submissionEntity, e); }
    e.count++;
    if (r.parentUserId) { e.linked = true; if (r.parentUser?.email) e.email = r.parentUser.email; }
  }
  const entityRows: Cell[][] = Array.from(entityMap.values())
    .sort((a, b) => normalizeCompanyName(a.name).localeCompare(normalizeCompanyName(b.name), "ko"))
    .map((e) => [
      normalizeCompanyName(e.name) || e.name,
      e.email ?? "",
      e.linked ? "회원연결" : "직접입력",
      e.count,
    ]);

  // ── 기록 ──
  const tabs: TabData[] = [
    { name: TAB_ROUTES, headers: HEADERS_ROUTES, rows: routeRows },
    { name: TAB_CLIENTS, headers: HEADERS_CLIENTS, rows: clientRows },
    { name: TAB_ENTITIES, headers: HEADERS_ENTITIES, rows: entityRows },
  ];

  const name = process.env.GOOGLE_SHEETS_SUBMISSION_ROUTES_NAME || "통계제출처 매핑";
  const id = await findOrCreateSpreadsheet(name);
  console.log("[submission-routes-sheet] spreadsheet:", "https://docs.google.com/spreadsheets/d/" + id);

  await ensureTabs(id, tabs.map((t) => t.name));
  for (const t of tabs) {
    await sheetsApi(`/${id}/values/${encodeURIComponent(`${t.name}!A:Z`)}:clear`, "POST", {});
    await sheetsApi(
      `/${id}/values/${encodeURIComponent(`${t.name}!A1`)}?valueInputOption=USER_ENTERED`,
      "PUT",
      { values: [t.headers, ...t.rows] },
    );
  }
  await formatHeaders(id, tabs);
}

// 필요한 탭들이 없으면 생성(+ 새 시트 기본 Sheet1 제거).
async function ensureTabs(id: string, tabNames: string[]): Promise<void> {
  const meta = (await sheetsApi(`/${id}?fields=sheets.properties`)) as {
    sheets: { properties: { sheetId: number; title: string } }[];
  };
  const existing = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const requests: unknown[] = [];
  let addedAny = false;
  for (const t of tabNames) {
    if (!existing.has(t)) { requests.push({ addSheet: { properties: { title: t } } }); addedAny = true; }
  }
  if (addedAny) {
    const sheet1 = existing.get("Sheet1") ?? existing.get("시트1");
    if (sheet1 !== undefined && !tabNames.includes("Sheet1")) requests.push({ deleteSheet: { sheetId: sheet1 } });
  }
  if (requests.length > 0) await sheetsApi(`/${id}:batchUpdate`, "POST", { requests });
}

// 각 탭 헤더 굵게 + 배경색 + 열 자동 폭.
async function formatHeaders(id: string, tabs: TabData[]): Promise<void> {
  const meta = (await sheetsApi(`/${id}?fields=sheets.properties`)) as {
    sheets: { properties: { sheetId: number; title: string } }[];
  };
  const sidByTitle = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const requests = tabs.flatMap((t) => {
    const sid = sidByTitle.get(t.name);
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
      { autoResizeDimensions: { dimensions: { sheetId: sid, dimension: "COLUMNS", startIndex: 0, endIndex: t.headers.length } } },
    ];
  });
  if (requests.length > 0) await sheetsApi(`/${id}:batchUpdate`, "POST", { requests });
}
