import { prisma } from "@/lib/prisma";

const KST_OFFSET_MIN = 9 * 60;

export function previousDayKstRange(now: Date = new Date()): { fromIso: string; toIso: string; reportDate: Date } {
  const utc = now.getTime();
  const kstNow = new Date(utc + KST_OFFSET_MIN * 60_000);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  const startKstMs = Date.UTC(y, m, d - 1) - KST_OFFSET_MIN * 60_000;
  const endKstMs = Date.UTC(y, m, d) - KST_OFFSET_MIN * 60_000;
  return {
    fromIso: new Date(startKstMs).toISOString(),
    toIso: new Date(endKstMs).toISOString(),
    reportDate: new Date(Date.UTC(y, m, d - 1)),
  };
}

/** 키워드별 집계 행 — 한 스토어 안의 한 품종 (e.g. 비타앤오리진 × 피쿠알) */
export interface KeywordRow {
  storeName: string;
  keyword: string;
  optionUnits: number;        // 옵션 단위 수량 (주문된 옵션 인스턴스 합)
  bottles: number;            // 환산 병/개수 (qty × bottlesPerUnit)
  shipments: number;          // distinct 주문번호 수
  salesAmount: number;
  totalCommission: number;
  totalCost: number;          // 원가+물류+입출고+부자재+기타 (수수료 별도)
  profit: number;
}

/** 옵션 단위 상세 행 — 시트 일일집계 탭에 그대로 들어감 */
export interface DetailRow {
  storeName: string;
  productName: string;
  optionName: string;
  keyword: string;
  bottlesPerUnit: number;
  quantity: number;
  bottles: number;
  salesAmount: number;
  totalCommission: number;
  unitCost: number;
  shippingCost: number;
  fulfillCost: number;
  packagingCost: number;
  etcCost: number;
  totalCost: number;
  profit: number;
}

export interface ReportSummary {
  reportDate: Date;
  fromIso: string;
  toIso: string;
  details: DetailRow[];
  byKeyword: KeywordRow[];
  byStore: { storeName: string; salesAmount: number; profit: number; bottles: number; shipments: number }[];
  totals: {
    optionUnits: number;
    bottles: number;
    shipments: number;
    salesAmount: number;
    totalCommission: number;
    totalCost: number;
    profit: number;
  };
}

