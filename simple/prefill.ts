/**
 * 「⭐옵션매핑」 카탈로그 자동 프리필.
 *
 * 목적: 사장님이 원가를 넣을 "줄"을 시스템이 미리 다 만들어 둔다.
 *       스토어에 등록된 상품·옵션을 네이버 커머스 API 로 훑어서, 시트에 없는 줄만 추가.
 *       사장님은 빈 「원가(개당)」 칸만 채우면 된다.
 *
 * 실행: npx tsx prefill.ts            (전 스토어)
 *       DRY_RUN=1 npx tsx prefill.ts  (시트 안 건드리고 무엇이 추가될지만 출력)
 *
 * ⚠️ run.ts(08:00 매출 보고)에 인라인하지 않는다.
 *    상품마다 상세 조회를 돌아 무겁고, 과거 이 경로에서 OOM 이력이 있음(HANDOVER 참조).
 *    매출 보고와 분리해 따로 돌리고, 여기서 실패해도 매출 보고는 멀쩡하도록 격리한다.
 *
 * 상품/옵션 조회 엔드포인트는 catalog.ts 에서 이미 검증된 것을 그대로 쓴다:
 *   POST /v1/products/search                          (페이지네이션, size 50)
 *   GET  /v2/products/origin-products/{originProductNo} (optionCombinations / supplementProducts)
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { loadCredsFromEnv, readRange } from "./sheets";
import { mergeOptionMapEntries, OPTMAP_TAB, type OptMapEntry } from "./optmap";

const NAVER_BASE = "https://api.commerce.naver.com/external";
const DRY_RUN = process.env.DRY_RUN === "1";
/**
 * 기본값은 "한 번이라도 팔린 상품"만 — 「주문원본」에 등장한 채널상품번호로 거른다.
 * 등록만 해두고 안 팔리는 상품(여기명품은 666개 중 대부분)까지 넣으면 시트가 수천 줄로
 * 불어나 정작 채워야 할 줄이 묻힌다. 전체 카탈로그를 넣고 싶으면 ALL=1.
 */
const ALL = process.env.ALL === "1";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface StoreConfig {
  name: string;
  clientId: string;
  clientSecret: string;
}

const STORES: StoreConfig[] = JSON.parse(process.env.NAVER_STORES_JSON ?? "[]");
const SHEET_CREDS = loadCredsFromEnv();

async function getToken(clientId: string, clientSecret: string): Promise<string> {
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
  return ((await res.json()) as { access_token: string }).access_token;
}

interface ProductSearchItem {
  originProductNo?: number | string;
  channelProducts?: {
    channelProductNo?: number | string;
    name?: string;
  }[];
}

