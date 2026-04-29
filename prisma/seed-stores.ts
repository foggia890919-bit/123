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
  // 기본 워크스페이스 (멀티테넌시 도입 후): 첫 번째 ADMIN 사용자에게 묶음
  const owner = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!owner) {
    console.log("ADMIN 사용자가 없습니다. 먼저 회원가입 후 ADMIN 으로 승격하세요.");
    process.exit(1);
  }

  const ws = await prisma.workspace.upsert({
    where: { slug: "default" },
    create: {
      name: "기본 사업자",
      slug: "default",
      ownerId: owner.id,
      members: { create: { userId: owner.id, role: "OWNER" } },
    },
    update: {},
  });
  console.log(`✓ 워크스페이스: ${ws.name} (owner=${owner.email})`);

  const stores = readStores();
  for (const s of stores) {
    await prisma.naverStore.upsert({
      where: { workspaceId_code: { workspaceId: ws.id, code: s.code } },
      create: { ...s, workspaceId: ws.id },
      update: { bizName: s.bizName, storeName: s.storeName, clientId: s.clientId, clientSecret: s.clientSecret },
    });
    console.log(`  ✓ ${s.code} ${s.storeName}`);
  }
  console.log(`Seeded ${stores.length} stores into workspace ${ws.name}.`);
}

main().finally(() => prisma.$disconnect());
