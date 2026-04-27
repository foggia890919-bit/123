import { prisma } from "@/lib/prisma";
import { listPaidOrderIds, getOrderDetail } from "./client";

export interface SyncResult {
  store: string;
  orders: number;
  items: number;
  errors: string[];
}

/**
 * 한 스토어의 [from, to) 결제 주문을 수집해 DB 에 upsert.
 * 호출 측이 from/to 를 KST 기준으로 만들어 ISO(타임존 포함)로 넘겨야 함.
 */
export async function syncStoreOrders(
  storeId: string,
  fromIso: string,
  toIso: string,
): Promise<SyncResult> {
  const store = await prisma.naverStore.findUniqueOrThrow({ where: { id: storeId } });
  const result: SyncResult = { store: store.code, orders: 0, items: 0, errors: [] };

  let orderIds: string[];
  try {
    orderIds = await listPaidOrderIds(store.clientId, store.clientSecret, fromIso, toIso);
  } catch (err) {
    result.errors.push(`list: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  for (const orderId of orderIds) {
    try {
      const detail = await getOrderDetail(store.clientId, store.clientSecret, orderId);
      await upsertOrder(store.id, detail);
      result.orders += 1;
      result.items += detail.productOrders.length;
    } catch (err) {
      result.errors.push(`order ${orderId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

async function upsertOrder(
  storeId: string,
  detail: Awaited<ReturnType<typeof getOrderDetail>>,
): Promise<void> {
  const paymentDate = detail.paymentDate ? new Date(detail.paymentDate) : new Date();
  const totalAmount = detail.totalAmount ?? sumItems(detail.productOrders);

  const order = await prisma.naverOrder.upsert({
    where: { storeId_orderId: { storeId, orderId: detail.orderId } },
    create: {
      storeId,
      orderId: detail.orderId,
      paymentDate,
      buyerName: detail.buyerName ?? null,
      totalAmount,
      raw: detail as unknown as object,
    },
    update: {
      paymentDate,
      buyerName: detail.buyerName ?? null,
      totalAmount,
      raw: detail as unknown as object,
    },
  });

  for (const po of detail.productOrders) {
    const productId = po.channelProductNo
      ? await ensureProduct(storeId, po.channelProductNo, po.productName)
      : null;

    await prisma.naverOrderItem.upsert({
      where: { productOrderId: po.productOrderId },
      create: {
        orderId: order.id,
        productId,
        productOrderId: po.productOrderId,
        channelProductNo: po.channelProductNo ?? null,
        productName: po.productName,
        optionName: po.productOption ?? "",
        quantity: po.quantity,
        unitPrice: po.unitPrice,
        salesAmount: po.totalPaymentAmount,
        channelCommission: po.knowledgeShoppingSellingInterlockCommission ?? 0,
        payCommission: po.commissionAmount ?? 0,
        status: po.productOrderStatus ?? null,
        paymentDate: po.paymentDate ? new Date(po.paymentDate) : paymentDate,
      },
      update: {
        productId,
        productName: po.productName,
        optionName: po.productOption ?? "",
        quantity: po.quantity,
        unitPrice: po.unitPrice,
        salesAmount: po.totalPaymentAmount,
        channelCommission: po.knowledgeShoppingSellingInterlockCommission ?? 0,
        payCommission: po.commissionAmount ?? 0,
        status: po.productOrderStatus ?? null,
        paymentDate: po.paymentDate ? new Date(po.paymentDate) : paymentDate,
      },
    });
  }
}

function sumItems(items: { totalPaymentAmount: number }[]): number {
  return items.reduce((acc, it) => acc + (it.totalPaymentAmount ?? 0), 0);
}

async function ensureProduct(
  storeId: string,
  channelProductNo: string,
  productName: string,
): Promise<string> {
  const existing = await prisma.naverProduct.findUnique({
    where: { storeId_channelProductNo: { storeId, channelProductNo } },
  });
  if (existing) return existing.id;
  const created = await prisma.naverProduct.create({
    data: { storeId, channelProductNo, productName },
  });
  return created.id;
}
