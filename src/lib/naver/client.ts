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

/** 결제일자 기간으로 결제 완료된 주문 ID 목록 조회 (orderId 단위 dedupe) */
export async function listPaidOrderIds(
  clientId: string,
  clientSecret: string,
  fromIso: string,
  toIso: string,
): Promise<string[]> {
  const ids = await listChangedProductOrderIds(clientId, clientSecret, fromIso, toIso);
  const seen = new Set<string>();
  for (const row of ids) seen.add(row.orderId);
  return Array.from(seen);
}

/** 결제일자 기간 내의 (orderId, productOrderId) 페어 목록 — bulk 쿼리에 사용 */
export async function listChangedProductOrderIds(
  clientId: string,
  clientSecret: string,
  fromIso: string,
  toIso: string,
): Promise<{ orderId: string; productOrderId: string }[]> {
  const out: { orderId: string; productOrderId: string }[] = [];
  // last-changed-statuses 는 페이지 없이 최대치를 한 번에 줌. 24시간 이내 권장.
  const params = new URLSearchParams({
    lastChangedFrom: fromIso,
    lastChangedTo: toIso,
    lastChangedType: "PAYED",
  });
  const data = await naverFetch<{
    data?: { lastChangeStatuses?: { productOrderId: string; orderId: string }[] };
  }>(clientId, clientSecret, `/v1/pay-order/seller/product-orders/last-changed-statuses?${params}`);
  for (const row of data.data?.lastChangeStatuses ?? []) {
    out.push({ orderId: row.orderId, productOrderId: row.productOrderId });
  }
  return out;
}

export interface NaverBulkProductOrder {
  productOrder: {
    productOrderId: string;
    orderId?: string;
    productId?: string;
    channelProductNo?: string;
    productName: string;
    productOption?: string;
    quantity: number;
    unitPrice: number;
    optionPrice?: number;
    totalPaymentAmount: number;
    totalProductAmount?: number;
    productDiscountAmount?: number;
    sellerProductCode?: string;
    productClass?: string;
    productOrderStatus?: string;
    paymentDate?: string;
    placeOrderDate?: string;
    knowledgeShoppingSellingInterlockCommission?: number;
    payCommissionAmount?: number;
    sellerCommissionAmount?: number;
    settleAmount?: number;
    settlementAmount?: number;
    deliveryFeeAmount?: number;
    paymentMeans?: string;
  };
  order?: {
    orderId: string;
    paymentDate?: string;
    paymentMeans?: string;
    ordererName?: string;
  };
  delivery?: { deliveryFeeAmount?: number };
}

/** productOrderIds 를 받아 상세를 한 번에 조회 (bulk). 한 호출당 최대 300개. */
export async function queryProductOrders(
  clientId: string,
  clientSecret: string,
  productOrderIds: string[],
): Promise<NaverBulkProductOrder[]> {
  const out: NaverBulkProductOrder[] = [];
  for (let i = 0; i < productOrderIds.length; i += 300) {
    const slice = productOrderIds.slice(i, i + 300);
    const data = await naverFetch<{ data?: NaverBulkProductOrder[] }>(
      clientId,
      clientSecret,
      `/v1/pay-order/seller/product-orders/query`,
      {
        method: "POST",
        body: JSON.stringify({ productOrderIds: slice, quantityClaimCompatibility: true }),
      },
    );
    for (const row of data.data ?? []) out.push(row);
  }
  return out;
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

export interface NaverProductLite {
  channelProductNo: string;
  name: string;
  status?: string;
  options?: string[];
}

/** 스토어의 상품 목록 페이지네이션 조회 */
export async function listProducts(
  clientId: string,
  clientSecret: string,
): Promise<NaverProductLite[]> {
  const out: NaverProductLite[] = [];
  let page = 1;
  for (let i = 0; i < 50; i++) {
    const params = new URLSearchParams({ page: String(page), size: "100" });
    const data = await naverFetch<{
      contents?: { channelProductNo: string; name: string; statusType?: string }[];
      page?: { totalPages?: number };
    }>(clientId, clientSecret, `/v1/products/search?${params}`);
    for (const p of data.contents ?? []) {
      out.push({ channelProductNo: String(p.channelProductNo), name: p.name, status: p.statusType });
    }
    const totalPages = data.page?.totalPages ?? 1;
    if (page >= totalPages) break;
    page += 1;
  }
  return out;
}
