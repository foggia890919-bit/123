import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";
import { isRevenueStatus } from "@/lib/order-status";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstStartOfToday(): Date {
  const k = new Date(Date.now() + KST_OFFSET_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_OFFSET_MS);
}

async function aggregateRange(workspaceId: string, from: Date, to: Date) {
  const items = await prisma.naverOrderItem.findMany({
    where: {
      paymentDate: { gte: from, lt: to },
      order: { store: { workspaceId } },
      OR: [{ productId: null }, { product: { watched: true } }],
    },
    select: { quantity: true, salesAmount: true, channelCommission: true, payCommission: true, status: true, detailStatus: true, order: { select: { orderId: true } } },
  });
  const live = items.filter((it) => isRevenueStatus(it.status, it.detailStatus));
  const orders = new Set(live.map((it) => it.order.orderId));
  return {
    sales: live.reduce((a, b) => a + b.salesAmount, 0),
    quantity: live.reduce((a, b) => a + b.quantity, 0),
    shipments: orders.size,
    commission: live.reduce((a, b) => a + b.channelCommission + b.payCommission, 0),
    canceledCount: items.length - live.length,
  };
}

export async function GET() {
  try {
    const { workspace } = await requireWorkspace();
    const todayStart = kstStartOfToday();
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const yStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const last7Start = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prev7Start = new Date(last7Start.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [today, yesterday, last7, prev7] = await Promise.all([
      aggregateRange(workspace.id, todayStart, todayEnd),
      aggregateRange(workspace.id, yStart, todayStart),
      aggregateRange(workspace.id, last7Start, todayStart),
      aggregateRange(workspace.id, prev7Start, last7Start),
    ]);

    // 최근 백필 잡 + 신규 상품 알림
    const [backfillJobs, newProducts, recentReportLog] = await Promise.all([
      prisma.backfillJob.findMany({
        where: { workspaceId: workspace.id },
        include: { store: { select: { storeName: true } } },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.naverProduct.findMany({
        where: { store: { workspaceId: workspace.id } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { store: { select: { storeName: true } } },
      }),
      prisma.dailyReportLog.findFirst({
        where: { workspaceId: workspace.id },
        orderBy: { sentAt: "desc" },
      }),
    ]);

    // 키워드별 추세 알림 (지난 7일 vs 그 직전 7일)
    const last7Items = await prisma.naverOrderItem.findMany({
      where: {
        paymentDate: { gte: last7Start, lt: todayStart },
        order: { store: { workspaceId: workspace.id } },
        OR: [{ productId: null }, { product: { watched: true } }],
      },
      select: { quantity: true, salesAmount: true, productName: true, status: true, detailStatus: true, product: { select: { costs: { take: 1, orderBy: { effectiveAt: "desc" }, select: { keyword: true } } } } },
    });
    const prev7Items = await prisma.naverOrderItem.findMany({
      where: {
        paymentDate: { gte: prev7Start, lt: last7Start },
        order: { store: { workspaceId: workspace.id } },
        OR: [{ productId: null }, { product: { watched: true } }],
      },
      select: { quantity: true, salesAmount: true, productName: true, status: true, detailStatus: true, product: { select: { costs: { take: 1, orderBy: { effectiveAt: "desc" }, select: { keyword: true } } } } },
    });
    const tally = (rows: typeof last7Items) => {
      const m = new Map<string, { quantity: number; sales: number }>();
      for (const r of rows) {
        if (!isRevenueStatus(r.status, r.detailStatus)) continue;
        const k = r.product?.costs[0]?.keyword || r.productName;
        const cur = m.get(k) ?? { quantity: 0, sales: 0 };
        cur.quantity += r.quantity;
        cur.sales += r.salesAmount;
        m.set(k, cur);
      }
      return m;
    };
    const lastT = tally(last7Items);
    const prevT = tally(prev7Items);
    const allKeywords = new Set([...lastT.keys(), ...prevT.keys()]);
    const alerts: { keyword: string; severity: "DROP" | "SPIKE" | "NEW" | "GONE"; lastQty: number; prevQty: number; pct: number | null; message: string }[] = [];
    for (const k of allKeywords) {
      const l = lastT.get(k) ?? { quantity: 0, sales: 0 };
      const p = prevT.get(k) ?? { quantity: 0, sales: 0 };
      if (p.quantity === 0 && l.quantity >= 3) {
        alerts.push({ keyword: k, severity: "NEW", lastQty: l.quantity, prevQty: 0, pct: null, message: `신규 매출 발생: 지난 7일 ${l.quantity}개` });
      } else if (p.quantity >= 5 && l.quantity === 0) {
        alerts.push({ keyword: k, severity: "GONE", lastQty: 0, prevQty: p.quantity, pct: -100, message: `매출 중단: 직전 7일 ${p.quantity}개 → 0개` });
      } else if (p.quantity >= 5) {
        const pct = ((l.quantity - p.quantity) / p.quantity) * 100;
        if (pct <= -50) alerts.push({ keyword: k, severity: "DROP", lastQty: l.quantity, prevQty: p.quantity, pct, message: `📉 ${pct.toFixed(0)}% 감소 (${p.quantity}→${l.quantity}개)` });
        else if (pct >= 100) alerts.push({ keyword: k, severity: "SPIKE", lastQty: l.quantity, prevQty: p.quantity, pct, message: `📈 ${pct.toFixed(0)}% 급증 (${p.quantity}→${l.quantity}개)` });
      }
    }
    // 심각도 → 매출 영향 큰 순
    alerts.sort((a, b) => Math.abs((lastT.get(b.keyword)?.sales ?? 0) - (prevT.get(b.keyword)?.sales ?? 0)) - Math.abs((lastT.get(a.keyword)?.sales ?? 0) - (prevT.get(a.keyword)?.sales ?? 0)));

    return NextResponse.json({
      today,
      yesterday,
      last7,
      prev7,
      delta7: {
        sales: last7.sales - prev7.sales,
        salesPct: prev7.sales > 0 ? ((last7.sales - prev7.sales) / prev7.sales) * 100 : null,
        shipments: last7.shipments - prev7.shipments,
      },
      keywordAlerts: alerts.slice(0, 10),
      backfillJobs: backfillJobs.map((j) => ({
        id: j.id,
        storeName: j.store.storeName,
        status: j.status,
        ordersAdded: j.ordersAdded,
        cursor: j.cursor,
        toDate: j.toDate,
      })),
      newProducts: newProducts.map((p) => ({
        id: p.id,
        productName: p.productName,
        storeName: p.store.storeName,
        createdAt: p.createdAt,
      })),
      lastReport: recentReportLog ? {
        date: recentReportLog.reportDate,
        ok: recentReportLog.ok,
        sentAt: recentReportLog.sentAt,
        message: recentReportLog.message,
      } : null,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
