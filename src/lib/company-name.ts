// 제약사명 정규화 — (주), 주식회사, (유), 유한회사 등 법인형태 접두/접미 제거
export function normalizeCompanyName(name: string): string {
  return name
    .replace(/^\(주\)\s*/g, "")
    .replace(/\s*\(주\)$/g, "")
    .replace(/^주식회사\s+/g, "")
    .replace(/\s+주식회사$/g, "")
    .replace(/^\(유\)\s*/g, "")
    .replace(/\s*\(유\)$/g, "")
    .replace(/^유한회사\s+/g, "")
    .replace(/\s+유한회사$/g, "")
    .replace(/^\(재\)\s*/g, "")
    .replace(/^\(사\)\s*/g, "")
    .replace(/^\(합\)\s*/g, "")
    .trim();
}
