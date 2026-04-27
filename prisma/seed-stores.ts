import { prisma } from "../src/lib/prisma";

interface StoreEnv {
  code: string;
  bizName: string;
  storeName: string;
  clientId: string;
  clientSecret: string;
}

function readStores(): StoreEnv[] {
  const list: StoreEnv[] = [];
  for (const k of ["A", "B", "C"]) {
    const code = process.env[`NAVER_STORE_${k}_CODE`];
    const clientId = process.env[`NAVER_STORE_${k}_CLIENT_ID`];
    const clientSecret = process.env[`NAVER_STORE_${k}_CLIENT_SECRET`];
    if (!code || !clientId || !clientSecret) continue;
    list.push({
      code,
      bizName: process.env[`NAVER_STORE_${k}_BIZ_NAME`] ?? `${k}사업자`,
      storeName: process.env[`NAVER_STORE_${k}_STORE_NAME`] ?? `${k}스토어`,
      clientId,
      clientSecret,
    });
  }
  return list;
}

async function main() {
  const stores = readStores();
  for (const s of stores) {
    await prisma.naverStore.upsert({
      where: { code: s.code },
      create: s,
      update: { bizName: s.bizName, storeName: s.storeName, clientId: s.clientId, clientSecret: s.clientSecret },
    });
    console.log(`✓ ${s.code} ${s.storeName}`);
  }
  console.log(`Seeded ${stores.length} stores.`);
}

main().finally(() => process.exit(0));
