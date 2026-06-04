/**
 * 사장님 개인용 — 매일 09시 매출 보고.
 *
 * 흐름:
 *   1. Naver API 로 어제 결제건 모두 수집 (multi-type + 페이지네이션 + orderId 재조회)
 *   2. Google Sheet 「주문원본」 탭에 raw 행 append
 *   3. Sheet 「옵션매핑」 탭 읽어서 키워드 룰 로드 (없으면 코드 기본값)
 *   4. 매핑 적용 → 키워드별 집계 → Sheet 「일일집계」 탭 append
 *   5. 텔레그램 발송
 *
 * 환경변수 (.env):
 *   NAVER_STORES_JSON     '[{"name":"...","clientId":"...","clientSecret":"$2a$..."}]'
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *   GOOGLE_SHEETS_ID                    (선택 — 시트 안 쓰면 비워둠)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL        (선택)
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  (선택, JSON 의 private_key 값. \n 그대로)
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyCancelRedRule,
  ensureTab,
  readRange,
  loadCredsFromEnv,
  upsertRows,
  getSheetIdMap,
  type SheetCreds,
} from "./sheets";

// ─────────────────── 여기명품 사입관리 시트 (별도 스프레드시트)
// 사장님이 매번 사입 정보 수동 입력. AD = 상품주문번호, AB = 도매가+배송비+박스비 통합 (총비용)
const YEOGI_WHOLESALE_SPREADSHEET_ID = "10DgfEqudeXOBmFFm8vyOHHuHJp6nZXKaxv4ecpbVhno";
const YEOGI_WHOLESALE_GID = 30917428;
const YEOGI_STORE = "여기명품";

async function loadYeogiWholesaleMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!SHEET_CREDS) return map;
  try {
    const altCreds: SheetCreds = { ...SHEET_CREDS, sheetId: YEOGI_WHOLESALE_SPREADSHEET_ID };
    // gid → 탭 이름 자동 조회
    const sheetIdMap = await getSheetIdMap(altCreds);
    let tabName: string | undefined;
    for (const [name, gid] of sheetIdMap.entries()) {
      if (gid === YEOGI_WHOLESALE_GID) { tabName = name; break; }
    }
    if (!tabName) {
      console.warn(`[여기명품 사입관리] gid=${YEOGI_WHOLESALE_GID} 탭 못 찾음 (시트 공유 권한 확인)`);
      return map;
    }
    const rows = await readRange(altCreds, `${tabName}!A2:AD100000`);
    for (const r of rows) {
      // AB = index 27 (도매가+배송비+박스비 통합 = 총비용), AD = index 29 (상품주문번호)
      const wholesale = Number(String(r[27] ?? "").replace(/,/g, "")) || 0;
      const productOrderId = String(r[29] ?? "").trim();
      if (productOrderId && wholesale > 0) {
        map.set(productOrderId, wholesale);
      }
    }
    if (map.size > 0) console.log(`여기명품 사입관리 ${map.size}건 매핑 로드`);
    else console.log(`여기명품 사입관리 매핑 0건 — AD열 상품주문번호 입력 확인`);
  } catch (err) {
    console.warn(`[여기명품 사입관리] 시트 읽기 실패 (권한·공유 확인): ${err instanceof Error ? err.message : String(err)}`);
  }
  return map;
}

/**
 * 「주문원본」 누적 데이터에서 (채널상품번호|옵션) → 최근 원가단가(개당) 맵.
 * 여기명품 사입 입력이 늦어 당일 18~24시 주문 원가가 비는 경우,
 * 같은 옵션의 가장 최근(결제일 기준) 단가로 임시 보정하기 위함.
 * RAW_HEADERS idx: 0결제일 1스토어 4채널상품번호 6옵션 8수량 15원가
 */
