import { buildSignature } from "./signature";

const BASE_URL = "https://api.commerce.naver.com/external";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const cached = tokenCache.get(clientId);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const timestamp = now;
  const signature = buildSignature(clientId, clientSecret, timestamp);

  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    grant_type: "client_credentials",
    client_secret_sign: signature,
    type: "SELF",
  });

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver token error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as TokenResponse;
  tokenCache.set(clientId, {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  });
  return data.access_token;
}

async function naverFetch<T>(
  clientId: string,
  clientSecret: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken(clientId, clientSecret);
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Naver API ${path} ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

/** 결제일자 기간으로 결제 완료된 주문 ID 목록 조회 */
export async function listPaidOrderIds(
  clientId: string,
  clientSecret: string,
  fromIso: string,
  toIso: string,
): Promise<string[]> {
  const params = new URLSearchParams({
    lastChangedFrom: fromIso,
    lastChangedTo: toIso,
    lastChangedType: "PAYED",
  });
  const data = await naverFetch<{
    data?: { lastChangeStatuses?: { productOrderId: string; orderId: string }[] };
  }>(clientId, clientSecret, `/v1/pay-order/seller/product-orders/last-changed-statuses?${params}`);
  const seen = new Set<string>();
  for (const row of data.data?.lastChangeStatuses ?? []) seen.add(row.orderId);
  return Array.from(seen);
}

export interface NaverOrderDetail {
  orderId: string;
  productOrders: NaverProductOrder[];
  buyerName?: string;
  paymentDate?: string;
  totalAmount?: number;
}

export interface NaverProductOrder {
  productOrderId: string;
  channelProductNo?: string;
  productName: string;
  productOption?: string;
  quantity: number;
  unitPrice: number;
  totalPaymentAmount: number;
  commissionAmount?: number;
  knowledgeShoppingSellingInterlockCommission?: number;
  productOrderStatus?: string;
  paymentDate?: string;
}

/** 단건 주문 상세 (productOrders 배열 포함) */
export async function getOrderDetail(
  clientId: string,
  clientSecret: string,
  orderId: string,
): Promise<NaverOrderDetail> {
  const data = await naverFetch<{ data?: NaverOrderDetail }>(
    clientId,
    clientSecret,
    `/v1/pay-order/seller/orders/${orderId}/product-order-ids`,
  );
  return data.data ?? { orderId, productOrders: [] };
}
