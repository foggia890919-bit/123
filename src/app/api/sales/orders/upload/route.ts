import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseFileBuffer, pick, toInt } from "@/lib/parse-excel";
import { appendRows } from "@/lib/sheets";

export const runtime = "nodejs";

function parseDate(s: string): Date {
  if (!s) return new Date();
  const cleaned = s.replace(/\./g, "-").trim();
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? new Date() : d;
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

  const orderMap = new Map<string, { paymentDate: Date; buyerName: string; total: number }>();
  let items = 0;
  const sheetRows: (string | number)[][] = [];

  for (const r of rows) {
    const productOrderId = pick(r, ["상품주문번호", "productOrderId"]);
    const orderId = pick(r, ["주문번호", "orderId"]) || productOrderId;
    if (!orderId || !productOrderId) continue;

    const channelProductNo = pick(r, ["채널상품번호", "상품번호"]);
    const productName = pick(r, ["상품명", "제품명"]);
    const optionName = pick(r, ["옵션", "옵션명", "옵션정보"]);
    const quantity = toInt(pick(r, ["수량", "주문수량"]));
    const unitPrice = toInt(pick(r, ["상품가격", "판매가", "단가"]));
    const salesAmount = toInt(pick(r, ["결제금액", "상품별총주문금액", "총주문금액"]));
    const payCommission = toInt(pick(r, ["네이버페이주문관리수수료", "결제수수료"]));
    const channelCommission = toInt(pick(r, ["매출연동수수료", "채널수수료"]));
    const status = pick(r, ["주문상태", "상품주문상태"]);
    const paymentDate = parseDate(pick(r, ["결제일", "결제일시", "결제일자"]));
    const buyerName = pick(r, ["구매자명", "주문자명"]);

    const product = channelProductNo || productName
      ? await prisma.naverProduct.upsert({
          where: {
            storeId_channelProductNo: {
              storeId: store.id,
              channelProductNo: channelProductNo || productName,
            },
          },
          create: { storeId: store.id, channelProductNo: channelProductNo || productName, productName },
          update: { productName: productName || undefined },
        })
      : null;

    const cur = orderMap.get(orderId);
    const newTotal = (cur?.total ?? 0) + salesAmount;
    orderMap.set(orderId, {
      paymentDate: cur?.paymentDate ?? paymentDate,
      buyerName: cur?.buyerName ?? buyerName,
      total: newTotal,
    });

    const order = await prisma.naverOrder.upsert({
      where: { storeId_orderId: { storeId: store.id, orderId } },
      create: { storeId: store.id, orderId, paymentDate, buyerName, totalAmount: salesAmount },
      update: { paymentDate, buyerName, totalAmount: newTotal },
    });

    await prisma.naverOrderItem.upsert({
      where: { productOrderId },
      create: {
        orderId: order.id,
        productId: product?.id ?? null,
        productOrderId,
        channelProductNo: channelProductNo || null,
        productName,
        optionName,
        quantity,
        unitPrice,
        salesAmount,
        channelCommission,
        payCommission,
        status: status || null,
        paymentDate,
      },
      update: {
        productId: product?.id ?? null,
        productName,
        optionName,
        quantity,
        unitPrice,
        salesAmount,
        channelCommission,
        payCommission,
        status: status || null,
        paymentDate,
      },
    });
    items += 1;
    sheetRows.push([
      paymentDate.toISOString().slice(0, 10),
      store.storeName,
      productName,
      optionName,
      quantity,
      salesAmount,
      payCommission + channelCommission,
    ]);
  }

  const sheet = sheetRows.length > 0 ? await appendRows("매출원본!A1", sheetRows) : { ok: true, skipped: true };

  return NextResponse.json({ ok: true, orders: orderMap.size, items, sheet });
}
