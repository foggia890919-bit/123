// 통계제출처 매핑 로우데이터 → 구글시트 축적 (전체 가입자 관리 목적).
//
// 별도 스프레드시트 "통계제출처 매핑"(env GOOGLE_SHEETS_SUBMISSION_ROUTES_NAME 로 재정의 가능)
// 을 GOOGLE_DRIVE_FOLDER_ID 폴더에 생성/탐색, 탭 "매핑현황" 전체 재기록(clear 후 write).
//
// - env(GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY) 미설정 시 조용히 skip.
// - 실패해도 앱 동작에 영향 없게 try/catch + console.error.
// - 연속 변경 대비 3초 최소 간격 + 실행 중 재요청은 종료 후 1회 재실행(coalesce).
// - /api/submission-routes 의 POST/PATCH/DELETE 성공 후 after() 로 fire-and-forget 호출.

import { prisma } from "@/lib/prisma";
import { companyNameKey } from "@/lib/company-name";
import { sheetsApi, findOrCreateSpreadsheet } from "./google-sheets";

const TAB = "매핑현황";
const HEADERS = ["가입아이디", "회원명", "제출법인", "거래처", "사업자번호", "제약사", "구분", "활성", "갱신시각"];
const MIN_INTERVAL_MS = 3000;

function envOk(): boolean {
  return !!process.env.GOOGLE_DRIVE_CLIENT_EMAIL && !!process.env.GOOGLE_DRIVE_PRIVATE_KEY;
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
  const routes = await prisma.submissionRoute.findMany({
    orderBy: [{ submissionEntity: "asc" }, { clientName: "asc" }, { companyName: "asc" }],
    select: {
      ownerId: true,
      clientName: true,
      companyName: true,
      submissionEntity: true,
      requestType: true,
      active: true,
      updatedAt: true,
      owner: { select: { email: true, name: true } },
    },
  });

  // 사업자번호: UserClient(ownerId + clientName 매칭). 없으면 빈칸.
  const ownerIds = [...new Set(routes.map((r) => r.ownerId))];
  const ucs = ownerIds.length
    ? await prisma.userClient.findMany({
        where: { userId: { in: ownerIds } },
        select: { userId: true, clientName: true, bizNumber: true },
      })
    : [];
  const bizMap = new Map<string, string>();
  for (const u of ucs) {
    const key = `${u.userId}|${companyNameKey(u.clientName)}`;
    if (!bizMap.has(key)) bizMap.set(key, u.bizNumber);
  }

  const rows = routes.map((r) => {
    const biz = bizMap.get(`${r.ownerId}|${companyNameKey(r.clientName)}`) ?? "";
    const bizDisplay = biz && !biz.startsWith("temp-") ? biz : "";
    return [
      r.owner?.email ?? "",
      r.owner?.name ?? "",
      r.submissionEntity,
      r.clientName,
      bizDisplay,
      r.companyName,
      r.requestType,
      r.active ? "활성" : "비활성",
      r.updatedAt.toISOString(),
    ];
  });

  const name = process.env.GOOGLE_SHEETS_SUBMISSION_ROUTES_NAME || "통계제출처 매핑";
  const id = await findOrCreateSpreadsheet(name);
  // 배포 후 Vercel 로그에서 주소를 뽑아 전달할 목적 — 매 동기화마다 한 줄.
  console.log("[submission-routes-sheet] spreadsheet:", "https://docs.google.com/spreadsheets/d/" + id);

  // 탭 "매핑현황" 없으면 생성(+ 새 시트의 기본 Sheet1 제거)
  const meta = (await sheetsApi(`/${id}?fields=sheets.properties`)) as {
    sheets: { properties: { sheetId: number; title: string } }[];
  };
  const existing = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
  const requests: unknown[] = [];
  if (!existing.has(TAB)) {
    requests.push({ addSheet: { properties: { title: TAB } } });
    const sheet1 = existing.get("Sheet1") ?? existing.get("시트1");
    if (sheet1 !== undefined) requests.push({ deleteSheet: { sheetId: sheet1 } });
  }
  if (requests.length > 0) {
    await sheetsApi(`/${id}:batchUpdate`, "POST", { requests });
  }

  // 전체 재기록 — clear 후 write
  await sheetsApi(`/${id}/values/${encodeURIComponent(`${TAB}!A:Z`)}:clear`, "POST", {});
  await sheetsApi(
    `/${id}/values/${encodeURIComponent(`${TAB}!A1`)}?valueInputOption=USER_ENTERED`,
    "PUT",
    { values: [HEADERS, ...rows] },
  );

  // 헤더 굵게 + 배경색
  const finalMeta = (await sheetsApi(`/${id}?fields=sheets.properties`)) as {
    sheets: { properties: { sheetId: number; title: string } }[];
  };
  const sid = finalMeta.sheets.find((s) => s.properties.title === TAB)?.properties.sheetId;
  if (sid !== undefined) {
    await sheetsApi(`/${id}:batchUpdate`, "POST", {
      requests: [
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
        { autoResizeDimensions: { dimensions: { sheetId: sid, dimension: "COLUMNS", startIndex: 0, endIndex: HEADERS.length } } },
      ],
    });
  }
}
