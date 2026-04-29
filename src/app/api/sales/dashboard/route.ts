import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";
import { isRevenueStatus } from "@/lib/order-status";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstStartOfDay(date: Date): Date {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_OFFSET_MS);
}

function dateKstStr(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDateParam(s: string | null, fallback: Date): Date {
  if (!s) return fallback;
  return new Date(`${s}T00:00:00+09:00`);
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

const ZERO_COST: CostMatch = { keyword: "", bottlesPerUnit: 1, unitCost: 0, shippingCost: 0, fulfillCost: 0, packagingCost: 0, etcCost: 0 };

interface ItemLite {
  paymentDate: Date;
  quantity: number;
  salesAmount: number;
  channelCommission: number;
  payCommission: number;
  productName: string;
  optionName: string;
  storeId: string;
  storeName: string;
  orderId: string;
  cost: CostMatch;
}

async function fetchItems(workspaceId: string, storeId: string, keyword: string, from: Date, to: Date): Promise<ItemLite[]> {
  const items = await prisma.naverOrderItem.findMany({
    where: {
      paymentDate: { gte: from, lt: to },
      order: { store: { workspaceId, ...(storeId ? { id: storeId } : {}) } },
      OR: [{ productId: null }, { product: { watched: true } }],
    },
    include: {
      order: { include: { store: { select: { id: true, storeName: true } } } },
      product: { include: { costs: { orderBy: { effectiveAt: "desc" }, take: 1 } } },
    },
  });
  const out: ItemLite[] = [];
  for (const it of items) {
    if (!isRevenueStatus(it.status, it.detailStatus)) continue;
    const c = it.product?.costs[0];
    const cost: CostMatch = c ? {
      keyword: c.keyword,
      bottlesPerUnit: c.bottlesPerUnit,
      unitCost: c.unitCost,
      shippingCost: c.shippingCost,
      fulfillCost: c.fulfillCost,
      packagingCost: c.packagingCost,
      etcCost: c.etcCost,
    } : ZERO_COST;
    const k = cost.keyword || it.productName;
    if (keyword && k !== keyword) continue;
    out.push({
      paymentDate: it.paymentDate,
      quantity: it.quantity,
      salesAmount: it.salesAmount,
      channelCommission: it.channelCommission,
      payCommission: it.payCommission,
      productName: it.productName,
      optionName: it.optionName,
      storeId: it.order.store.id,
      storeName: it.order.store.storeName,
      orderId: it.order.orderId,
      cost,
    });
  }
  return out;
}

function aggregate(items: ItemLite[]) {
  const byDay = new Map<string, { date: string; sales: number; profit: number; bottles: number; shipments: Set<string>; quantity: number }>();
  const byKeyword = new Map<string, { keyword: string; sales: number; profit: number; bottles: number; shipments: Set<string>; quantity: number }>();
  const byStore = new Map<string, { storeId: string; storeName: string; sales: number; profit: number; bottles: number; quantity: number; shipments: Set<string> }>();
  const byProduct = new Map<string, { productName: string; sales: number; quantity: number; bottles: number }>();
  const byWeekday = new Array(7).fill(0).map((_, i) => ({ weekday: i, sales: 0, quantity: 0, shipments: new Set<string>() }));
  const byHour = new Array(24).fill(0).map((_, i) => ({ hour: i, sales: 0, shipments: new Set<string>() }));
  let totalSales = 0;
  let totalProfit = 0;
  let totalBottles = 0;
  let totalQty = 0;
  const allShipments = new Set<string>();

  for (const it of items) {
    const c = it.cost;
    const bottles = it.quantity * c.bottlesPerUnit;
    const totalCommission = it.channelCommission + it.payCommission;
    const totalCost = (c.unitCost + c.shippingCost + c.fulfillCost + c.packagingCost + c.etcCost) * it.quantity + totalCommission;
    const profit = it.salesAmount - totalCost;
    const day = dateKstStr(it.paymentDate);
    const k = c.keyword || it.productName;

    totalSales += it.salesAmount;
    totalProfit += profit;
    totalBottles += bottles;
    totalQty += it.quantity;
    allShipments.add(it.orderId);

    const dB = byDay.get(day) ?? { date: day, sales: 0, profit: 0, bottles: 0, shipments: new Set<string>(), quantity: 0 };
    dB.sales += it.salesAmount;
    dB.profit += profit;
    dB.bottles += bottles;
    dB.quantity += it.quantity;
    dB.shipments.add(it.orderId);
    byDay.set(day, dB);

    const kB = byKeyword.get(k) ?? { keyword: k, sales: 0, profit: 0, bottles: 0, shipments: new Set<string>(), quantity: 0 };
    kB.sales += it.salesAmount;
    kB.profit += profit;
    kB.bottles += bottles;
    kB.quantity += it.quantity;
    kB.shipments.add(it.orderId);
    byKeyword.set(k, kB);

    const sB = byStore.get(it.storeId) ?? { storeId: it.storeId, storeName: it.storeName, sales: 0, profit: 0, bottles: 0, quantity: 0, shipments: new Set<string>() };
    sB.sales += it.salesAmount;
    sB.profit += profit;
    sB.bottles += bottles;
    sB.quantity += it.quantity;
    sB.shipments.add(it.orderId);
    byStore.set(it.storeId, sB);

    const pB = byProduct.get(it.productName) ?? { productName: it.productName, sales: 0, quantity: 0, bottles: 0 };
    pB.sales += it.salesAmount;
    pB.quantity += it.quantity;
    pB.bottles += bottles;
    byProduct.set(it.productName, pB);

    // KST 요일/시간대
    const kst = new Date(it.paymentDate.getTime() + KST_OFFSET_MS);
    const wd = kst.getUTCDay();
    const hr = kst.getUTCHours();
    byWeekday[wd].sales += it.salesAmount;
    byWeekday[wd].quantity += it.quantity;
    byWeekday[wd].shipments.add(it.orderId);
    byHour[hr].sales += it.salesAmount;
    byHour[hr].shipments.add(it.orderId);
  }

  return {
    totals: { sales: totalSales, profit: totalProfit, bottles: totalBottles, quantity: totalQty, shipments: allShipments.size },
    byDay,
    byKeyword: Array.from(byKeyword.values()).map((v) => ({ ...v, shipments: v.shipments.size })).sort((a, b) => b.sales - a.sales),
    byStore: Array.from(byStore.values()).map((v) => ({ ...v, shipments: v.shipments.size })).sort((a, b) => b.sales - a.sales),
    byProduct: Array.from(byProduct.values()).sort((a, b) => b.sales - a.sales),
    byWeekday: byWeekday.map((v) => ({ ...v, shipments: v.shipments.size })),
    byHour: byHour.map((v) => ({ ...v, shipments: v.shipments.size })),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { workspace } = await requireWorkspace();
    const url = new URL(req.url);
    const days = url.searchParams.get("days");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const storeId = url.searchParams.get("storeId") ?? "";
    const keyword = url.searchParams.get("keyword") ?? "";
    const compare = url.searchParams.get("compare") === "1";

    const now = new Date();
    const endKst = kstStartOfDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    let startKst: Date;
    let actualEndKst = endKst;
    if (fromParam) {
      startKst = parseDateParam(fromParam, endKst);
      if (toParam) {
        actualEndKst = kstStartOfDay(new Date(parseDateParam(toParam, endKst).getTime() + 24 * 60 * 60 * 1000));
      }
    } else {
      const d = Math.max(1, Math.min(400, parseInt(days ?? "14", 10)));
      startKst = new Date(endKst.getTime() - d * 24 * 60 * 60 * 1000);
    }

    const itemsCur = await fetchItems(workspace.id, storeId, keyword, startKst, actualEndKst);
    const cur = aggregate(itemsCur);

    // 직전 동일 기간
    let prev: typeof cur | null = null;
    if (compare) {
      const span = actualEndKst.getTime() - startKst.getTime();
      const prevEnd = startKst;
      const prevStart = new Date(startKst.getTime() - span);
      const itemsPrev = await fetchItems(workspace.id, storeId, keyword, prevStart, prevEnd);
      prev = aggregate(itemsPrev);
    }

    // 일별 채워넣기
    const dayList: { date: string; sales: number; profit: number; quantity: number; bottles: number; shipments: number }[] = [];
    const totalDays = Math.max(1, Math.round((actualEndKst.getTime() - startKst.getTime()) / (24 * 60 * 60 * 1000)));
    for (let i = 0; i < totalDays; i++) {
      const t = new Date(startKst.getTime() + i * 24 * 60 * 60 * 1000);
      const key = dateKstStr(t);
      const b = cur.byDay.get(key);
      dayList.push({
        date: key,
        sales: b?.sales ?? 0,
        profit: b?.profit ?? 0,
        quantity: b?.quantity ?? 0,
        bottles: b?.bottles ?? 0,
        shipments: b?.shipments.size ?? 0,
      });
    }

    const stores = await prisma.naverStore.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, storeName: true, code: true },
      orderBy: { storeName: "asc" },
    });

    return NextResponse.json({
      range: { fromKst: dateKstStr(startKst), toKst: dateKstStr(new Date(actualEndKst.getTime() - 1)), days: totalDays },
      totals: cur.totals,
      compare: prev
        ? {
            totals: prev.totals,
            delta: {
              sales: cur.totals.sales - prev.totals.sales,
              profit: cur.totals.profit - prev.totals.profit,
              quantity: cur.totals.quantity - prev.totals.quantity,
              bottles: cur.totals.bottles - prev.totals.bottles,
              shipments: cur.totals.shipments - prev.totals.shipments,
              salesPct: prev.totals.sales > 0 ? ((cur.totals.sales - prev.totals.sales) / prev.totals.sales) * 100 : null,
              profitPct: prev.totals.profit !== 0 ? ((cur.totals.profit - prev.totals.profit) / Math.abs(prev.totals.profit)) * 100 : null,
            },
          }
        : null,
      daily: dayList,
      byKeyword: cur.byKeyword,
      byStore: cur.byStore,
      byProduct: cur.byProduct.slice(0, 20),
      byWeekday: cur.byWeekday,
      byHour: cur.byHour,
      stores,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
