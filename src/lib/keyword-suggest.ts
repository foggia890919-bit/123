/**
 * 단순 텍스트 기반 키워드 후보 추천.
 * 옵션명과 상품명에서 빈도 높은 명사·고유명사 후보를 추출.
 * (LLM 미사용 — 비용 0, 즉시 동작. 정확도 향상은 추후 별 옵션)
 */

const STOPWORDS = new Set([
  "세트", "상품", "옵션", "선택", "기본", "추가", "포함", "무료", "배송", "특가", "할인",
  "신상품", "베스트", "추천", "단품", "묶음", "구성", "사은품",
  "1병", "2병", "3병", "4병", "5병", "6병", "10병", "12병",
  "1개", "2개", "3개", "4개", "5개", "10개",
  "g", "kg", "ml", "L", "%",
]);

export function extractCandidates(text: string): string[] {
  if (!text) return [];
  const cleaned = text.replace(/[\[\]()/,|]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = cleaned.split(" ").filter(Boolean);
  const out: string[] = [];
  for (const t of tokens) {
    const w = t.replace(/^[^\w가-힣]+|[^\w가-힣]+$/g, "");
    if (!w) continue;
    if (STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    if (w.length < 2) continue;
    out.push(w);
  }
  return Array.from(new Set(out));
}

/** 상품·옵션에서 가장 흔한 단어를 그 product 의 추천 키워드 후보로 반환 */
export function suggestKeywordsForProduct(productName: string, optionNames: string[]): string[] {
  const counts = new Map<string, number>();
  for (const c of extractCandidates(productName)) counts.set(c, (counts.get(c) ?? 0) + 2);
  for (const op of optionNames) {
    for (const c of extractCandidates(op)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}
