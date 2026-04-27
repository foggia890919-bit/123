import "dotenv/config";
import { getAccessToken } from "../src/lib/naver/client";

const stores = [
  { name: "비타앤오리진", id: process.env.NAVER_STORE_A_CLIENT_ID, secret: process.env.NAVER_STORE_A_CLIENT_SECRET },
  { name: "여기명품", id: process.env.NAVER_STORE_B_CLIENT_ID, secret: process.env.NAVER_STORE_B_CLIENT_SECRET },
  { name: "와이케이팜", id: process.env.NAVER_STORE_C_CLIENT_ID, secret: process.env.NAVER_STORE_C_CLIENT_SECRET },
];

async function main() {
  const only = process.argv[2];
  const target = only ? stores.filter((s) => s.name.includes(only)) : stores;
  for (const s of target) {
    if (!s.id || !s.secret) {
      console.log(`✗ ${s.name}: missing key`);
      continue;
    }
    try {
      const tok = await getAccessToken(s.id, s.secret);
      console.log(`✓ ${s.name} OK (token: ${tok.slice(0, 20)}...)`);
    } catch (err) {
      console.log(`✗ ${s.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main().catch(console.error);
