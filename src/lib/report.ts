import { prisma } from "@/lib/prisma";

const KST_OFFSET_MIN = 9 * 60;

/** KST 자정 기준 [전일 00:00, 당일 00:00) 의 ISO 범위 (UTC ISO 문자열) 반환 */
export function previousDayKstRange(now: Date = new Date()): { fromIso: string; toIso: string; reportDate: Date } {
  const utc = now.getTime();
  const kstNow = new Date(utc + KST_OFFSET_MIN * 60_000);
  const kstYear = kstNow.getUTCFullYear();
  const kstMonth = kstNow.getUTCMonth();
  const kstDate = kstNow.getUTCDate();
  const startKstMs = Date.UTC(kstYear, kstMonth, kstDate - 1) - KST_OFFSET_MIN * 60_000;
  const endKstMs = Date.UTC(kstYear, kstMonth, kstDate) - KST_OFFSET_MIN * 60_000;
  return {
    fromIso: new Date(startKstMs).toISOString(),
    toIso: new Date(endKstMs).toISOString(),
    reportDate: new Date(Date.UTC(kstYear, kstMonth, kstDate - 1)),
  };
}

export interface AggregatedRow {
  storeName: string;
  productName: string;
  optionName: string;
  quantity: number;
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
  rows: AggregatedRow[];
  totals: {
    quantity: number;
    salesAmount: number;
    totalCommission: number;
    totalCost: number;
    profit: number;
  };
  byStore: { storeName: string; salesAmount: number; profit: number; quantity: number }[];
}

export async function buildDailyReport(fromIso: string, toIso: string, reportDate: Date): Promise<ReportSummary> {
  const items = await prisma.naverOrderItem.findMany({
    where: { paymentDate: { gte: new Date(fromIso), lt: new Date(toIso) } },
    include: {
      order: { include: { store: true } },
      product: { include: { costs: { orderBy: { effectiveAt: "desc" } } } },
    },
  });

  const map = new Map<string, AggregatedRow>();

  for (const it of items) {
    const storeName = it.order.store.storeName;
    const key = `${storeName}::${it.productName}::${it.optionName}`;
    const cost = pickCost(it.product?.costs ?? [], it.optionName, it.paymentDate);
    const totalCommission = it.channelCommission + it.payCommission;
    const perUnitCost =
      cost.unitCost + cost.shippingCost + cost.fulfillCost + cost.packagingCost + cost.etcCost;
    const totalCost = perUnitCost * it.quantity + totalCommission;
    const profit = it.salesAmount - totalCost;

    const prev = map.get(key);
    if (prev) {
      prev.quantity += it.quantity;
      prev.salesAmount += it.salesAmount;
      prev.totalCommission += totalCommission;
      prev.unitCost += cost.unitCost * it.quantity;
      prev.shippingCost += cost.shippingCost * it.quantity;
      prev.fulfillCost += cost.fulfillCost * it.quantity;
      prev.packagingCost += cost.packagingCost * it.quantity;
      prev.etcCost += cost.etcCost * it.quantity;
      prev.totalCost += totalCost;
      prev.profit += profit;
    } else {
      map.set(key, {
        storeName,
        productName: it.productName,
        optionName: it.optionName,
        quantity: it.quantity,
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
    }
  }

  const rows = Array.from(map.values()).sort(
    (a, b) => b.salesAmount - a.salesAmount,
  );

  const totals = rows.reduce(
    (acc, r) => ({
      quantity: acc.quantity + r.quantity,
      salesAmount: acc.salesAmount + r.salesAmount,
      totalCommission: acc.totalCommission + r.totalCommission,
      totalCost: acc.totalCost + r.totalCost,
      profit: acc.profit + r.profit,
    }),
    { quantity: 0, salesAmount: 0, totalCommission: 0, totalCost: 0, profit: 0 },
  );

  const storeMap = new Map<string, { storeName: string; salesAmount: number; profit: number; quantity: number }>();
  for (const r of rows) {
    const cur = storeMap.get(r.storeName);
    if (cur) {
      cur.salesAmount += r.salesAmount;
      cur.profit += r.profit;
      cur.quantity += r.quantity;
    } else {
      storeMap.set(r.storeName, {
        storeName: r.storeName,
        salesAmount: r.salesAmount,
        profit: r.profit,
        quantity: r.quantity,
      });
    }
  }

  return {
    reportDate,
    fromIso,
    toIso,
    rows,
    totals,
    byStore: Array.from(storeMap.values()).sort((a, b) => b.salesAmount - a.salesAmount),
  };
}

function pickCost(
  costs: { optionName: string; effectiveAt: Date; unitCost: number; shippingCost: number; fulfillCost: number; packagingCost: number; etcCost: number }[],
  optionName: string,
  asOf: Date,
): { unitCost: number; shippingCost: number; fulfillCost: number; packagingCost: number; etcCost: number } {
  const exact = costs.find((c) => c.optionName === optionName && c.effectiveAt <= asOf);
  const fallback = costs.find((c) => c.optionName === "" && c.effectiveAt <= asOf);
  const c = exact ?? fallback;
  if (!c) return { unitCost: 0, shippingCost: 0, fulfillCost: 0, packagingCost: 0, etcCost: 0 };
  return {
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
  lines.push(`<b>📊 일일 매출 보고 — ${date}</b>`);
  lines.push("");
  lines.push(`총 매출: <b>${won(s.totals.salesAmount)}</b>`);
  lines.push(`총 비용: ${won(s.totals.totalCost)}  (수수료 ${won(s.totals.totalCommission)} 포함)`);
  lines.push(`총 이익: <b>${won(s.totals.profit)}</b>`);
  lines.push(`총 수량: ${s.totals.quantity}개`);
  lines.push("");
  lines.push("<b>스토어별</b>");
  for (const st of s.byStore) {
    lines.push(`• ${st.storeName} — 매출 ${won(st.salesAmount)} / 이익 ${won(st.profit)} / ${st.quantity}개`);
  }
  lines.push("");
  lines.push("<b>상품·옵션 TOP 10</b>");
  for (const r of s.rows.slice(0, 10)) {
    const opt = r.optionName ? ` [${r.optionName}]` : "";
    lines.push(`• ${r.storeName} | ${r.productName}${opt} — ${r.quantity}개 / 매출 ${won(r.salesAmount)} / 이익 ${won(r.profit)}`);
  }
  if (s.rows.length > 10) lines.push(`…외 ${s.rows.length - 10}건`);
  return lines.join("\n");
}

export function buildSheetRows(s: ReportSummary): (string | number)[][] {
  const date = s.reportDate.toISOString().slice(0, 10);
  const header = [
    "보고일",
    "스토어",
    "상품명",
    "옵션",
    "수량",
    "매출",
    "수수료",
    "원가",
    "물류비",
    "입출고비",
    "부자재비",
    "기타비",
    "총비용",
    "이익",
  ];
  const rows = s.rows.map((r) => [
    date,
    r.storeName,
    r.productName,
    r.optionName,
    r.quantity,
    r.salesAmount,
    r.totalCommission,
    r.unitCost,
    r.shippingCost,
    r.fulfillCost,
    r.packagingCost,
    r.etcCost,
    r.totalCost,
    r.profit,
  ]);
  return [header, ...rows];
}
