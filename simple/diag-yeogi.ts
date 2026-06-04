/**
 * 여기명품 데이터 구조 진단 (1회용).
 * 서버에서:  cd /home/ubuntu/sales/simple && npx tsx diag-yeogi.ts
 * 사입관리 시트 + 주문원본의 실제 컬럼/값을 찍어, 네이버↔시트 매칭 경로를 확정한다.
 */
import "dotenv/config";
import { loadCredsFromEnv, readRange, getSheetIdMap, type SheetCreds } from "./sheets";

async function main() {
  const creds = loadCredsFromEnv();
  if (!creds) {
    console.error("시트 자격증명(.env GOOGLE_*) 없음");
    return;
  }

  // 1) 여기명품 사입관리 시트
  const YEOGI_ID = "10DgfEqudeXOBmFFm8vyOHHuHJp6nZXKaxv4ecpbVhno";
  const YEOGI_GID = 30917428;
  const yc: SheetCreds = { ...creds, sheetId: YEOGI_ID };
  console.log("===== [1] 여기명품 사입관리 시트 =====");
  try {
    const idmap = await getSheetIdMap(yc);
    let tab: string | undefined;
    for (const [n, g] of idmap) if (g === YEOGI_GID) tab = n;
    console.log("탭 이름:", tab);
    if (tab) {
      const head = await readRange(yc, `${tab}!A1:AE1`);
      console.log("헤더:", JSON.stringify(head[0]));
      const rows = await readRange(yc, `${tab}!A2:AE5000`);
      const recent = rows.filter((r) => r[29]).slice(-6); // AD(상품주문번호) 있는 최근 6
      console.log(`AD(주문번호) 있는 행: ${rows.filter((r) => r[29]).length}건, 최근 6건:`);
      for (const r of recent) {
        console.log(
          `  N(키워드)="${r[13]}" | P(상품명)="${r[15]}" | Q(옵션)="${r[16]}" | V(수량)="${r[21]}" | Y(주문금액)="${r[24]}" | AB(도매가)="${r[27]}" | AC(이익)="${r[28]}" | AD(주문번호)="${r[29]}"`,
        );
      }
    }
  } catch (e) {
    console.error("사입관리 읽기 실패:", e instanceof Error ? e.message : e);
  }

  // 2) 주문원본의 여기명품 행
  console.log("\n===== [2] 주문원본 여기명품 =====");
  try {
    const raw = await readRange(creds, "주문원본!A2:R100000");
    const yeogi = raw.filter((r) => String(r[1] ?? "").trim() === "여기명품");
    console.log(`여기명품 행 수: ${yeogi.length}, 최근 6건:`);
    for (const r of yeogi.slice(-6)) {
      console.log(
        `  결제일="${r[0]}" | 채널상품번호="${r[4]}" | 상품명="${r[5]}" | 옵션="${r[6]}" | 키워드="${r[7]}" | 수량="${r[8]}" | 매출="${r[10]}" | 정산="${r[12]}" | 원가="${r[15]}"`,
      );
    }
    const withCost = yeogi.filter((r) => (Number(String(r[15] ?? "").replace(/,/g, "")) || 0) > 0).length;
    console.log(`원가>0 인 여기명품 행: ${withCost}/${yeogi.length} (추정 재료가 얼마나 쌓여있는지)`);
  } catch (e) {
    console.error("주문원본 읽기 실패:", e instanceof Error ? e.message : e);
  }
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
