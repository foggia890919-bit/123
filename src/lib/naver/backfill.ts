import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import {
  listChangedProductOrderIds,
  queryProductOrders,
  type NaverBulkProductOrder,
} from "./client";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 자정으로 정규화 */
export function kstMidnight(d: Date): Date {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_OFFSET_MS);
}

export function dayWindow(kstMidnightStart: Date): { fromIso: string; toIso: string } {
  const end = new Date(kstMidnightStart.getTime() + 24 * 60 * 60 * 1000);
  return { fromIso: kstMidnightStart.toISOString(), toIso: end.toISOString() };
}

interface DayResult {
  date: string;
  orders: number;
  items: number;
  errors: string[];
}

/** 한 스토어의 하루치 결제완료 주문을 bulk 로 수집 → DB upsert */
export async function backfillOneDay(storeId: string, kstMidnightStart: Date): Promise<DayResult> {
  const store = await prisma.naverStore.findUniqueOrThrow({ where: { id: storeId } });
  const clientSecret = decrypt(store.clientSecret);
  const dateKey = new Date(kstMidnightStart.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
  const result: DayResult = { date: dateKey, orders: 0, items: 0, errors: [] };
  const { fromIso, toIso } = dayWindow(kstMidnightStart);

  let pairs: { orderId: string; productOrderId: string }[];
  try {
    pairs = await listChangedProductOrderIds(store.clientId, clientSecret, fromIso, toIso);
  } catch (err) {
    result.errors.push(`list: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
  if (pairs.length === 0) return result;

  let bulk: NaverBulkProductOrder[];
  try {
    bulk = await queryProductOrders(store.clientId, clientSecret, pairs.map((p) => p.productOrderId));
  } catch (err) {
    result.errors.push(`bulk: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // 주문 상위(NaverOrder) upsert: orderId 단위 합계
  const byOrder = new Map<string, NaverBulkProductOrder[]>();
  for (const row of bulk) {
    const oid = row.order?.orderId ?? row.productOrder.orderId ?? "";
    if (!oid) continue;
    if (!byOrder.has(oid)) byOrder.set(oid, []);
    byOrder.get(oid)!.push(row);
  }

  for (const [orderId, items] of byOrder) {
    const first = items[0];
    const paymentDate = first.order?.paymentDate
      ? new Date(first.order.paymentDate)
      : first.productOrder.paymentDate
        ? new Date(first.productOrder.paymentDate)
        : kstMidnightStart;
    const total = items.reduce((s, it) => s + (it.productOrder.totalPaymentAmount ?? 0), 0);
    const buyerName = first.order?.ordererName ?? null;

    const orderRow = await prisma.naverOrder.upsert({
      where: { storeId_orderId: { storeId: store.id, orderId } },
      create: { storeId: store.id, orderId, paymentDate, buyerName, totalAmount: total },
      update: { paymentDate, buyerName, totalAmount: total },
    });
    result.orders += 1;

    for (const row of items) {
      const po = row.productOrder;
      const channelProductNo = po.channelProductNo ?? po.productId ?? "";
      const productKey = channelProductNo || po.sellerProductCode || po.productName;
      const product = productKey
        ? await prisma.naverProduct.upsert({
            where: { storeId_channelProductNo: { storeId: store.id, channelProductNo: productKey } },
            create: { storeId: store.id, channelProductNo: productKey, productName: po.productName },
            update: { productName: po.productName },
          })
        : null;

      const ipoPaymentDate = po.paymentDate ? new Date(po.paymentDate) : paymentDate;
      const channelCommission = po.knowledgeShoppingSellingInterlockCommission ?? po.sellerCommissionAmount ?? 0;
      const payCommission = po.payCommissionAmount ?? 0;
      const settlement = po.settlementAmount ?? po.settleAmount ?? 0;
      const delivery = po.deliveryFeeAmount ?? row.delivery?.deliveryFeeAmount ?? 0;

      await prisma.naverOrderItem.upsert({
        where: { productOrderId: po.productOrderId },
        create: {
          orderId: orderRow.id,
          productId: product?.id ?? null,
          productOrderId: po.productOrderId,
          channelProductNo: channelProductNo || null,
          sellerProductCode: po.sellerProductCode ?? null,
          productName: po.productName,
          optionName: po.productOption ?? "",
          quantity: po.quantity,
          unitPrice: po.unitPrice,
          optionPrice: po.optionPrice ?? 0,
          discountAmount: po.productDiscountAmount ?? 0,
          salesAmount: po.totalPaymentAmount,
          channelCommission,
          payCommission,
          settlementAmount: settlement,
          deliveryFee: delivery,
          paymentMethod: row.order?.paymentMeans ?? po.paymentMeans ?? null,
          channelName: null,
          status: po.productOrderStatus ?? null,
          detailStatus: null,
          paymentDate: ipoPaymentDate,
          orderedAt: po.placeOrderDate ? new Date(po.placeOrderDate) : null,
        },
        update: {
          productId: product?.id ?? null,
          sellerProductCode: po.sellerProductCode ?? null,
          productName: po.productName,
          optionName: po.productOption ?? "",
          quantity: po.quantity,
          unitPrice: po.unitPrice,
          optionPrice: po.optionPrice ?? 0,
          discountAmount: po.productDiscountAmount ?? 0,
          salesAmount: po.totalPaymentAmount,
          channelCommission,
          payCommission,
          settlementAmount: settlement,
          deliveryFee: delivery,
          paymentMethod: row.order?.paymentMeans ?? po.paymentMeans ?? null,
          status: po.productOrderStatus ?? null,
          paymentDate: ipoPaymentDate,
          orderedAt: po.placeOrderDate ? new Date(po.placeOrderDate) : null,
        },
      });
      result.items += 1;
    }
  }
  return result;
}

/**
 * BackfillJob 의 cursor 부터 maxDays 일까지 처리.
 * 각 날 처리 후 cursor 를 즉시 갱신 → 중간 실패해도 재실행 시 이어감.
 */
export async function runBackfillChunk(jobId: string, maxDays = 7): Promise<{
  jobId: string;
  status: string;
  processed: number;
  ordersAdded: number;
  itemsAdded: number;
  cursor: string;
  done: boolean;
  errors: string[];
}> {
  const job = await prisma.backfillJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status === "DONE") {
    return {
      jobId,
      status: "DONE",
      processed: 0,
      ordersAdded: 0,
      itemsAdded: 0,
      cursor: job.cursor.toISOString(),
      done: true,
      errors: [],
    };
  }

  await prisma.backfillJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });

  let cursor = kstMidnight(job.cursor);
  const end = kstMidnight(job.toDate);
  let processed = 0;
  let ordersAdded = 0;
  let itemsAdded = 0;
  const errors: string[] = [];

  while (cursor < end && processed < maxDays) {
    try {
      const r = await backfillOneDay(job.storeId, cursor);
      ordersAdded += r.orders;
      itemsAdded += r.items;
      errors.push(...r.errors.map((e) => `${r.date}: ${e}`));
    } catch (err) {
      errors.push(`${cursor.toISOString().slice(0, 10)}: ${err instanceof Error ? err.message : String(err)}`);
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    processed += 1;
    await prisma.backfillJob.update({
      where: { id: jobId },
      data: {
        cursor,
        ordersAdded: { increment: 0 } as never,
      },
    });
  }

  // 누적 합계 + cursor 저장
  const done = cursor >= end;
  await prisma.backfillJob.update({
    where: { id: jobId },
    data: {
      cursor,
      ordersAdded: { increment: ordersAdded },
      itemsAdded: { increment: itemsAdded },
      status: done ? "DONE" : errors.length > 0 ? "FAILED" : "PENDING",
      errors: errors.length > 0 ? errors.slice(-50) : (job.errors ?? undefined),
    },
  });

  return {
    jobId,
    status: done ? "DONE" : errors.length > 0 ? "FAILED" : "PENDING",
    processed,
    ordersAdded,
    itemsAdded,
    cursor: cursor.toISOString(),
    done,
    errors,
  };
}