export async function buildDailyReport(
  fromIso: string,
  toIso: string,
  reportDate: Date,
  workspaceId?: string,
): Promise<ReportSummary> {
  const items = await prisma.naverOrderItem.findMany({
    where: {
      paymentDate: { gte: new Date(fromIso), lt: new Date(toIso) },
      ...(workspaceId ? { order: { store: { workspaceId } } } : {}),
      // watched 가 false 인 상품은 보고에서 제외 (null product 는 포함)
      OR: [{ productId: null }, { product: { watched: true } }],
    },
    include: {
      order: { include: { store: true } },
      product: { include: { costs: { orderBy: { effectiveAt: "desc" } } } },
    },
  });

  const details: DetailRow[] = [];
  // 키워드별 집계 + distinct orderId 추적
  const keywordMap = new Map<string, { row: KeywordRow; orderIds: Set<string> }>();

  for (const it of items) {
    const storeName = it.order.store.storeName;
    const cost = pickCost(it.product?.costs ?? [], it.optionName, it.paymentDate);
    const keyword = cost.keyword || it.productName; // 미매핑이면 상품명을 키워드로 폴백
    const bottlesPerUnit = cost.bottlesPerUnit || 1;
    const bottles = it.quantity * bottlesPerUnit;
    const totalCommission = it.channelCommission + it.payCommission;
    const perUnitCost = cost.unitCost + cost.shippingCost + cost.fulfillCost + cost.packagingCost + cost.etcCost;
    const totalCostExFee = perUnitCost * it.quantity;
    const totalCost = totalCostExFee + totalCommission;
    const profit = it.salesAmount - totalCost;

    details.push({
      storeName,
      productName: it.productName,
      optionName: it.optionName,
      keyword,
      bottlesPerUnit,
      quantity: it.quantity,
      bottles,
      salesAmount: it.salesAmount,
      totalCommission,
      unitCost: cost.unitCost * it.quantity,
      shippingCost: cost.shippingCost * it.quantity,
      fulfillCost: cost.fulfillCost * it.quantity,
      packagingCost: cost.packagingCost * it.quantity,
      etcCost: cost.etcCost * it.quantity,
      totalCost,
      profit,
    });

    const key = `${storeName}::${keyword}`;
    const existing = keywordMap.get(key);
    if (existing) {
      existing.row.optionUnits += it.quantity;
      existing.row.bottles += bottles;
      existing.row.salesAmount += it.salesAmount;
      existing.row.totalCommission += totalCommission;
      existing.row.totalCost += totalCost;
      existing.row.profit += profit;
      existing.orderIds.add(it.order.orderId);
    } else {
      keywordMap.set(key, {
        row: {
          storeName,
          keyword,
          optionUnits: it.quantity,
          bottles,
          shipments: 0,
          salesAmount: it.salesAmount,
          totalCommission,
          totalCost,
          profit,
        },
        orderIds: new Set([it.order.orderId]),
      });
    }
  }

  const byKeyword = Array.from(keywordMap.values())
    .map(({ row, orderIds }) => ({ ...row, shipments: orderIds.size }))
    .sort((a, b) => b.salesAmount - a.salesAmount);

  // 스토어별 요약
  const storeMap = new Map<string, { storeName: string; salesAmount: number; profit: number; bottles: number; orderIds: Set<string> }>();
  for (const it of items) {
    const storeName = it.order.store.storeName;
    const cost = pickCost(it.product?.costs ?? [], it.optionName, it.paymentDate);
    const bottles = it.quantity * (cost.bottlesPerUnit || 1);
    const totalCommission = it.channelCommission + it.payCommission;
    const totalCost = (cost.unitCost + cost.shippingCost + cost.fulfillCost + cost.packagingCost + cost.etcCost) * it.quantity + totalCommission;
    const cur = storeMap.get(storeName);
    if (cur) {
      cur.salesAmount += it.salesAmount;
      cur.profit += it.salesAmount - totalCost;
      cur.bottles += bottles;
      cur.orderIds.add(it.order.orderId);
    } else {
      storeMap.set(storeName, {
        storeName,
        salesAmount: it.salesAmount,
        profit: it.salesAmount - totalCost,
        bottles,
        orderIds: new Set([it.order.orderId]),
      });
    }
  }
  const byStore = Array.from(storeMap.values())
    .map((s) => ({ storeName: s.storeName, salesAmount: s.salesAmount, profit: s.profit, bottles: s.bottles, shipments: s.orderIds.size }))
    .sort((a, b) => b.salesAmount - a.salesAmount);

  // 전체 합계 — distinct orderId 전체
  const allOrderIds = new Set<string>();
  for (const it of items) allOrderIds.add(it.order.orderId);
  const totals = byKeyword.reduce(
    (acc, r) => ({
      optionUnits: acc.optionUnits + r.optionUnits,
      bottles: acc.bottles + r.bottles,
      shipments: 0,
      salesAmount: acc.salesAmount + r.salesAmount,
      totalCommission: acc.totalCommission + r.totalCommission,
      totalCost: acc.totalCost + r.totalCost,
      profit: acc.profit + r.profit,
    }),
    { optionUnits: 0, bottles: 0, shipments: 0, salesAmount: 0, totalCommission: 0, totalCost: 0, profit: 0 },
  );
  totals.shipments = allOrderIds.size;

  return { reportDate, fromIso, toIso, details, byKeyword, byStore, totals };
}

interface CostMatch {
  keyword: string;
  bottlesPerUnit: number;
  unitCost: number;
  shippingCost: number;
  fulfillCost: number;
  packagingCost: number;
  etcCost: number;
}

