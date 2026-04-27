import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseFileBuffer, pick, toInt } from "@/lib/parse-excel";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });

  const buf = await file.arrayBuffer();
  const { rows } = parseFileBuffer(buf);

  let count = 0;
  for (const r of rows) {
    const storeCode = pick(r, ["스토어코드", "스토어", "사업자코드"]);
    const channelProductNo = pick(r, ["채널상품번호", "상품번호", "productNo"]);
    const productName = pick(r, ["상품명", "제품명"]);
    const optionName = pick(r, ["옵션", "옵션명"]);
    if (!storeCode || (!channelProductNo && !productName)) continue;

    const store = await prisma.naverStore.findUnique({ where: { code: storeCode } });
    if (!store) continue;

    const product = await prisma.naverProduct.upsert({
      where: { storeId_channelProductNo: { storeId: store.id, channelProductNo: channelProductNo || productName } },
      create: { storeId: store.id, channelProductNo: channelProductNo || productName, productName },
      update: { productName: productName || undefined },
    });

    await prisma.productCost.upsert({
      where: {
        productId_optionName_effectiveAt: {
          productId: product.id,
          optionName,
          effectiveAt: new Date(0),
        },
      },
      create: {
        productId: product.id,
        optionName,
        unitCost: toInt(pick(r, ["원가", "단가원가", "사입가"])),
        shippingCost: toInt(pick(r, ["물류비", "배송비"])),
        fulfillCost: toInt(pick(r, ["입출고비", "창고비", "3PL"])),
        packagingCost: toInt(pick(r, ["부자재비", "포장비"])),
        etcCost: toInt(pick(r, ["기타", "기타비"])),
        effectiveAt: new Date(0),
      },
      update: {
        unitCost: toInt(pick(r, ["원가", "단가원가", "사입가"])),
        shippingCost: toInt(pick(r, ["물류비", "배송비"])),
        fulfillCost: toInt(pick(r, ["입출고비", "창고비", "3PL"])),
        packagingCost: toInt(pick(r, ["부자재비", "포장비"])),
        etcCost: toInt(pick(r, ["기타", "기타비"])),
      },
    });
    count += 1;
  }

  return NextResponse.json({ ok: true, count });
}
