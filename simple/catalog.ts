/**
 * 스토어 상품 카탈로그 자동 수집
 *
 * 사용법:
 *   npx tsx catalog.ts        # 3개 스토어 다 → 「상품목록」 시트
 *   npx tsx catalog.ts 비타앤오리진   # 특정 스토어만
 *
 * 결과 시트 「상품목록」:
 *   A 스토어
 *   B 원본상품번호 (originProductNo)
 *   C 채널상품번호 (channelProductNo)  ← 「상품매핑」 의 상품번호와 동일
 *   D 상품명
 *   E 카테고리
 *   F 가격
 *   G 상태 (SALE/OUTOFSTOCK/SUSPENSION/CLOSED 등)
 *   H 유형 추정 (메인/추가)
 *   I 수집일
 *
 * 「상품매핑」 으로 복붙 활용:
 *   1. 「상품목록」 에서 추적할 상품들 골라서 (C/D/H 칼럼)
 *   2. 「상품매핑」 시트에 「상품번호 + 라벨 + 원가 + 물류비 + 유형」 입력
 *   → 텔레그램 보고에서 라벨로 표시 + 메인/추가 자동 계층화
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { ensureTab, appendRows, clearTabData, loadCredsFromEnv, type SheetCreds } from "./sheets";

interface StoreConfig {
  name: string;
  clientId: string;
  clientSecret: string;
}
const STORES: StoreConfig[] = JSON.parse(process.env.NAVER_STORES_JSON ?? "[]");
const SHEET_CREDS: SheetCreds | null = loadCredsFromEnv();
const NAVER_BASE = "https://api.commerce.naver.com/external";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  const d = (await res.json()) as { access_token: string };
  return d.access_token;
}

interface ChannelProduct {
  channelProductNo?: string | number;
  channelServiceType?: string;
  statusType?: string;
  saleType?: string;
  name?: string;
  salePrice?: number;
  stockQuantity?: number;
  categoryId?: string;
  wholeCategoryName?: string;
  representativeProduct?: boolean;
}

interface ProductSearchItem {
  originProductNo?: string | number;
  statusType?: string;
  saleType?: string;
  name?: string;
  channelProducts?: ChannelProduct[];
}

interface OptionCombo {
  id?: string | number;
  optionManageCode?: string;
  optionName1?: string;
  optionName2?: string;
  optionName3?: string;
  // 구버전 호환
  option1?: string;
  option2?: string;
  option3?: string;
  sellerManagementCode?: string;
  price?: number;
  stockQuantity?: number;
  usable?: boolean;
}

interface AdditionalProduct {
  id?: string | number;
  optionManageCode?: string; // 구버전
  sellerManagementCode?: string; // 신버전 (supplementProducts)
  groupName?: string;
  name?: string;
  price?: number;
  stockQuantity?: number;
  usable?: boolean;
}

let detailDebugLogged = false; // 첫 detail 1개만 raw 응답 출력 (옵션명 매핑 진단용)

async function fetchOriginDetail(token: string, originProductNo: string): Promise<{
  options: OptionCombo[];
  additionals: AdditionalProduct[];
} | null> {
  try {
    const res = await fetch(`${NAVER_BASE}/v2/products/origin-products/${originProductNo}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    // 진단4: 사장님이 추가상품 쓰는 특정 상품의 raw 출력 (HTML 제외, 추가상품 위치 파악용)
    if (originProductNo === "12365897567") {
      const cleaned = JSON.parse(JSON.stringify(data));
      if (cleaned?.originProduct?.detailContent) cleaned.originProduct.detailContent = "[HTML 생략]";
      console.log(`\n[진단4] origin-product ${originProductNo} 전체 detail (HTML 제외):`);
      console.log(`  최상위 keys: ${Object.keys(data).join(", ")}`);
      console.log(JSON.stringify(cleaned, null, 2).slice(0, 12000));
      console.log(`[진단4] 끝\n`);
    }

    // 진단2: 옵션 데이터가 *실제로 채워진* 첫 detail 만 raw 출력 (빈 옵션 상품은 skip)
    if (!detailDebugLogged) {
      const op = (data.originProduct ?? data) as Record<string, unknown>;
      const detailAttr = op?.detailAttribute as Record<string, unknown> | undefined;
      const optionInfo =
        (detailAttr?.optionInfo as Record<string, unknown> | undefined)
        ?? (op?.optionInfo as Record<string, unknown> | undefined);
      if (optionInfo) {
        // 옵션이 실제로 채워진 상품만 — 모든 배열 필드 중 하나라도 length > 0
        const hasContent = Object.values(optionInfo).some(
          (v) => Array.isArray(v) && v.length > 0,
        );
        if (hasContent) {
          detailDebugLogged = true;
          console.log(`\n[진단2] origin-product ${originProductNo} (옵션 채워진 상품):`);
          console.log(`  detailAttribute keys: ${detailAttr ? Object.keys(detailAttr).join(", ") : "N/A"}`);
          console.log(`  optionInfo keys: ${Object.keys(optionInfo).join(", ")}`);
          // 각 배열 필드의 길이 요약
          const lengthSummary = Object.entries(optionInfo)
            .filter(([, v]) => Array.isArray(v))
            .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
            .join(", ");
          console.log(`  배열 필드 길이: ${lengthSummary}`);
          console.log(`  optionInfo raw (8000자):`);
          console.log(JSON.stringify(optionInfo, null, 2).slice(0, 8000));
          console.log(`[진단2] 끝\n`);
        }
      }
    }
    // 가능한 경로들 시도 (네이버 API 응답 구조가 가끔 변함)
    const origin = (data.originProduct ?? data) as Record<string, unknown> | undefined;
    const detailAttr = origin?.detailAttribute as Record<string, unknown> | undefined;
    const optionInfo =
      (detailAttr?.optionInfo as Record<string, unknown> | undefined)
      ?? (origin?.optionInfo as Record<string, unknown> | undefined);
    const options = (optionInfo?.optionCombinations as OptionCombo[] | undefined) ?? [];

    // 추가상품 — detailAttribute.supplementProductInfo.supplementProducts (확인됨)
    const supplementInfo = detailAttr?.supplementProductInfo as Record<string, unknown> | undefined;
    const additionals =
      (supplementInfo?.supplementProducts as AdditionalProduct[] | undefined)
      ?? (optionInfo?.additionalProducts as AdditionalProduct[] | undefined) // 구버전 호환
      ?? (optionInfo?.addProducts as AdditionalProduct[] | undefined)
      ?? [];
    return { options, additionals };
  } catch {
    return null;
  }
}

async function searchProducts(token: string, storeName: string): Promise<ProductSearchItem[]> {
  const all: ProductSearchItem[] = [];
  let page = 1;
  const SIZE = 50;
  while (true) {
    const res = await fetch(`${NAVER_BASE}/v1/products/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        searchKeywordType: "ALL",
        page,
        size: SIZE,
        orderType: "NO",
      }),
    });
    if (!res.ok) {
      console.warn(`  [${storeName}] page ${page} 실패: ${res.status} — ${(await res.text()).slice(0, 200)}`);
      break;
    }
    const data = (await res.json()) as { contents?: ProductSearchItem[]; totalPages?: number; totalElements?: number };
    const items = data.contents ?? [];
    if (page === 1) console.log(`  [${storeName}] 총 ${data.totalElements ?? "?"}개`);
    all.push(...items);
    if (items.length < SIZE) break;
    if (data.totalPages && page >= data.totalPages) break;
    page++;
    await sleep(700);
  }
  return all;
}

/** statusType / saleType 으로 메인/추가 추정 */
function inferType(channel: ChannelProduct, parent: ProductSearchItem): string {
  const t = (channel.saleType ?? parent.saleType ?? "").toUpperCase();
  if (t.includes("ADD") || t.includes("EXTRA") || t.includes("OPTION")) return "추가";
  if (channel.representativeProduct === false) return "추가";
  return "메인";
}