/** 스토어의 등록 상품 전체 (페이지네이션). */
async function searchProducts(token: string, storeName: string): Promise<ProductSearchItem[]> {
  const all: ProductSearchItem[] = [];
  const SIZE = 50;
  for (let page = 1; page <= 200; page++) {
    if (page > 1) await sleep(400);
    const res = await fetch(`${NAVER_BASE}/v1/products/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ page, size: SIZE, productStatusTypes: ["SALE", "OUTOFSTOCK", "SUSPENSION"] }),
    });
    if (!res.ok) throw new Error(`products/search ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { contents?: ProductSearchItem[]; totalElements?: number };
    const items = json.contents ?? [];
    all.push(...items);
    if (items.length < SIZE) break;
  }
  console.log(`[${storeName}] 등록 상품 ${all.length}개`);
  return all;
}

/** 상품 상세에서 옵션관리번호 + 옵션명 뽑기. 실패는 null (그 상품은 대표 줄만 만든다). */
async function fetchOptions(
  token: string,
  originProductNo: string,
): Promise<{ optionManageCode: string; label: string }[] | null> {
  try {
    const res = await fetch(`${NAVER_BASE}/v2/products/origin-products/${originProductNo}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const origin = json?.originProduct ?? json;
    const out: { optionManageCode: string; label: string }[] = [];

    const combos = origin?.detailAttribute?.optionInfo?.optionCombinations ?? [];
    for (const opt of combos) {
      const code = String(opt?.optionManageCode ?? opt?.id ?? "").trim();
      if (!code) continue;
      const label = [opt?.optionName1, opt?.optionName2, opt?.optionName3]
        .filter(Boolean)
        .join(" / ");
      out.push({ optionManageCode: code, label });
    }

    // 추가상품 (supplementProducts) — 별도 원가가 붙는 경우가 많아 줄을 따로 만들어 준다
    const supplements = origin?.detailAttribute?.supplementProductInfo?.supplementProducts ?? [];
    for (const add of supplements) {
      const code = String(add?.sellerManagementCode ?? add?.optionManageCode ?? add?.id ?? "").trim();
      if (!code) continue;
      const label = [add?.groupName, add?.name].filter(Boolean).join(" / ");
      out.push({ optionManageCode: code, label });
    }
    return out;
  } catch {
    return null;
  }
}

async function main() {
  if (!SHEET_CREDS) throw new Error("시트 자격증명 없음 (GOOGLE_* 환경변수 확인)");
  if (STORES.length === 0) {
    console.log("등록된 스토어 없음 — 할 일 없음. (NAVER_STORES_JSON)");
    return;
  }
  console.log(`프리필 시작 — 스토어 ${STORES.length}개${DRY_RUN ? " [DRY_RUN]" : ""}${ALL ? " [전체 카탈로그]" : " [판매이력 있는 상품만]"}`);

  // 판매이력 있는 채널상품번호 (기본 필터)
  let soldChannels: Set<string> | null = null;
  if (!ALL) {
    const raw = await readRange(SHEET_CREDS, "주문원본!E2:E100000");
    soldChannels = new Set(raw.map((r) => String(r[0] ?? "").trim()).filter(Boolean));
    console.log(`판매이력 있는 상품 ${soldChannels.size}개 — 이 상품들만 프리필`);
  }

  const entries: OptMapEntry[] = [];
  const errors: string[] = [];

  for (const store of STORES) {
    try {
      const token = await getToken(store.clientId, store.clientSecret);
      const products = await searchProducts(token, store.name);
      let detailOk = 0;
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const originNo = String(p.originProductNo ?? "").trim();
        const ch = p.channelProducts?.[0];
        const chNo = String(ch?.channelProductNo ?? "").trim();
        const name = String(ch?.name ?? "").trim();
        if (!chNo) continue;
        if (soldChannels && !soldChannels.has(chNo)) continue; // 판매이력 없는 상품 skip

        // 대표 줄 — 사장님이 숫자 하나만 넣으면 그 상품 전체가 커버되는 자리
        entries.push({
          originProductNo: originNo,
          channelProductNo: chNo,
          optionManageCode: "",
          label: name.slice(0, 40),
        });

        if (originNo) {
          await sleep(120); // rate limit 여유
          const opts = await fetchOptions(token, originNo);
          if (opts) {
            detailOk += 1;
            for (const o of opts) {
              entries.push({
                originProductNo: originNo,
                channelProductNo: chNo,
                optionManageCode: o.optionManageCode,
                label: o.label || name.slice(0, 40),
              });
            }
          }
        }
        if ((i + 1) % 50 === 0) console.log(`  [${store.name}] ${i + 1}/${products.length} …`);
      }
      console.log(`[${store.name}] 상세 조회 성공 ${detailOk}/${products.length}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${store.name}] 실패: ${msg}`);
      errors.push(`${store.name}: ${msg}`);
    }
  }

  console.log(`\n수집한 후보 줄 ${entries.length}개`);
  if (DRY_RUN) {
    console.log(`[DRY_RUN] 시트 미기록. 상위 10개 미리보기:`);
    for (const e of entries.slice(0, 10)) console.log("   ", JSON.stringify(e));
    return;
  }
  if (entries.length === 0) {
    console.log("추가할 것 없음.");
    return;
  }

  const { addedRows, newProducts } = await mergeOptionMapEntries(SHEET_CREDS, entries);
  console.log(`✅ 「${OPTMAP_TAB}」 새 줄 ${addedRows}개 추가 (기존 입력값은 그대로)`);
  if (newProducts.length > 0) {
    console.log(`   신규 상품 ${newProducts.length}개: ${newProducts.slice(0, 5).map((p) => p.label).join(", ")}`);
  }
  if (errors.length > 0) console.log(`⚠️ 일부 스토어 실패: ${errors.join(" / ")}`);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
