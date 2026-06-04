/**
 * 여기명품 "사입리스트(신)" 구조 진단 (1회용, 읽기 전용).
 * 서버에서:  cd /home/ubuntu/sales/simple && npx tsx diag-yeogi.ts
 * AE열에 상품주문번호를 안전하게 prefill 하기 전, AD/AE 위치와 마지막 행을 확정한다.
 */
import "dotenv/config";
import { loadCredsFromEnv, readRange, getSheetIdMap, type SheetCreds } from "./sheets";

const YEOGI_ID = "10DgfEqudeXOBmFFm8vyOHHuHJp6nZXKaxv4ecpbVhno";

async function main() {
  const creds = loadCredsFromEnv();
  if (!creds) {
    console.error("시트 자격증명(.env GOOGLE_*) 없음");
    return;
  }
  const yc: SheetCreds = { ...creds, sheetId: YEOGI_ID };

  console.log("===== 스프레드시트 탭 목록 =====");
  let idmap: Map<string, number>;
  try {
    idmap = await getSheetIdMap(yc);
    console.log([...idmap.entries()].map(([n, g]) => `"${n}"(gid=${g})`).join("\n"));
  } catch (e) {
    console.error("탭 목록 읽기 실패(편집자 권한·공유 확인):", e instanceof Error ? e.message : e);
    return;
  }

  // "사입리스트(신)" 탭 찾기
  const tab = [...idmap.keys()].find((n) => n.includes("사입리스트(신)")) ?? [...idmap.keys()].find((n) => n.includes("사입리스트"));
  console.log(`\n===== 대상 탭: "${tab}" =====`);
  if (!tab) {
    console.error("'사입리스트(신)' 탭을 못 찾음. 위 목록에서 정확한 이름 확인 필요.");
    return;
  }

  const head = await readRange(yc, `${tab}!A1:AH1`);
  console.log("헤더(A~AH):", JSON.stringify(head[0]));

  const all = await readRange(yc, `${tab}!A1:AH100000`);
  console.log(`총 행수(헤더 포함): ${all.length}`);

  // AD(29)/AE(30) 마지막으로 값이 있는 행
  let lastAD = 0, lastAE = 0;
  all.forEach((r, i) => {
    if (String(r[29] ?? "").trim()) lastAD = i + 1;
    if (String(r[30] ?? "").trim()) lastAE = i + 1;
  });
  console.log(`AD열(idx29) 마지막 값 행: ${lastAD}`);
  console.log(`AE열(idx30) 마지막 값 행: ${lastAE}`);

  console.log("\n9590~9598 행의 AD/AE 상태:");
  for (let i = 9589; i < 9598 && i < all.length; i++) {
    console.log(`  행${i + 1}: AD="${all[i]?.[29] ?? ""}" | AE="${all[i]?.[30] ?? ""}"`);
  }
  console.log("\n최근 데이터 행 3개 (N키워드/Q옵션/AB도매가/AD주문번호):");
  for (let i = Math.max(1, lastAD - 3); i < lastAD && i < all.length; i++) {
    const r = all[i] ?? [];
    console.log(`  행${i + 1}: N="${r[13] ?? ""}" Q="${r[16] ?? ""}" AB="${r[27] ?? ""}" AD="${r[29] ?? ""}"`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