async function loadRecentCostByOption(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!SHEET_CREDS) return out;
  try {
    const rows = await readRange(SHEET_CREDS, "주문원본!A2:R100000");
    const latest = new Map<string, { date: string; unit: number }>();
    for (const r of rows) {
      if (String(r[1] ?? "").trim() !== YEOGI_STORE) continue;
      const chNo = String(r[4] ?? "").trim();
      const opt = String(r[6] ?? "").trim();
      const qty = Number(String(r[8] ?? "").replace(/,/g, "")) || 0;
      const cost = Number(String(r[15] ?? "").replace(/,/g, "")) || 0;
      if (!chNo || qty <= 0 || cost <= 0) continue;
      const key = `${chNo}|${opt}`;
      const date = String(r[0] ?? "");
      const prev = latest.get(key);
      if (!prev || date > prev.date) latest.set(key, { date, unit: cost / qty });
    }
    for (const [k, v] of latest) out.set(k, Math.round(v.unit));
    if (out.size > 0) console.log(`[여기명품] 옵션별 최근 원가단가 ${out.size}건 로드 (사입 누락 보정용)`);
  } catch (err) {
    console.warn(`[여기명품] 주문원본 원가이력 로드 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

// ─────────────────── 설정
interface StoreConfig {
  name: string;
  clientId: string;
  clientSecret: string;
}

const STORES: StoreConfig[] = JSON.parse(process.env.NAVER_STORES_JSON ?? "[]");
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const SHEET_CREDS: SheetCreds | null = loadCredsFromEnv();

// 시트 「옵션매핑」 탭 없을 때 사용할 코드 기본값
interface Rule {
  pattern: string;
  keyword: string;
  costPerUnit: number;
  logisticsPerOrder: number;
}
const DEFAULT_RULES: Rule[] = [
  { pattern: "피쿠알", keyword: "피쿠알", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "picual", keyword: "피쿠알", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "아르베키나", keyword: "아르베키나", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "arbequina", keyword: "아르베키나", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "블렌딩", keyword: "블렌딩", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "blending", keyword: "블렌딩", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "아보카도", keyword: "아보카도오일", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "avocado", keyword: "아보카도오일", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "레몬", keyword: "레몬즙", costPerUnit: 0, logisticsPerOrder: 0 },
  { pattern: "lemon", keyword: "레몬즙", costPerUnit: 0, logisticsPerOrder: 0 },
];

// ─────────────────── 비타앤오리진 기본 원가/물류 (fallback)
// ⭐옵션매핑·여기명품 사입 등 명시값이 있으면 그게 우선. 없을 때만 아래 기본값 적용.
// 올리브오일(피쿠알/아르베키나/블렌딩) 5,200/병, 아보카도오일 5,000/병, 레몬즙 3,200/병
// 물류비는 출고(주문)당 4,500원 — 한 주문에 여러 병이어도 1회만.
const VITA_STORE = "비타앤오리진";
const VITA_DEFAULT_LOGISTICS = 4500;
const VITA_COST_BY_KEYWORD: Record<string, number> = {
  "피쿠알": 5200,
  "아르베키나": 5200,
  "블렌딩": 5200,
  "아보카도오일": 5000,
  "레몬즙": 3200,
};

// ─────────────────── 시간 (KST)
const KST_OFFSET = 9 * 60 * 60 * 1000;

function previousDayKstRange(now: Date = new Date()): { fromIso: string; toIso: string; dateStr: string } {
  const kst = new Date(now.getTime() + KST_OFFSET);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
  const start = Date.UTC(y, m, d - 1) - KST_OFFSET;
  const end = Date.UTC(y, m, d) - KST_OFFSET;
  return {
    fromIso: new Date(start).toISOString(),
    toIso: new Date(end).toISOString(),
    dateStr: new Date(Date.UTC(y, m, d - 1)).toISOString().slice(0, 10),
  };
}

function dateKstRange(s: string): { fromIso: string; toIso: string; dateStr: string } {
  const [y, m, d] = s.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d) - KST_OFFSET;
  const end = Date.UTC(y, m - 1, d + 1) - KST_OFFSET;
  return { fromIso: new Date(start).toISOString(), toIso: new Date(end).toISOString(), dateStr: s };
}

// ─────────────────── Naver API
const NAVER_BASE = "https://api.commerce.naver.com/external";
const tokenCache = new Map<string, { token: string; exp: number }>();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const cached = tokenCache.get(clientId);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const ts = Date.now();
  const sign = Buffer.from(bcrypt.hashSync(`${clientId}_${ts}`, clientSecret), "utf8").toString("base64");
  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(ts),
    grant_type: "client_credentials",
    client_secret_sign: sign,
    type: "SELF",
  });
  const res = await fetch(`${NAVER_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(clientId, { token: data.access_token, exp: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

async function naverFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${NAVER_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface BulkOrder {
  productOrder: {
    productOrderId: string;
    orderId?: string;
    productName: string;
    productOption?: string;
    quantity: number;
    unitPrice: number;
    totalPaymentAmount: number;
    productOrderStatus?: string;
    knowledgeShoppingSellingInterlockCommission?: number;
    payCommissionAmount?: number;
    settlementAmount?: number;
    settleAmount?: number;
    expectedSettlementAmount?: number;
    paymentDate?: string;
    channelProductNo?: string;
    productId?: string;
    // 옵션 매칭용 후보 필드들 (네이버 API 응답에 있을 수 있는 키들 — 진단 후 확정)
    optionManageCode?: string;
    sellerProductManagementCode?: string;
    optionCode?: string;
    sellerManagementCode?: string;
    productOptionId?: string | number;
  };
  order?: { orderId: string; ordererName?: string; paymentDate?: string };
}

async function fetchOrdersForDay(store: StoreConfig, fromIso: string, toIso: string): Promise<BulkOrder[]> {
  const token = await getAccessToken(store.clientId, store.clientSecret);

  // Naver last-changed-statuses 는 최대 24시간 창. 결제일 이후 30일까지 (또는 NOW 까지)
  // 상태변경된 주문도 캐치하기 위해 24시간씩 청크로 쪼개서 호출.
  const lastChangedFromMs = new Date(fromIso).getTime();
  const lastChangedToMs = Math.min(
    new Date(toIso).getTime() + 30 * 24 * 60 * 60 * 1000,
    Date.now(),
  );
  const dayMs = 24 * 60 * 60 * 1000;
  const chunks: { from: string; to: string }[] = [];
  for (let cur = lastChangedFromMs; cur < lastChangedToMs; cur += dayMs) {
    const next = Math.min(cur + dayMs, lastChangedToMs);
    chunks.push({
      from: new Date(cur).toISOString(),
      to: new Date(next).toISOString(),
    });
  }

  const allIds = new Set<string>();
  const orderIds = new Set<string>();

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    if (ci > 0) await sleep(1500);
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      if (page > 0) await sleep(1200);
      const params = new URLSearchParams({
        lastChangedFrom: chunk.from,
        lastChangedTo: chunk.to,
      });
      if (cursor) params.set("moreSequence", cursor);
      try {
        const data = await naverFetch<{
          data?: {
            lastChangeStatuses?: { productOrderId: string; orderId: string }[];
            more?: { moreSequence?: string };
          };
        }>(token, `/v1/pay-order/seller/product-orders/last-changed-statuses?${params}`);
        for (const row of data.data?.lastChangeStatuses ?? []) {
          allIds.add(row.productOrderId);
          orderIds.add(row.orderId);
        }
        cursor = data.data?.more?.moreSequence;
        if (!cursor) break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes(" 429 ")) {
          console.warn(`[${store.name}] RATE_LIMIT — 30초 대기`);
          await sleep(30_000);
        } else {
          console.warn(`[${store.name}] chunk ${ci + 1}/${chunks.length}: ${msg.slice(0, 100)}`);
        }
        break;
      }
    }
  }
  console.log(`[${store.name}] step1 (${chunks.length}청크): productOrderIds=${allIds.size}, orderIds=${orderIds.size}`);

  // Step 2: orderId 별 productOrderId 재조회 (형제 productOrder 누락 방지)
  if (orderIds.size > 0 && orderIds.size <= 500) {
    let added = 0;
    for (const oid of orderIds) {
      await sleep(500);
      try {
        const data = await naverFetch<{ data?: { productOrderIds?: string[]; contents?: { productOrderId: string }[] } }>(
          token,
          `/v1/pay-order/seller/orders/${oid}/product-order-ids`,
        );
        const ids = data.data?.productOrderIds
          ?? data.data?.contents?.map((c) => c.productOrderId)
          ?? [];
        for (const id of ids) {
          if (!allIds.has(id)) {
            allIds.add(id);
            added += 1;
          }
        }
      } catch {
        // 일부 실패는 무시
      }
    }
    console.log(`[${store.name}] step2 재조회 +${added}건 → 누적 ${allIds.size}`);
  }

  if (allIds.size === 0) return [];

  // Step 3: bulk 상세 조회 (300개 단위)
  const idArr = Array.from(allIds);
  const raw: BulkOrder[] = [];
  for (let i = 0; i < idArr.length; i += 300) {
    if (i > 0) await sleep(1500);
    const slice = idArr.slice(i, i + 300);
    const data = await naverFetch<{ data?: BulkOrder[] }>(token, `/v1/pay-order/seller/product-orders/query`, {
      method: "POST",
      body: JSON.stringify({ productOrderIds: slice, quantityClaimCompatibility: true }),
    });
    for (const row of data.data ?? []) raw.push(row);
  }

  // Step 4: paymentDate 가 윈도우 안인 것만 + productOrderId 기준 dedup
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const seenPids = new Set<string>();
  const out: BulkOrder[] = [];
  for (const row of raw) {
    const pid = row.productOrder.productOrderId;
    if (seenPids.has(pid)) continue;
    seenPids.add(pid);
    const dateStr = row.productOrder.paymentDate ?? row.order?.paymentDate;
    if (!dateStr) continue;
    const t = new Date(dateStr).getTime();
    if (t >= fromMs && t < toMs) out.push(row);
  }
  console.log(`[${store.name}] bulk ${raw.length} → 결제일 필터 ${out.length}개`);
  return out;
}

// ─────────────────── 키워드 매핑
async function loadRules(): Promise<Rule[]> {
  // 시트 「옵션매핑」 (A=패턴, B=키워드, C=원가(개당), D=물류비(개당)) 우선, 없으면 코드 기본값
  if (!SHEET_CREDS) return DEFAULT_RULES;
  try {
    await ensureTab(SHEET_CREDS, "옵션매핑", ["패턴", "키워드", "원가(개당)", "물류비(건당)"]);
    const rows = await readRange(SHEET_CREDS, "옵션매핑!A2:D10000");
    const fromSheet = rows
      .filter((r) => r[0] && r[1])
      .map((r) => ({
        pattern: String(r[0]),
        keyword: String(r[1]),
        costPerUnit: Number(String(r[2] ?? "").replace(/,/g, "")) || 0,
        logisticsPerOrder: Number(String(r[3] ?? "").replace(/,/g, "")) || 0,
      }));
    if (fromSheet.length > 0) {
      console.log(`시트 옵션매핑 ${fromSheet.length}개 로드`);
      return [...fromSheet, ...DEFAULT_RULES];
    }
  } catch (err) {
    console.warn("옵션매핑 시트 읽기 실패:", err instanceof Error ? err.message : String(err));
  }
  return DEFAULT_RULES;
}

// 「⭐옵션매핑」 — 사장님이 직접 입력하는 옵션관리번호별 매핑 (정밀)
interface OptionMapRule {
  originProductNo: string;
  channelProductNo: string;
  optionManageCode: string;
  label: string;
  costPerUnit: number;
  logisticsPerOrder: number;
  type: "메인" | "추가" | ""; // 빈 칸 = 미지정
}

/**
 * 「⭐옵션매핑」 시트 로드. 사장님이 「상품목록」 시트 보고 직접 매핑 입력.
 *
 * 시트 컬럼:
 *   A 원본상품번호, B 채널상품번호, C 옵션관리번호, D 라벨,
 *   E 원가(개당), F 물류비(건당), G 유형(메인/추가)
 *
 * 매칭 키 (우선순위):
 *   1. `${channelProductNo}|${optionManageCode}` (가장 정밀)
 *   2. `${channelProductNo}` (옵션관리번호 비어있을 때 = 상품 전체 매핑)
 */
async function loadOptionMapping(): Promise<Map<string, OptionMapRule>> {
  const map = new Map<string, OptionMapRule>();
  if (!SHEET_CREDS) return map;
  try {
    await ensureTab(SHEET_CREDS, "⭐옵션매핑", [
      "원본상품번호",
      "채널상품번호",
      "옵션관리번호",
      "라벨",
      "원가(개당)",
      "물류비(건당)",
      "유형(메인/추가)",
    ]);
    const rows = await readRange(SHEET_CREDS, "⭐옵션매핑!A2:G10000");
    for (const r of rows) {
      const originNo = String(r[0] ?? "").trim();
      const chNo = String(r[1] ?? "").trim();
      const optCode = String(r[2] ?? "").trim();
      const label = String(r[3] ?? "").trim();
      if (!chNo) continue; // 채널상품번호 필수
      const cost = Number(String(r[4] ?? "").replace(/,/g, "")) || 0;
      const logi = Number(String(r[5] ?? "").replace(/,/g, "")) || 0;
      const typeStr = String(r[6] ?? "").trim();
      const type: OptionMapRule["type"] =
        typeStr === "메인" || typeStr.toLowerCase() === "main" ? "메인"
          : typeStr === "추가" || typeStr.toLowerCase() === "additional" ? "추가"
            : "";
      const key = optCode ? `${chNo}|${optCode}` : chNo;
      map.set(key, {
        originProductNo: originNo,
        channelProductNo: chNo,
        optionManageCode: optCode,
        label: label || chNo,
        costPerUnit: cost,
        logisticsPerOrder: logi,
        type,
      });
    }
    if (map.size > 0) console.log(`⭐옵션매핑 ${map.size}개 로드`);
  } catch (err) {
    console.warn("⭐옵션매핑 시트 읽기 실패:", err instanceof Error ? err.message : String(err));
  }
  return map;
}

function classify(productName: string, option: string, rules: Rule[]): Rule | null {
  // 상품명 우선 매칭 (어떤 상품의 주문전환인지가 먼저).
  // 상품명에 매칭 없으면 옵션으로 fallback.
  const namelower = productName.toLowerCase();
  for (const r of rules) {
    if (namelower.includes(r.pattern.toLowerCase())) return r;
  }
  if (option) {
    const optlower = option.toLowerCase();
    for (const r of rules) {
      if (optlower.includes(r.pattern.toLowerCase())) return r;
    }
  }
  return null;
}

function extractBottles(text: string): number {
  if (!text) return 1;
  // 1순위: 명시적 단위 (3병, 5개, 1세트, 2팩)
  const m = text.match(/(\d+)\s*(?:병|개|입|set|세트|팩)/i);
  if (m) return parseInt(m[1], 10);
  // 2순위: "1+1", "2+1" 같은 숫자 더하기 패턴
  const plus = text.match(/(\d+)\s*\+\s*(\d+)/);
  if (plus) return parseInt(plus[1], 10) + parseInt(plus[2], 10);
  // 3순위: "종아리형+무릎형" 같은 + 로 묶인 조합 (개수만큼)
  // 단, 옵션명 일부만 추출하기 위해 첫 "/" 앞까지만 검사
  const firstPart = text.split("/")[0];
  const compounds = firstPart.split(/\s*\+\s*/).filter((s) => s.trim().length > 0);
  if (compounds.length >= 2) return compounds.length;
  return 1;
}

function isCanceled(status: string): boolean {
  return /취소|반품|환불|cancel|refund|return/i.test(status);
}

// ─────────────────── 텔레그램
const won = (n: number) => n.toLocaleString("ko-KR") + "원";

async function sendTelegram(text: string, maxAttempts = 3): Promise<void> {
  if (!TG_TOKEN || !TG_CHAT) {
    console.error("TELEGRAM 환경변수 누락");
    return;
  }
  // 네트워크 일시 장애(fetch failed) 회피용 retry — 1.5s, 3s, 4.5s 백오프
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) throw err;
      const msg = err instanceof Error ? err.message.slice(0, 100) : String(err);
      console.warn(`[telegram] 재시도 ${attempt}/${maxAttempts}: ${msg}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

// ─────────────────── 카카오톡 나에게 보내기 (memo/default/send)
// refresh_token 으로 access_token 을 매 실행마다 갱신. 새 refresh_token 이 내려오면
// (카카오는 만료 1개월 전부터 함께 갱신) simple/.kakao_refresh 에 저장해 영구 자동화.
const KAKAO_REST_KEY = process.env.KAKAO_REST_API_KEY;
const KAKAO_SECRET = process.env.KAKAO_CLIENT_SECRET;
const KAKAO_ENV_REFRESH = process.env.KAKAO_REFRESH_TOKEN;
const KAKAO_TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), ".kakao_refresh");

function getKakaoRefreshToken(): string | undefined {
  try {
    if (existsSync(KAKAO_TOKEN_FILE)) {
      const t = readFileSync(KAKAO_TOKEN_FILE, "utf8").trim();
      if (t) return t;
    }
  } catch { /* 파일 읽기 실패 시 .env 폴백 */ }
  return KAKAO_ENV_REFRESH;
}

async function getKakaoAccessToken(): Promise<string | null> {
  if (!KAKAO_REST_KEY) return null;
  const refresh = getKakaoRefreshToken();
  if (!refresh) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: KAKAO_REST_KEY,
    refresh_token: refresh,
  });
  if (KAKAO_SECRET) body.set("client_secret", KAKAO_SECRET);
  try {
    const res = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body,
    });
    if (!res.ok) {
      console.error(`[카카오] 토큰 갱신 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { access_token: string; refresh_token?: string };
    if (data.refresh_token) {
      try {
        writeFileSync(KAKAO_TOKEN_FILE, data.refresh_token, "utf8");
        console.log("[카카오] refresh_token 자동 갱신·저장됨");
      } catch (e) {
        console.warn("[카카오] refresh_token 저장 실패:", e instanceof Error ? e.message : e);
      }
    }
    return data.access_token;
  } catch (err) {
    console.error("[카카오] 토큰 갱신 네트워크 오류:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function sendKakao(text: string, accessToken: string, maxAttempts = 3): Promise<void> {
  const body = new URLSearchParams();
  body.set("template_object", JSON.stringify({
    object_type: "text",
    text,
    link: { web_url: "https://developers.kakao.com", mobile_web_url: "https://developers.kakao.com" },
  }));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        },
        body,
      });
      if (!res.ok) throw new Error(`kakao ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

// ─────────────────── 메인
const RAW_HEADERS = [
  "결제일", "스토어", "주문번호", "상품주문번호", "상품번호",
  "상품명", "옵션", "키워드", "수량", "출고수량",
  "매출", "수수료", "정산예정", "상태", "구매자",
  "원가", "물류비", "이익",
];
const SUMMARY_HEADERS = ["보고일", "키워드", "출고수량", "수량", "건수", "매출", "수수료"];

interface Row {
  paymentDate: string;
  store: string;
  orderId: string;
  productOrderId: string;
  channelProductNo: string;
  optionManageCode: string;
  productName: string;
  optionName: string;
  keyword: string;
  type: "메인" | "추가" | ""; // ⭐옵션매핑 G열 태그
  quantity: number;
  bottles: number;
  salesAmount: number;
  commission: number;
  settlement: number;
  status: string;
  buyer: string;
  cost: number;
  logistics: number;
  profit: number;
  isCanceled: boolean;
}

interface ProcessOptions {
  sendTelegram: boolean;
}

let orderDebugLogged = false;

/** 상품목록 시트의 옵션관리번호 → 옵션명 매핑 (자동 합산 시 부위 매칭용) */
async function loadCatalogOptionNames(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!SHEET_CREDS) return map;
  try {
    const rows = await readRange(SHEET_CREDS, "상품목록!A2:L100000");
    for (const r of rows) {
      const optCode = String(r[3] ?? "").trim(); // D = 옵션관리번호
      const optName = String(r[5] ?? "").trim(); // F = 옵션명
      if (optCode && optName) map.set(optCode, optName);
    }
    if (map.size > 0) console.log(`상품목록 옵션명 ${map.size}건 로드`);
  } catch (e) {
    console.warn(`상품목록 옵션명 로드 실패 (자동 합산 안 됨): ${e instanceof Error ? e.message : e}`);
  }
  return map;
}

// ─────────────────── 카카오 메시지 빌더
// 형식: 상품번호별 [대표품종] → 품종별(건수/병수/금액), 마지막에 총합.
// 카카오 메모는 한 통 길이 제한이 있어 상품 섹션을 여러 통으로 청크 분할.
const KAKAO_MSG_LIMIT = 1000;

function buildKakaoMessages(dateStr: string, live: Row[]): string[] {
  const kwOf = (r: Row) => r.keyword || `(미분류)${r.productName.slice(0, 10)}`;

  interface KwAgg { keyword: string; orders: Set<string>; bottles: number; sales: number; profit: number }
  const aggByKeyword = (rows: Row[]): KwAgg[] => {
    const m = new Map<string, KwAgg>();
    for (const r of rows) {
      const k = kwOf(r);
      const a = m.get(k) ?? { keyword: k, orders: new Set<string>(), bottles: 0, sales: 0, profit: 0 };
      a.orders.add(r.orderId);
      a.bottles += r.bottles;
      a.sales += r.salesAmount;
      a.profit += r.profit;
      m.set(k, a);
    }
    return [...m.values()].sort((a, b) => b.sales - a.sales);
  };
  const aggLine = (a: KwAgg) =>
    ` ${a.keyword} ${a.orders.size}건 ${a.bottles}병 매출 ${a.sales.toLocaleString("ko-KR")} 이익 ${a.profit.toLocaleString("ko-KR")}`;

  // 스토어(사업자)별 블록 — 키워드(품종)별 건수/병수/매출/이익 + 스토어 총합. 길면 분할.
  const storeBlock = (storeName: string, rows: Row[]): string[] => {
    const sSales = rows.reduce((s, r) => s + r.salesAmount, 0);
    const sProfit = rows.reduce((s, r) => s + r.profit, 0);
    const sOrders = new Set(rows.map((r) => r.orderId)).size;
    const sQty = rows.reduce((s, r) => s + r.bottles, 0);
    const header =
      `[${storeName}] ${dateStr}\n` +
      `총 ${sOrders}건 ${sQty}병 · 매출 ${sSales.toLocaleString("ko-KR")} · 이익 ${sProfit.toLocaleString("ko-KR")}`;
    const out: string[] = [];
    let buf = header;
    for (const a of aggByKeyword(rows)) {
      const line = aggLine(a);
      if ((buf + "\n" + line).length > KAKAO_MSG_LIMIT) {
        out.push(buf);
        buf = `[${storeName}] (계속)\n` + line;
      } else {
        buf += "\n" + line;
      }
    }
    out.push(buf);
    return out;
  };

  const messages: string[] = [];
  // 1) 전체 총합
  const tSales = live.reduce((s, r) => s + r.salesAmount, 0);
  const tProfit = live.reduce((s, r) => s + r.profit, 0);
  const tOrders = new Set(live.map((r) => r.orderId)).size;
  const tQty = live.reduce((s, r) => s + r.bottles, 0);
  messages.push(
    `[전체 총합] ${dateStr}\n` +
      `매출 ${tSales.toLocaleString("ko-KR")} · 이익 ${tProfit.toLocaleString("ko-KR")}\n` +
      `${tOrders}건 · ${tQty}병`,
  );

  // 2) 사업자별 (STORES 정의 순서 우선, 그 외는 뒤에)
  const byStore = new Map<string, Row[]>();
  for (const r of live) {
    const l = byStore.get(r.store) ?? [];
    l.push(r);
    byStore.set(r.store, l);
  }
  const storeOrder = [
    ...STORES.map((s) => s.name).filter((n) => byStore.has(n)),
    ...[...byStore.keys()].filter((n) => !STORES.some((s) => s.name === n)),
  ];
  for (const sn of storeOrder) {
    messages.push(...storeBlock(sn, byStore.get(sn)!));
  }
  return messages;
}

async function processDay(
  range: { fromIso: string; toIso: string; dateStr: string },
  rules: Rule[],
  productRules: Map<string, OptionMapRule>,
  yeogiMap: Map<string, number>,
  recentCostByOption: Map<string, number>,
  options: ProcessOptions,
  catalogOptNames?: Map<string, string>,
): Promise<void> {
  console.log(`\n[${range.dateStr}] ${options.sendTelegram ? '메인 보고' : '시트 동기화 only'}`);
  const allRows: Row[] = [];
  const errors: string[] = [];
  const vitaLogiSeen = new Set<string>(); // 비타앤오리진 자동 물류비: 주문당 1회만 부과

  for (let si = 0; si < STORES.length; si++) {
    if (si > 0) await sleep(3000);
    const store = STORES[si];
    try {
      console.log(`[${store.name}] 시작…`);
      const orders = await fetchOrdersForDay(store, range.fromIso, range.toIso);
      for (const o of orders) {
        const po = o.productOrder;
        const channelProductNo = po.channelProductNo ?? po.productId ?? "";
        // 진단7: 첫 주문의 raw 출력 (옵션관리번호 필드명 확인용) - 1회만
        if (!orderDebugLogged) {
          orderDebugLogged = true;
          console.log(`[진단7] 주문 raw (옵션관리번호 필드 파악용):`);
          console.log(JSON.stringify(po, null, 2).slice(0, 2000));
        }
        // 옵션관리번호 후보 — 네이버 응답에 있을 수 있는 여러 필드 시도
        const optionManageCode = String(
          po.optionManageCode ??
            po.sellerProductManagementCode ??
            po.optionCode ??
            po.sellerManagementCode ??
            po.productOptionId ??
            ""
        ).trim();

        // 매칭 우선순위:
        //  1) `${channelProductNo}|${optionManageCode}` — 옵션 단위 정밀 매칭
        //  2) `${channelProductNo}` — 상품 전체 매핑 (옵션관리번호 없거나 미입력 시)
        //  3) 코드 옵션매핑 패턴 (fallback)
        const optKey = optionManageCode ? `${channelProductNo}|${optionManageCode}` : "";
        const productRule = (optKey && productRules.get(optKey)) || productRules.get(channelProductNo);

        // 자동 합산 — 옵션관리번호 매칭 실패 또는 원가 비어있을 때, 같은 채널상품번호의 단품 행 참조
        // 옵션명 매칭 우선순위: ⭐옵션매핑 D열 라벨 → 상품목록 시트 (fallback)
        let computedCost = -1;
        let computedLogistics = -1;
        let aggDebug = "";
        if ((!productRule || productRule.costPerUnit === 0) && channelProductNo) {
          // 콜론 키 제거 — "사이즈: S" → "S", "압박스타킹: 종아리형" → "종아리형"
          // 네이버 주문 옵션은 "키: 값 / 키: 값" 형식, ⭐옵션매핑 label 은 "값 / 값" 형식이라 정규화 필요
          const stripKey = (s: string): string => {
            const c = s.indexOf(":");
            return c >= 0 ? s.slice(c + 1).trim() : s.trim();
          };
          const orderOpt = po.productOption ?? "";
          const orderParts = orderOpt.split("/").map((s) => s.trim());
          const orderFirstPart = stripKey(orderParts[0] ?? "");
          const orderSize = orderParts.length > 1 ? stripKey(orderParts[orderParts.length - 1]) : "";
          // 1+1, 2+1 같은 단품 multiplier 인식
          const plusMatch = orderFirstPart.match(/(\d+)\s*\+\s*(\d+)/);
          const multiplier = plusMatch ? parseInt(plusMatch[1], 10) + parseInt(plusMatch[2], 10) : 1;
          // 같은 채널상품번호의 단품 행들 (원가 있는 행만)
          const sameChannel = [...productRules.values()].filter(
            (r) => r.channelProductNo === channelProductNo && r.optionManageCode && r.costPerUnit > 0
          );
          let totalCost = 0;
          let firstLogistics = 0;
          let matchedCount = 0;
          const matchedLabels: string[] = [];
          for (const rule of sameChannel) {
            // ⭐옵션매핑의 D열 라벨 우선, 없으면 상품목록 시트 lookup
            const catName = rule.label || catalogOptNames?.get(rule.optionManageCode) || "";
            if (!catName) continue;
            const catParts = catName.split("/").map((s) => s.trim());
            const catFirstPart = stripKey(catParts[0] ?? "");
            const catSize = catParts.length > 1 ? stripKey(catParts[catParts.length - 1]) : "";
            // 사이즈 같고 + 부위명이 주문 옵션명에 포함되면 매칭
            if (catSize === orderSize && catFirstPart && orderFirstPart.includes(catFirstPart)) {
              totalCost += rule.costPerUnit;
              if (firstLogistics === 0) firstLogistics = rule.logisticsPerOrder;
              matchedCount++;
              matchedLabels.push(catName);
            }
          }
          if (matchedCount > 0) {
            // 1개 부위만 매칭 + 1+1 패턴 = 단품 × multiplier (예: 종아리 1+1 = 8040 × 2)
            // 여러 부위 매칭 = 합산 그대로 (예: 종아리+무릎 = 8040 + 9710, ×2 X)
            if (matchedCount === 1 && multiplier > 1) totalCost *= multiplier;
            computedCost = totalCost;
            computedLogistics = firstLogistics;
            aggDebug = `[자동합산] ${po.productOrderId} "${orderOpt}" → ${matchedLabels.join("+")} × ${multiplier > 1 && matchedCount === 1 ? multiplier : 1} = ${totalCost}원`;
          } else if (sameChannel.length > 0) {
            // 자동 합산 후보는 있는데 매칭 실패 — 진단용
            aggDebug = `[자동합산 실패] ${po.productOrderId} chNo=${channelProductNo} orderOpt="${orderOpt}" 후보=${sameChannel.length}개 [${sameChannel.slice(0, 3).map((r) => r.label || r.optionManageCode).join(", ")}…]`;
          }
        }
        if (aggDebug) console.log(aggDebug);

        const matched = productRule
          ? null
          : classify(po.productName, po.productOption ?? "", rules);
        const keyword = productRule?.label ?? matched?.keyword ?? "";
        let costPerUnit = productRule?.costPerUnit ?? matched?.costPerUnit ?? 0;
        let logisticsPerOrder = productRule?.logisticsPerOrder ?? matched?.logisticsPerOrder ?? 0;
        // 비타앤오리진: 명시 원가/물류가 없을 때 품종 기본값 적용 (물류비는 주문당 1회)
        if (store.name === VITA_STORE) {
          if (costPerUnit === 0 && keyword) costPerUnit = VITA_COST_BY_KEYWORD[keyword] ?? 0;
          if (logisticsPerOrder === 0) {
            const oid = o.order?.orderId ?? po.orderId ?? "";
            if (oid && !vitaLogiSeen.has(oid)) {
              logisticsPerOrder = VITA_DEFAULT_LOGISTICS;
              vitaLogiSeen.add(oid);
            }
          }
        }
        const perUnitBottles = extractBottles(po.productOption ?? po.productName);
        const totalUnits = po.quantity * perUnitBottles;
        const apiCommission =
          (po.knowledgeShoppingSellingInterlockCommission ?? 0) + (po.payCommissionAmount ?? 0);
        const settlement =
          po.expectedSettlementAmount
          ?? po.settlementAmount
          ?? po.settleAmount
          ?? (po.totalPaymentAmount - apiCommission);
        // 수수료 = 매출 - 정산예정 (네이버 총 차감 — 명시 수수료 외 적립차감/채널 수수료 등 모두 포함)
        const commission = Math.max(0, po.totalPaymentAmount - settlement);
        // 비용 계산 우선순위:
        //   1) 여기명품 사입관리 시트 매칭 → AB(총비용) 그대로
        //   2) 자동 합산 (computedCost) → 단품 부위별 합산
        //   3) ⭐옵션매핑 단가 × 수량
        const yeogiWholesale = store.name === YEOGI_STORE ? yeogiMap.get(po.productOrderId) : undefined;
        const yeogiConfirmed = yeogiWholesale != null && yeogiWholesale > 0;
        // 여기명품 사입 미입력분: 같은 옵션의 최근 원가단가 × 수량으로 임시 추정
        let yeogiEstimate: number | undefined;
        if (store.name === YEOGI_STORE && !yeogiConfirmed) {
          const unit = recentCostByOption.get(`${channelProductNo}|${po.productOption ?? ""}`);
          if (unit && unit > 0) yeogiEstimate = unit * po.quantity;
        }
        const cost = yeogiConfirmed
          ? yeogiWholesale!
          : yeogiEstimate != null
            ? yeogiEstimate
            : computedCost >= 0
              ? computedCost * po.quantity // 자동 합산: 완성 원가 × 주문 수량 (extractBottles X)
              : costPerUnit * totalUnits;
        // 여기명품은 사입가(또는 추정가)에 물류비 포함이므로 별도 물류비 0
        const logistics = yeogiConfirmed || yeogiEstimate != null
          ? 0
          : computedLogistics >= 0
            ? computedLogistics
            : logisticsPerOrder;
        const profit = settlement - cost - logistics;
        allRows.push({
          paymentDate: po.paymentDate ?? o.order?.paymentDate ?? "",
          store: store.name,
          orderId: o.order?.orderId ?? po.orderId ?? "",
          productOrderId: po.productOrderId,
          channelProductNo,
          optionManageCode,
          productName: po.productName,
          optionName: po.productOption ?? "",
          keyword,
          type: productRule?.type ?? "",
          quantity: po.quantity,
          bottles: totalUnits,
          salesAmount: po.totalPaymentAmount,
          commission,
          settlement,
          status: po.productOrderStatus ?? "",
          buyer: o.order?.ordererName ?? "",
          cost,
          logistics,
          profit,
          isCanceled: isCanceled(po.productOrderStatus ?? ""),
        });
      }
      console.log(`[${store.name}] ${orders.length}건 정규화`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${store.name}] 실패: ${msg}`);
      errors.push(`${store.name}: ${msg}`);
    }
  }

  // 시트 입력 (있으면)
  if (SHEET_CREDS && allRows.length > 0) {
    try {
      await ensureTab(SHEET_CREDS, "주문원본", RAW_HEADERS);
      // 상태(N열, index 13) 가 취소/반품/환불 이면 행 빨간 글씨
      try {
        await applyCancelRedRule(SHEET_CREDS, "주문원본", 13, RAW_HEADERS.length);
      } catch (err) {
        console.warn("조건부서식 적용 실패:", err instanceof Error ? err.message : String(err));
      }
      const rawRows: (string | number)[][] = allRows.map((r) => [
        r.paymentDate, r.store, r.orderId, r.productOrderId, r.channelProductNo,
        r.productName, r.optionName, r.keyword, r.quantity, r.bottles,
        r.salesAmount, r.commission, r.isCanceled ? "" : r.settlement, r.status, r.buyer,
        r.isCanceled ? "" : r.cost,
        r.isCanceled ? "" : r.logistics,
        r.isCanceled ? "" : r.profit,
      ]);
      // 상품주문번호(D열, idx 3) 기준 upsert. 이미 있으면 갱신, 중복 자동 정리.
      const result = await upsertRows(
        SHEET_CREDS,
        "주문원본",
        rawRows,
        (r) => String(r[3] ?? ""),
      );
      console.log(
        `✅ 「주문원본」: 신규 ${result.appended} / 갱신 ${result.updated}` +
          (result.deduped > 0 ? ` / 중복정리 ${result.deduped}` : ""),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("시트 「주문원본」 쓰기 실패:", msg);
      errors.push(`sheet: ${msg}`);
    }
  } else if (!SHEET_CREDS) {
    console.log("(시트 미설정 — 시트 입력 스킵)");
  }

  // 집계
  const live = allRows.filter((r) => !r.isCanceled);
  const canceled = allRows.filter((r) => r.isCanceled);

  const byKeyword = new Map<
    string,
    { keyword: string; qty: number; bottles: number; sales: number; commission: number; orderIds: Set<string> }
  >();
  for (const r of live) {
    const k = r.keyword || `(미분류)${r.productName.slice(0, 20)}`;
    const cur = byKeyword.get(k) ?? { keyword: k, qty: 0, bottles: 0, sales: 0, commission: 0, orderIds: new Set() };
    cur.qty += r.quantity;
    cur.bottles += r.bottles;
    cur.sales += r.salesAmount;
    cur.commission += r.commission;
    cur.orderIds.add(r.orderId);
    byKeyword.set(k, cur);
  }
  const summary = Array.from(byKeyword.values()).sort((a, b) => b.sales - a.sales);

  // 취소건도 키워드별 집계 (별도)
  const byKeywordCanceled = new Map<
    string,
    { keyword: string; qty: number; bottles: number; sales: number; orderIds: Set<string> }
  >();
  for (const r of canceled) {
    const k = r.keyword || `(미분류)${r.productName.slice(0, 20)}`;
    const cur = byKeywordCanceled.get(k) ?? { keyword: k, qty: 0, bottles: 0, sales: 0, orderIds: new Set() };
    cur.qty += r.quantity;
    cur.bottles += r.bottles;
    cur.sales += r.salesAmount;
    cur.orderIds.add(r.orderId);
    byKeywordCanceled.set(k, cur);
  }
  const summaryCanceled = Array.from(byKeywordCanceled.values()).sort((a, b) => b.sales - a.sales);

  // 집계 시트도 입력 — (보고일+키워드) 기준 upsert
  if (SHEET_CREDS && summary.length > 0) {
    try {
      await ensureTab(SHEET_CREDS, "일일집계", SUMMARY_HEADERS);
      const sumRows = summary.map((r) => [
        range.dateStr, r.keyword, r.bottles, r.qty, r.orderIds.size, r.sales, r.commission,
      ]);
      const sumResult = await upsertRows(
        SHEET_CREDS,
        "일일집계",
        sumRows,
        (r) => `${r[0]}|${r[1]}`,
      );
      console.log(
        `✅ 「일일집계」: 신규 ${sumResult.appended} / 갱신 ${sumResult.updated}` +
          (sumResult.deduped > 0 ? ` / 중복정리 ${sumResult.deduped}` : ""),
      );
    } catch (err) {
      console.error("시트 「일일집계」 쓰기 실패:", err instanceof Error ? err.message : String(err));
    }
  }

  // 텔레그램 — 전체 요약 + 사업자별 상세 (말풍선 분리)
  const liveSales = live.reduce((s, r) => s + r.salesAmount, 0);
  const canceledSales = canceled.reduce((s, r) => s + r.salesAmount, 0);
  const grossSales = liveSales + canceledSales;
  const liveSettlement = live.reduce((s, r) => s + r.settlement, 0);
  const totalCost = live.reduce((s, r) => s + r.cost, 0);
  const totalLogistics = live.reduce((s, r) => s + r.logistics, 0);
  const totalProfit = live.reduce((s, r) => s + r.profit, 0);

  // 스토어별 그룹화
  const byStore = new Map<string, { live: Row[]; canceled: Row[] }>();
  for (const r of allRows) {
    const cur = byStore.get(r.store) ?? { live: [], canceled: [] };
    if (r.isCanceled) cur.canceled.push(r);
    else cur.live.push(r);
    byStore.set(r.store, cur);
  }

  // 옵션 단위 sub-agg
  interface OptionAgg {
    optionName: string;
    optionManageCode: string;
    bottles: number;
    sales: number;
    cost: number;
    profit: number;
    orderIds: Set<string>;
  }
  interface ProductAgg {
    productKey: string;
    label: string;
    productName: string;
    bottles: number;
    sales: number;
    cost: number;
    logistics: number;
    profit: number;
    orderIds: Set<string>;
    options: Map<string, OptionAgg>;
  }
  interface MainGroup {
    main: ProductAgg;
    additional: Map<string, ProductAgg>;
  }
  const makeAgg = (r: Row): ProductAgg => ({
    productKey: r.channelProductNo || r.productName,
    label: r.keyword || `(미분류)${r.productName.slice(0, 15)}`,
    productName: r.productName,
    bottles: 0, sales: 0, cost: 0, logistics: 0, profit: 0,
    orderIds: new Set<string>(),
    options: new Map<string, OptionAgg>(),
  });
  const accumulateOption = (agg: ProductAgg, r: Row) => {
    const optKey = r.optionManageCode || r.optionName || "(no-option)";
    let o = agg.options.get(optKey);
    if (!o) {
      o = {
        optionName: r.optionName || "(옵션 없음)",
        optionManageCode: r.optionManageCode,
        bottles: 0, sales: 0, cost: 0, profit: 0,
        orderIds: new Set<string>(),
      };
      agg.options.set(optKey, o);
    }
    o.bottles += r.bottles;
    o.sales += r.salesAmount;
    o.cost += r.cost;
    o.profit += r.profit;
    o.orderIds.add(r.orderId);
  };
  const accumulateAgg = (agg: ProductAgg, r: Row) => {
    agg.bottles += r.bottles;
    agg.sales += r.salesAmount;
    agg.cost += r.cost;
    agg.logistics += r.logistics;
    agg.profit += r.profit;
    agg.orderIds.add(r.orderId);
    accumulateOption(agg, r);
  };
  const groupByMain = (rows: Row[]): Map<string, MainGroup> => {
    const byOrder = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byOrder.get(r.orderId) ?? [];
      list.push(r);
      byOrder.set(r.orderId, list);
    }
    const out = new Map<string, MainGroup>();
    for (const list of byOrder.values()) {
      const taggedMain = list.find((r) => r.type === "메인");
      let mainRow: Row;
      let adds: Row[];
      if (taggedMain) {
        mainRow = taggedMain;
        adds = list.filter((r) => r !== taggedMain);
      } else {
        const notTaggedAsAdd = list.filter((r) => r.type !== "추가");
        const pool = notTaggedAsAdd.length > 0 ? notTaggedAsAdd : list;
        pool.sort((a, b) => b.salesAmount - a.salesAmount);
        mainRow = pool[0];
        adds = list.filter((r) => r !== mainRow);
      }
      const mainKey = mainRow.channelProductNo || mainRow.productName;
      let g = out.get(mainKey);
      if (!g) {
        g = { main: makeAgg(mainRow), additional: new Map() };
        out.set(mainKey, g);
      }
      accumulateAgg(g.main, mainRow);
      for (const ar of adds) {
        const aKey = ar.channelProductNo || ar.productName;
        const isAddon = ar.type === "추가" || ar.productName !== mainRow.productName;
        if (aKey === mainKey && !isAddon) {
          accumulateAgg(g.main, ar);
          continue;
        }
        let aAgg = g.additional.get(aKey);
        if (!aAgg) {
          aAgg = makeAgg(ar);
          g.additional.set(aKey, aAgg);
        }
        accumulateAgg(aAgg, ar);
      }
    }
    return out;
  };

  // ─── 메시지 1: 전체 요약 ───
  const summaryLines: string[] = [];
  summaryLines.push(`<b>📊 ${range.dateStr} 매출 요약</b>`);
  summaryLines.push("");
  summaryLines.push(`💰 총매출 ${won(grossSales)} (${allRows.length}건)`);
  if (canceled.length > 0) summaryLines.push(`❌ 취소 -${won(canceledSales)} (${canceled.length}건)`);
  summaryLines.push(`✅ <b>최종 ${won(liveSales)}</b> (${live.length}건) · 정산 ${won(liveSettlement)}`);
  summaryLines.push(`📦 원가 ${won(totalCost)} · 🚚 ${won(totalLogistics)} → 💎 <b>이익 ${won(totalProfit)}</b>`);
  summaryLines.push("");
  summaryLines.push(`<b>━ 사업자별 ━</b>`);
  for (const store of STORES) {
    const data = byStore.get(store.name);
    if (!data || (data.live.length === 0 && data.canceled.length === 0)) continue;
    const sLiveSales = data.live.reduce((s, r) => s + r.salesAmount, 0);
    const sProfit = data.live.reduce((s, r) => s + r.profit, 0);
    summaryLines.push(`• ${store.name}: ${won(sLiveSales)} (${data.live.length}건) · 이익 ${won(sProfit)}`);
  }
  if (errors.length > 0) {
    summaryLines.push("");
    summaryLines.push("⚠️ <b>오류:</b>");
    for (const e of errors) summaryLines.push(`• ${e.slice(0, 250)}`);
  }

  // ─── 메시지 2~N: 사업자별 상세 (상품 → 옵션 sub-line) ───
  const buildStoreMessage = (storeName: string, data: { live: Row[]; canceled: Row[] }): string => {
    const sLive = data.live;
    const sCancel = data.canceled;
    const sLiveSales = sLive.reduce((s, r) => s + r.salesAmount, 0);
    const sCancelSales = sCancel.reduce((s, r) => s + r.salesAmount, 0);
    const sShipments = new Set(sLive.map((r) => r.orderId)).size;
    const sBottles = sLive.reduce((s, r) => s + r.bottles, 0);
    const sCommission = sLive.reduce((s, r) => s + r.commission, 0);
    const sSettlement = sLive.reduce((s, r) => s + r.settlement, 0);
    const sCost = sLive.reduce((s, r) => s + r.cost, 0);
    const sLogistics = sLive.reduce((s, r) => s + r.logistics, 0);
    const sProfit = sLive.reduce((s, r) => s + r.profit, 0);

    const l: string[] = [];
    l.push(`<b>━━ ${storeName} (${range.dateStr}) ━━</b>`);
    l.push(`💰 매출 ${won(sLiveSales)} (${sLive.length}건) · 출고 ${sBottles}개 · 배송 ${sShipments}건`);
    if (sCancel.length > 0) l.push(`❌ 취소 -${won(sCancelSales)} (${sCancel.length}건)`);
    l.push(`💳 수수료 ${won(sCommission)} / 💵 정산 ${won(sSettlement)}`);
    l.push(`📦 원가 ${won(sCost)} · 🚚 ${won(sLogistics)} → 💎 <b>이익 ${won(sProfit)}</b>`);
    l.push("");

    const sMains = groupByMain(sLive);
    const sorted = Array.from(sMains.values()).sort((a, b) => b.main.sales - a.main.sales);
    for (const g of sorted) {
      l.push(`<b>• ${g.main.label}</b> <code>${g.main.productKey}</code>`);
      l.push(`   ${g.main.bottles}개·${g.main.orderIds.size}건 · ${won(g.main.sales)} · 원가 ${won(g.main.cost)} · <b>이익 ${won(g.main.profit)}</b>`);
      // 옵션이 2개 이상이면 옵션별 sub-line (옵션 1개면 본 라인과 중복이라 생략)
      if (g.main.options.size >= 2) {
        const opts = Array.from(g.main.options.values()).sort((a, b) => b.sales - a.sales);
        for (const o of opts) {
          l.push(`   ↳ ${o.optionName}: ${o.bottles}개·${o.orderIds.size}건 · ${won(o.sales)} · 이익 ${won(o.profit)}`);
        }
      }
      // 추가상품
      if (g.additional.size > 0) {
        const adds = Array.from(g.additional.values()).sort((a, b) => b.sales - a.sales);
        for (const a of adds) {
          l.push(`   ↳ 추가: <b>${a.label}</b> ${a.bottles}개·${a.orderIds.size}건 · ${won(a.sales)} · 원가 ${won(a.cost)} · 이익 ${won(a.profit)}`);
        }
      }
    }

    if (sCancel.length > 0) {
      l.push("");
      l.push(`<b>❌ 취소</b>`);
      const sMainsC = groupByMain(sCancel);
      const sortedC = Array.from(sMainsC.values()).sort((a, b) => b.main.sales - a.main.sales);
      for (const g of sortedC) {
        l.push(`• <s>${g.main.label} ${g.main.bottles}개·${g.main.orderIds.size}건 · -${won(g.main.sales)}</s>`);
      }
    }
    return l.join("\n");
  };

  if (options.sendTelegram) {
    console.log("\n=== 미리보기 (요약) ===\n" + summaryLines.join("\n").replace(/<[^>]+>/g, ""));
    if (allRows.length === 0) {
      summaryLines.push("");
      summaryLines.push("매출 없음.");
    }
    await sendTelegram(summaryLines.join("\n"));
    // 사업자별 분리 발송
    for (const store of STORES) {
      const data = byStore.get(store.name);
      if (!data || (data.live.length === 0 && data.canceled.length === 0)) continue;
      const msg = buildStoreMessage(store.name, data);
      console.log(`\n=== 미리보기 (${store.name}) ===\n` + msg.replace(/<[^>]+>/g, ""));
      await sendTelegram(msg);
    }

    // ─── 카카오톡 나에게 보내기 (텔레그램과 동시, 상품번호별 품종 집계 포맷) ───
    try {
      const kakaoToken = await getKakaoAccessToken();
      if (kakaoToken) {
        const kakaoMsgs = buildKakaoMessages(range.dateStr, live);
        console.log(`\n=== 카카오 미리보기 ===\n` + kakaoMsgs.join("\n---\n"));
        for (const km of kakaoMsgs) {
          await sendKakao(km, kakaoToken);
          await sleep(500);
        }
        console.log(`[카카오] ${kakaoMsgs.length}통 발송 완료`);
      } else {
        console.log("[카카오] 미설정(KAKAO_* 환경변수 없음) — 발송 skip");
      }
    } catch (err) {
      console.error("[카카오] 발송 실패:", err instanceof Error ? err.message : err);
    }
  }
  console.log(`[${range.dateStr}] ✅ 완료`);
}

