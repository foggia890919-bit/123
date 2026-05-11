/**
 * 특정 productOrderId 의 네이버 API 원본 필드 전부 dump
 *
 * 사용법:
 *   npx tsx audit.ts <productOrderId>
 *
 * 출력:
 *   - productOrder 의 모든 필드 (수수료/할인/보전/정산 관련 필드 다)
 *   - 어느 스토어에서 가져왔는지
 *
 * 용도:
 *   - 「매출 - 수수료 ≠ 정산예정」 차이 추적
 *   - 어떤 차감/보전이 적용됐는지 확인
 */

import "dotenv/config";
import bcrypt from "bcryptjs";

interface StoreConfig {
  name: string;
  clientId: string;
  clientSecret: string;
}
const STORES: StoreConfig[] = JSON.parse(process.env.NAVER_STORES_JSON ?? "[]");
const NAVER_BASE = "https://api.commerce.naver.com/external";

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const ts = Date.now();
  const sign = Buffer.from(
    bcrypt.hashSync(`${clientId}_${ts}`, clientSecret),
    "utf8",
  ).toString("base64");
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

async function fetchProductOrder(token: string, productOrderId: string): Promise<unknown> {
  const res = await fetch(`${NAVER_BASE}/v1/pay-order/seller/product-orders/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      productOrderIds: [productOrderId],
      quantityClaimCompatibility: true,
    }),
  });
  if (!res.ok) throw new Error(`query ${res.status}: ${await res.text()}`);
  const d = (await res.json()) as { data?: unknown[] };
  return d.data?.[0] ?? null;
}

function dumpObj(obj: unknown, indent = 0): void {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) {
    console.log(pad + String(obj));
    return;
  }
  if (typeof obj !== "object") {
    console.log(pad + String(obj));
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      console.log(`${pad}[${i}]:`);
      dumpObj(v, indent + 1);
    });
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") {
      console.log(`${pad}${k}: ${v ?? "null"}`);
    } else if (typeof v === "object") {
      console.log(`${pad}${k}:`);
      dumpObj(v, indent + 1);
    } else {
      console.log(`${pad}${k}: ${typeof v === "string" ? `"${v}"` : v}`);
    }
  }
}

async function main(): Promise<void> {
  const pid = process.argv[2];
  if (!pid) {
    console.log("사용법: npx tsx audit.ts <productOrderId>");
    console.log("예시:   npx tsx audit.ts 2026050387582712");
    process.exit(0);
  }

  for (const store of STORES) {
    console.log(`\n━━━ ${store.name} 시도 ━━━`);
    try {
      const token = await getToken(store.clientId, store.clientSecret);
      const data = await fetchProductOrder(token, pid);
      if (!data) {
        console.log("  (해당 productOrderId 없음)");
        continue;
      }
      console.log(`  ✅ 찾음:\n`);
      dumpObj(data);

      // 핵심 금액 요약
      const o = data as { productOrder?: Record<string, unknown> };
      const po = o.productOrder;
      if (po) {
        console.log("\n━━ 💰 금액 요약 ━━");
        const moneyFields = [
          "totalPaymentAmount",
          "productPrice",
          "salePrice",
          "deliveryFeeAmount",
          "productDiscountAmount",
          "sellerDiscountAmount",
          "naverPayPointsUsage",
          "knowledgeShoppingSellingInterlockCommission",
          "payCommissionAmount",
          "channelCommission",
          "naverShoppingCommission",
          "settlementAmount",
          "expectedSettlementAmount",
          "settleAmount",
          "remitFeeAmount",
          "vatAmount",
          "adjustmentAmount",
        ];
        for (const f of moneyFields) {
          if (f in po) console.log(`  ${f.padEnd(50)}${String(po[f]).padStart(15)}`);
        }
      }
      return; // 첫 번째 발견 시 종료
    } catch (err) {
      console.log(`  실패: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
    }
  }
  console.log("\n어느 스토어에서도 찾지 못함.");
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
