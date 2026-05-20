#!/usr/bin/env tsx
// 처방통계 표 사진 한 장 → Gemini → 마크다운 표 출력. Sheets append 안 함.
//
// 사용법:
//   GEMINI_API_KEY=xxx npx tsx scripts/test-gemini-rx-stats.ts <이미지경로>
//
// 예:
//   GEMINI_API_KEY=xxx npx tsx scripts/test-gemini-rx-stats.ts ~/test.jpg

import fs from "node:fs";
import path from "node:path";
import { extractRxStatsWithFallback } from "../src/lib/gemini-rx-stats-extract";

async function main() {
  const imgPath = process.argv[2];
  if (!imgPath) {
    console.error("사용법: GEMINI_API_KEY=xxx npx tsx scripts/test-gemini-rx-stats.ts <이미지경로>");
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY 환경변수가 필요합니다.");
    process.exit(1);
  }

  const absPath = path.resolve(imgPath);
  if (!fs.existsSync(absPath)) {
    console.error(`파일을 찾을 수 없습니다: ${absPath}`);
    process.exit(1);
  }

  const buf = fs.readFileSync(absPath);
  const ext = path.extname(absPath).slice(1).toLowerCase();
  const mime =
    ext === "png"  ? "image/png" :
    ext === "webp" ? "image/webp" :
    ext === "gif"  ? "image/gif" :
    ext === "bmp"  ? "image/bmp" :
    "image/jpeg";

  console.error(`[1/1] ${path.basename(absPath)} (${(buf.length / 1024).toFixed(1)} KB, ${mime}) → Gemini 분석 중...`);

  const t0 = Date.now();
  const { data, debug } = await extractRxStatsWithFallback(buf.toString("base64"), mime);
  const totalMs = Date.now() - t0;

  // ── 출력 (마크다운) ───────────────────────────────────────────────────────
  console.log("\n# Gemini 처방통계 분석 결과\n");

  console.log("## 메타");
  console.log(`- 제약사: ${data.pharma || "(미상)"}`);
  console.log(`- 기간: ${data.period || "(정규화 실패)"}${data.periodRaw && data.period !== data.periodRaw ? ` (원본: ${data.periodRaw})` : ""}`);
  console.log(`- 병원: ${data.hospital || "(미상)"}`);

  console.log("\n## 요약");
  console.log(`- 약품수: **${data.summary.drugCount}건**`);
  console.log(`- 처방횟수: **${data.summary.totalPrescriptions.toLocaleString()}회**`);
  console.log(`- 총사용량: **${data.summary.totalQuantity.toLocaleString()}**`);
  console.log(`- 총금액: **${data.summary.totalAmountWon.toLocaleString()}원**`);

  if (data.summary.drugCount > 0 && data.summary.drugCount !== data.drugs.length) {
    console.log(`\n> ⚠ **부분 추출 감지** — 사진 약품수 ${data.summary.drugCount} vs 추출 행 수 ${data.drugs.length}`);
  }

  // 카테고리별 그룹핑 (약한 정규화)
  const grouped = new Map<string, typeof data.drugs>();
  for (const d of data.drugs) {
    const key = (d.category || "기타").trim().replace(/\s*\/\s*/g, "/");
    const arr = grouped.get(key) ?? [];
    arr.push(d);
    grouped.set(key, arr);
  }
  // 합계 금액 기준 내림차순 정렬
  const sortedCats = [...grouped.entries()].sort(
    (a, b) =>
      b[1].reduce((s, d) => s + d.totalPrice, 0) -
      a[1].reduce((s, d) => s + d.totalPrice, 0),
  );

  for (const [cat, rows] of sortedCats) {
    const catTotal = rows.reduce((s, d) => s + d.totalPrice, 0);
    console.log(`\n## ${cat} (${rows.length}개, 합계 ${catTotal.toLocaleString()}원)\n`);
    console.log("| 약품명 | 보험코드 | 사용량 | 처방횟수 | 단가 | 총금액 | 효능 |");
    console.log("|---|---|---:|---:|---:|---:|---|");
    for (const r of rows) {
      console.log(
        `| ${r.name} | ${r.code || "-"} | ${r.quantity.toLocaleString()} | ${r.prescriptions.toLocaleString()} | ${r.unitPrice ? r.unitPrice.toLocaleString() : "-"} | ${r.totalPrice ? r.totalPrice.toLocaleString() : "-"} | ${r.efficacy || "-"} |`,
      );
    }
  }

  console.log("\n## debug");
  console.log(`- 최종 모델: ${debug.model}`);
  console.log(`- 응답 시간: ${debug.durationMs}ms`);
  console.log(`- Pro 폴백 사용: ${debug.fallbackUsed}${debug.flashDurationMs ? ` (Flash 시도 ${debug.flashDurationMs}ms)` : ""}`);
  console.log(`- 전체 wall time: ${totalMs}ms\n`);
}

main().catch((e) => {
  console.error("\n[ERROR]", e);
  process.exit(1);
});
