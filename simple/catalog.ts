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
import { ensureTab, upsertRows, loadCredsFromEnv, type SheetCreds } from "./sheets";

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
    "상품명",
    "카테고리",
    "가격",
    "상태",
    "유형(추정)",
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
      for (const p of products) {
        const channels = p.channelProducts ?? [];
        if (channels.length === 0) {
          // 채널 없는 경우 — 원본만이라도 기록
          rows.push([
            store.name,
            String(p.originProductNo ?? ""),
            "",
            p.name ?? "",
            "",
            0,
            p.statusType ?? "",
            "",
            today,
          ]);
          count++;
        }
        for (const ch of channels) {
          rows.push([
            store.name,
            String(p.originProductNo ?? ""),
            String(ch.channelProductNo ?? ""),
            ch.name ?? p.name ?? "",
            ch.wholeCategoryName ?? "",
            ch.salePrice ?? 0,
            ch.statusType ?? p.statusType ?? "",
            inferType(ch, p),
            today,
          ]);
          count++;
        }
      }
      console.log(`  → 정리 ${count}행`);
    } catch (err) {
      console.error(`  실패: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    }
    await sleep(2000);
  }

  if (rows.length === 0) {
    console.log("\n⚠️ 수집된 상품 없음. (API 권한 / IP 화이트리스트 확인)");
    return;
  }
  // 스토어+채널상품번호 기준 upsert
  await upsertRows(creds, "상품목록", rows, (r) => `${r[0]}|${r[2]}`);
  console.log(`\n✅ 「상품목록」 ${rows.length}행 갱신`);
}

async function main(): Promise<void> {
  if (!SHEET_CREDS) throw new Error("Google Sheet 환경변수 없음");
  if (STORES.length === 0) throw new Error("NAVER_STORES_JSON 비어있음");
  const filterStore = process.argv[2];
  await dumpCatalog(SHEET_CREDS, filterStore);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
