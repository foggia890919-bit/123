import { prisma } from "@/lib/prisma";
import { listProducts } from "./client";
import { sendTelegram } from "@/lib/telegram";
import { decrypt } from "@/lib/crypto";

export interface ProductSyncResult {
  store: string;
  added: number;
  total: number;
  errors: string[];
}

/** 한 스토어의 상품 목록을 동기화. 새로 발견된 상품은 텔레그램 알림. */
export async function syncStoreProducts(storeId: string): Promise<ProductSyncResult> {
  const store = await prisma.naverStore.findUniqueOrThrow({
    where: { id: storeId },
    include: { workspace: true },
  });
  const result: ProductSyncResult = { store: store.code, added: 0, total: 0, errors: [] };
  let products;
  try {
    products = await listProducts(store.clientId, decrypt(store.clientSecret));
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
  result.total = products.length;
  const newOnes: string[] = [];
  for (const p of products) {
    const existing = await prisma.naverProduct.findUnique({
      where: { storeId_channelProductNo: { storeId: store.id, channelProductNo: p.channelProductNo } },
    });
    if (existing) {
      await prisma.naverProduct.update({
        where: { id: existing.id },
        data: { productName: p.name, lastImportedAt: new Date() },
      });
    } else {
      await prisma.naverProduct.create({
        data: {
          storeId: store.id,
          channelProductNo: p.channelProductNo,
          productName: p.name,
          lastImportedAt: new Date(),
          notifiedNew: false,
        },
      });
      result.added += 1;
      newOnes.push(p.name);
    }
  }
  await prisma.naverStore.update({ where: { id: store.id }, data: { lastSyncedAt: new Date() } });

  if (newOnes.length > 0) {
    const text = `🆕 [${store.workspace.name}/${store.storeName}] 신규 상품 ${newOnes.length}개\n` +
      newOnes.slice(0, 10).map((n) => `• ${n}`).join("\n") +
      (newOnes.length > 10 ? `\n…외 ${newOnes.length - 10}건` : "");
    const tgRes = await sendTelegram(text, store.workspace);
    if (!tgRes.ok) result.errors.push(`telegram: ${tgRes.error}`);

    await prisma.naverProduct.updateMany({
      where: { storeId: store.id, notifiedNew: false },
      data: { notifiedNew: true },
    });
  }
  return result;
}
