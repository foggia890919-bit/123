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