function pickCost(
  costs: { optionName: string; effectiveAt: Date; keyword: string; bottlesPerUnit: number; unitCost: number; shippingCost: number; fulfillCost: number; packagingCost: number; etcCost: number }[],
  optionName: string,
  asOf: Date,
): CostMatch {
  const exact = costs.find((c) => c.optionName === optionName && c.effectiveAt <= asOf);
  const fallback = costs.find((c) => c.optionName === "" && c.effectiveAt <= asOf);
  const c = exact ?? fallback;
  if (!c) return { keyword: "", bottlesPerUnit: 1, unitCost: 0, shippingCost: 0, fulfillCost: 0, packagingCost: 0, etcCost: 0 };
  return {
    keyword: c.keyword,
    bottlesPerUnit: c.bottlesPerUnit,
    unitCost: c.unitCost,
    shippingCost: c.shippingCost,
    fulfillCost: c.fulfillCost,
    packagingCost: c.packagingCost,
    etcCost: c.etcCost,
  };
}

export function formatTelegramMessage(s: ReportSummary): string {
  const won = (n: number) => n.toLocaleString("ko-KR") + "원";
  const date = s.reportDate.toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`<b>📊 ${date} 매출 보고</b>`);
  lines.push(`<i>전일 00:00 ~ 24:00 결제 기준</i>`);
  lines.push("");
  lines.push(`💰 매출 <b>${won(s.totals.salesAmount)}</b>`);
  lines.push(`📦 배송 ${s.totals.shipments}건 · 출고 ${s.totals.bottles}병`);
  lines.push(`💚 이익 <b>${won(s.totals.profit)}</b> (수수료 ${won(s.totals.totalCommission)})`);
  lines.push("");
  lines.push("<b>━━ 키워드별 (옵션 합산) ━━</b>");
  for (const r of s.byKeyword) {
    lines.push(
      `• <b>${r.keyword}</b>${s.byStore.length > 1 ? ` <i>[${r.storeName}]</i>` : ""}\n` +
      `   ${r.bottles}병 · ${won(r.salesAmount)} · 이익 ${won(r.profit)} · ${r.shipments}건`,
    );
  }
  if (s.byKeyword.length === 0) lines.push("(매출 없음)");
  if (s.byStore.length > 1) {
    lines.push("");
    lines.push("<b>━━ 스토어별 ━━</b>");
    for (const st of s.byStore) {
      lines.push(`• ${st.storeName} — ${won(st.salesAmount)} · ${st.bottles}병 · ${st.shipments}건`);
    }
  }
  return lines.join("\n");
}

export const DAILY_DETAIL_HEADERS = [
  "보고일","스토어","상품명","옵션","키워드","병수/단위","수량","총병수","매출","수수료","원가","물류비","입출고비","부자재비","기타비","총비용","이익",
];

export const DAILY_KEYWORD_HEADERS = [
  "보고일","스토어","키워드","옵션수","병수","배송건수","매출","수수료","총비용","이익",
];

export function buildDetailRows(s: ReportSummary): (string | number)[][] {
  const date = s.reportDate.toISOString().slice(0, 10);
  return s.details.map((r) => [
    date, r.storeName, r.productName, r.optionName, r.keyword, r.bottlesPerUnit,
    r.quantity, r.bottles, r.salesAmount, r.totalCommission,
    r.unitCost, r.shippingCost, r.fulfillCost, r.packagingCost, r.etcCost,
    r.totalCost, r.profit,
  ]);
}

export function buildKeywordRows(s: ReportSummary): (string | number)[][] {
  const date = s.reportDate.toISOString().slice(0, 10);
  return s.byKeyword.map((r) => [
    date, r.storeName, r.keyword, r.optionUnits, r.bottles, r.shipments,
    r.salesAmount, r.totalCommission, r.totalCost, r.profit,
  ]);
}