function previousDaysKstRanges(daysBack: number): { fromIso: string; toIso: string; dateStr: string }[] {
  const now = new Date();
  const kst = new Date(now.getTime() + KST_OFFSET);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate();
  const out: { fromIso: string; toIso: string; dateStr: string }[] = [];
  for (let i = 1; i <= daysBack; i++) {
    const start = Date.UTC(y, m, d - i) - KST_OFFSET;
    const end = Date.UTC(y, m, d - i + 1) - KST_OFFSET;
    out.push({
      fromIso: new Date(start).toISOString(),
      toIso: new Date(end).toISOString(),
      dateStr: new Date(Date.UTC(y, m, d - i)).toISOString().slice(0, 10),
    });
  }
  return out;
}

async function main() {
  if (STORES.length === 0) throw new Error("NAVER_STORES_JSON 비어있음");
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];
  const rules = await loadRules();
  console.log(`키워드 룰 ${rules.length}개`);
  const productRules = await loadOptionMapping();
  const yeogiMap = await loadYeogiWholesaleMap();
  const recentCostByOption = await loadRecentCostByOption();
  const catalogOptNames = await loadCatalogOptionNames();

  // 범위 백필: `npx tsx run.ts 2026-04-01 2026-05-01` → 텔레그램 X, 시트만 갱신
  if (arg1 && arg2) {
    const m1 = arg1.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const m2 = arg2.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m1 || !m2) throw new Error("날짜 형식 오류 (YYYY-MM-DD 두 개)");
    const fromMs = Date.UTC(+m1[1], +m1[2] - 1, +m1[3]);
    const toMs = Date.UTC(+m2[1], +m2[2] - 1, +m2[3]);
    if (fromMs > toMs) throw new Error("시작일이 종료일보다 늦음");
    const dayMs = 24 * 60 * 60 * 1000;
    const days: string[] = [];
    for (let cur = fromMs; cur <= toMs; cur += dayMs) {
      days.push(new Date(cur).toISOString().slice(0, 10));
    }
    console.log(`범위 백필: ${days.length}일 (${arg1} ~ ${arg2}) — 텔레그램 발송 안 함`);
    for (let i = 0; i < days.length; i++) {
      console.log(`\n[${i + 1}/${days.length}] ${days[i]}`);
      try {
        await processDay(dateKstRange(days[i]), rules, productRules, yeogiMap, recentCostByOption, { sendTelegram: false }, catalogOptNames);
      } catch (err) {
        console.error(`[${days[i]}] 실패:`, err instanceof Error ? err.message : String(err));
      }
    }
    console.log(`\n✅ 범위 백필 완료: ${days.length}일`);
    return;
  }

  // 단일 날짜 백필: 텔레그램 발송
  if (arg1) {
    await processDay(dateKstRange(arg1), rules, productRules, yeogiMap, recentCostByOption, { sendTelegram: true }, catalogOptNames);
    return;
  }

  // 일상 cron: 7일 롤링
  const ranges = previousDaysKstRanges(7);
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const sendTg = (i === 0);
    try {
      await processDay(range, rules, productRules, yeogiMap, recentCostByOption, { sendTelegram: sendTg }, catalogOptNames);
    } catch (err) {
      console.error(`[${range.dateStr}] 실패:`, err instanceof Error ? err.message : String(err));
    }
  }
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("FATAL:", msg);
  try {
    await sendTelegram(`❌ 매출 보고 실패\n<code>${msg}</code>`);
  } catch {}
  process.exit(1);
});