async function dumpCatalog(creds: SheetCreds, filterStore?: string): Promise<void> {
  await ensureTab(creds, "상품목록", [
    "스토어",
    "원본상품번호",
    "채널상품번호",
    "옵션관리번호",
    "상품명",
    "옵션명",
    "카테고리",
    "가격",
    "상태",
    "유형 (메인/옵션/추가)",
    "수집일",
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const rows: (string | number)[][] = [];

  for (const store of STORES) {
    if (filterStore && store.name !== filterStore) continue;
    console.log(`\n━━━ ${store.name} ━━━`);
    try {
      const token = await getToken(store.clientId, store.clientSecret);
      const products = await searchProducts(token, store.name);
      let count = 0;
      let detailFetched = 0;
      for (const p of products) {
        const channels = p.channelProducts ?? [];
        const originNo = String(p.originProductNo ?? "");

        // 옵션 + 추가상품 detail 가져오기 (메인 상품만 있으면 충분, 채널 사이는 중복)
        const detail = originNo ? await fetchOriginDetail(token, originNo) : null;
        if (detail) detailFetched++;
        await sleep(500); // detail API 호출 사이 딜레이

        // 채널 행 추가
        if (channels.length === 0) {
          rows.push([
            store.name,
            originNo,
            "",
            "", // 옵션관리번호
            p.name ?? "",
            "",
            "",
            0,
            p.statusType ?? "",
            "메인",
            today,
          ]);
          count++;
        }
        for (const ch of channels) {
          const chNo = String(ch.channelProductNo ?? "");
          // 메인 행
          rows.push([
            store.name,
            originNo,
            chNo,
            "", // 옵션관리번호 (메인이라서 빈 칸)
            ch.name ?? p.name ?? "",
            "",
            ch.wholeCategoryName ?? "",
            ch.salePrice ?? 0,
            ch.statusType ?? p.statusType ?? "",
            inferType(ch, p),
            today,
          ]);
          count++;

          // 옵션 행 (같은 채널상품번호 아래, 옵션관리번호로 구별)
          for (const opt of detail?.options ?? []) {
            const optName = [
              opt.optionName1 ?? opt.option1,
              opt.optionName2 ?? opt.option2,
              opt.optionName3 ?? opt.option3,
            ].filter(Boolean).join(" / ");
            rows.push([
              store.name,
              originNo,
              chNo,
              String(opt.optionManageCode ?? opt.id ?? ""),
              ch.name ?? p.name ?? "",
              optName,
              ch.wholeCategoryName ?? "",
              opt.price ?? 0,
              opt.usable === false ? "STOPPED" : "SALE",
              "옵션",
              today,
            ]);
            count++;
          }

          // 추가상품 행 (같은 채널상품번호 아래)
          for (const add of detail?.additionals ?? []) {
            rows.push([
              store.name,
              originNo,
              chNo,
              String(add.sellerManagementCode ?? add.optionManageCode ?? add.id ?? ""),
              add.groupName ?? add.name ?? "",
              add.name ?? "",
              ch.wholeCategoryName ?? "",
              add.price ?? 0,
              add.usable === false ? "STOPPED" : "SALE",
              "추가",
              today,
            ]);
            count++;
          }
        }
      }
      console.log(`  → 정리 ${count}행 (detail ${detailFetched}개)`);
    } catch (err) {
      console.error(`  실패: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    }
    await sleep(2000);
  }

  if (rows.length === 0) {
    console.log("\n⚠️ 수집된 상품 없음. (API 권한 / IP 화이트리스트 확인)");
    console.log("   기존 시트 데이터는 그대로 유지 (안전망)");
    return;
  }
  // 매 실행마다 시트 데이터 싹 지우고 새로 작성 — 컬럼 정렬·stale 행·삭제 상품 자동 정리
  await clearTabData(creds, "상품목록", 2);
  await appendRows(creds, "상품목록!A2", rows);
  console.log(`\n✅ 「상품목록」 ${rows.length}행 새로 작성 (기존 데이터 클리어 후)`);
}

async function main(): Promise<void> {
  if (!SHEET_CREDS) throw new Error("Google Sheet 환경변수 없음");
  if (STORES.length === 0) throw new Error("NAVER_STORES_JSON 비어있음");
  const filterStore = process.argv[2];
  await dumpCatalog(SHEET_CREDS, filterStore);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.cause) {
    console.error("CAUSE:", err.cause);
  }
  if (err instanceof Error && err.stack) {
    console.error("STACK:", err.stack.split("\n").slice(0, 5).join("\n"));
  }
  process.exit(1);
});
