import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstStartOfDay(date: Date): Date {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_OFFSET_MS);
}

function dateKstStr(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const { workspace } = await requireWorkspace();
    const url = new URL(req.url);
    const days = Math.max(1, Math.min(400, parseInt(url.searchParams.get("days") ?? "14", 10)));
    const storeId = url.searchParams.get("storeId") ?? "";
    const keyword = url.searchParams.get("keyword") ?? "";

    const now = new Date();
    const endKst = kstStartOfDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    const startKst = new Date(endKst.getTime() - days * 24 * 60 * 60 * 1000);

    const items = await prisma.naverOrderItem.findMany({
      where: {
        paymentDate: { gte: startKst, lt: endKst },
        order: { store: { workspaceId: workspace.id, ...(storeId ? { id: storeId } : {}) } },
        OR: [{ productId: null }, { product: { watched: true } }],
      },
      include: {
        order: { include: { store: true } },
        product: { include: { costs: { orderBy: { effectiveAt: "desc" }, take: 1 } } },
      },
    });

    interface DayBucket {
      date: string;
      sales: number;
      profit: number;
      bottles: number;
      shipments: Set<string>;
    }
    const byDay = new Map<string, DayBucket>();
    const byKeyword = new Map<string, { keyword: string; sales: number; profit: number; bottles: number; shipments: Set<string> }>();
    const byStore = new Map<string, { storeName: string; storeId: string; sales: number; profit: number; bottles: number }>();
    let totalSales = 0;
    let totalProfit = 0;
    let totalBottles = 0;
    const allShipments = new Set<string>();

    for (const it of items) {
      const cost = it.product?.costs[0];
      const k = cost?.keyword || it.productName;
      if (keyword && k !== keyword) continue;
      const bottles = it.quantity * (cost?.bottlesPerUnit ?? 1);
      const totalCommission = it.channelCommission + it.payCommission;
      const totalCost =
        ((cost?.unitCost ?? 0) +
          (cost?.shippingCost ?? 0) +
          (cost?.fulfillCost ?? 0) +
          (cost?.packagingCost ?? 0) +
          (cost?.etcCost ?? 0)) *
          it.quantity +
        totalCommission;
      const profit = it.salesAmount - totalCost;
      const day = dateKstStr(it.paymentDate);

      totalSales += it.salesAmount;
      totalProfit += profit;
      totalBottles += bottles;
      allShipments.add(it.order.orderId);

      const dayBucket = byDay.get(day) ?? { date: day, sales: 0, profit: 0, bottles: 0, shipments: new Set<string>() };
      dayBucket.sales += it.salesAmount;
      dayBucket.profit += profit;
      dayBucket.bottles += bottles;
      dayBucket.shipments.add(it.order.orderId);
      byDay.set(day, dayBucket);

      const kw = byKeyword.get(k) ?? { keyword: k, sales: 0, profit: 0, bottles: 0, shipments: new Set<string>() };
      kw.sales += it.salesAmount;
      kw.profit += profit;
      kw.bottles += bottles;
      kw.shipments.add(it.order.orderId);
      byKeyword.set(k, kw);

      const sId = it.order.store.id;
      const st = byStore.get(sId) ?? { storeName: it.order.store.storeName, storeId: sId, sales: 0, profit: 0, bottles: 0 };
      st.sales += it.salesAmount;
      st.profit += profit;
      st.bottles += bottles;
      byStore.set(sId, st);
    }

    // 빠진 날짜는 0 으로 채움
    const dayList: { date: string; sales: number; profit: number; bottles: number; shipments: number }[] = [];
    for (let i = 0; i < days; i++) {
      const t = new Date(startKst.getTime() + i * 24 * 60 * 60 * 1000);
      const key = dateKstStr(t);
      const b = byDay.get(key);
      dayList.push({
        date: key,
        sales: b?.sales ?? 0,
        profit: b?.profit ?? 0,
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
      range: { fromKst: dateKstStr(startKst), toKst: dateKstStr(new Date(endKst.getTime() - 1)), days },
      totals: {
        sales: totalSales,
        profit: totalProfit,
        bottles: totalBottles,
        shipments: allShipments.size,
      },
      daily: dayList,
      byKeyword: Array.from(byKeyword.values())
        .map((v) => ({ keyword: v.keyword, sales: v.sales, profit: v.profit, bottles: v.bottles, shipments: v.shipments.size }))
        .sort((a, b) => b.sales - a.sales),
      byStore: Array.from(byStore.values()).sort((a, b) => b.sales - a.sales),
      stores,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
