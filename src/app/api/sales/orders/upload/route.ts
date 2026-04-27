import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseFileBuffer, pick, toInt } from "@/lib/parse-excel";
import { appendRows, SHEET_TABS, ensureTabExists } from "@/lib/sheets";
import { HEADER, RAW_HEADERS } from "@/lib/naver/headers";

export const runtime = "nodejs";

function parseDate(s: string): Date | null {
  if (!s) return null;
  const cleaned = s.replace(/\./g, "-").replace("오전", "AM").replace("오후", "PM").trim();
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const storeCode = String(form.get("storeCode") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (!storeCode) return NextResponse.json({ error: "storeCode required" }, { status: 400 });

  const store = await prisma.naverStore.findUnique({ where: { code: storeCode } });
  if (!store) return NextResponse.json({ error: "store not found" }, { status: 404 });

  const buf = await file.arrayBuffer();
  const { rows } = parseFileBuffer(buf);

  const orderTotals = new Map<string, number>();
  const rawRows: (string | number)[][] = [];
  let items = 0;

  for (const r of rows) {
    const productOrderId = pick(r, HEADER.productOrderId);
    const orderId = pick(r, HEADER.orderId) || productOrderId;
    if (!productOrderId) continue;

    const channelProductNo = pick(r, HEADER.channelProductNo);
    const productName = pick(r, HEADER.productName);
    const optionName = pick(r, HEADER.optionName);
    const sellerProductCode = pick(r, HEADER.sellerProductCode);
    const quantity = toInt(pick(r, HEADER.quantity));
    const unitPrice = toInt(pick(r, HEADER.unitPrice));
    const optionPrice = toInt(pick(r, HEADER.optionPrice));
    const discountAmount = toInt(pick(r, HEADER.discount));
    const salesAmount = toInt(pick(r, HEADER.salesAmount));
    const payCommission = toInt(pick(r, HEADER.payCommission));
    const channelCommission = toInt(pick(r, HEADER.channelCommission));
    const settlementAmount = toInt(pick(r, HEADER.settlementAmount));
    const deliveryFee =
      toInt(pick(r, HEADER.deliveryFee)) +
      toInt(pick(r, HEADER.deliveryExtra)) -
      toInt(pick(r, HEADER.deliveryDiscount));
    const buyerName = pick(r, HEADER.buyerName) || pick(r, HEADER.recipientName);
    const paymentMethod = pick(r, HEADER.paymentMethod);
    const channelName = pick(r, HEADER.channelName);
    const status = pick(r, HEADER.status);
    const detailStatus = pick(r, HEADER.detailStatus);
    const paymentDate = parseDate(pick(r, HEADER.paymentDate)) ?? new Date();
    const orderedAt = parseDate(pick(r, HEADER.orderedAt));

    const productKey = channelProductNo || sellerProductCode || productName;
    const product = productKey
      ? await prisma.naverProduct.upsert({
          where: { storeId_channelProductNo: { storeId: store.id, channelProductNo: productKey } },
          create: { storeId: store.id, channelProductNo: productKey, productName: productName || productKey },
          update: { productName: productName || undefined },
        })
      : null;

    const total = (orderTotals.get(orderId) ?? 0) + salesAmount;
    orderTotals.set(orderId, total);

    const order = await prisma.naverOrder.upsert({
      where: { storeId_orderId: { storeId: store.id, orderId } },
      create: { storeId: store.id, orderId, paymentDate, buyerName, totalAmount: salesAmount },
      update: { paymentDate, buyerName, totalAmount: total },
    });

    await prisma.naverOrderItem.upsert({
      where: { productOrderId },
      create: {
        orderId: order.id,
        productId: product?.id ?? null,
        productOrderId,
        channelProductNo: channelProductNo || null,
        sellerProductCode: sellerProductCode || null,
        productName,
        optionName,
        quantity,
        unitPrice,
        optionPrice,
        discountAmount,
        salesAmount,
        channelCommission,
        payCommission,
        settlementAmount,
        deliveryFee,
        paymentMethod: paymentMethod || null,
        channelName: channelName || null,
        status: status || null,
        detailStatus: detailStatus || null,
        paymentDate,
        orderedAt,
      },
      update: {
        productId: product?.id ?? null,
        sellerProductCode: sellerProductCode || null,
        productName,
        optionName,
        quantity,
        unitPrice,
        optionPrice,
        discountAmount,
        salesAmount,
        channelCommission,
        payCommission,
        settlementAmount,
        deliveryFee,
        paymentMethod: paymentMethod || null,
        channelName: channelName || null,
        status: status || null,
        detailStatus: detailStatus || null,
        paymentDate,
        orderedAt,
      },
    });
    items += 1;
    rawRows.push(RAW_HEADERS.map((h) => r[h] ?? ""));
  }

  let sheet: Awaited<ReturnType<typeof appendRows>> = { ok: true, skipped: true };
  if (rawRows.length > 0) {
    await ensureTabExists(SHEET_TABS.raw, RAW_HEADERS);
    sheet = await appendRows(`${SHEET_TABS.raw}!A2`, rawRows);
  }

  return NextResponse.json({ ok: true, orders: orderTotals.size, items, sheet });
}
