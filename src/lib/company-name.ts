// 제약사명 정규화 — (주), 주식회사, (유), 유한회사, ㈜ 등 법인 형태 + (본사), (파트너스) 등
// 부서/지점 표기 모두 제거. 사용자 표시용.
export function normalizeCompanyName(name: string): string {
  if (!name) return "";
  return name
    // 회사 형태 — 앞뒤 둘 다
    .replace(/^\(주\)\s*|\s*\(주\)$/g, "")
    .replace(/^㈜\s*|\s*㈜$/g, "")
    .replace(/^주식회사\s+|\s+주식회사$/g, "")
    .replace(/^\(유\)\s*|\s*\(유\)$/g, "")
    .replace(/^유한회사\s+|\s+유한회사$/g, "")
    .replace(/^\(재\)\s*/g, "")
    .replace(/^\(사\)\s*/g, "")
    .replace(/^\(합\)\s*/g, "")
    // 부서/지점/영업소 등 부수 표기
    .replace(/\s*\(본사\)$/g, "")
    .replace(/\s*\(지사\)$/g, "")
    .replace(/\s*\(지점\)$/g, "")
    .replace(/\s*\(파트너스\)$/g, "")
    .replace(/\s*\(파트너즈\)$/g, "")
    .replace(/\s*\(파너스\)$/g, "")     // 흔한 오타
    .replace(/\s*\(영업소\)$/g, "")
    .replace(/\s*\(영업부\)$/g, "")
    .replace(/\s*\(영업\)$/g, "")
    // 영문 회사 형태
    .replace(/\s*Co\.\s*,?\s*Ltd\.?$/gi, "")
    .replace(/\s*Corp\.?$/gi, "")
    .replace(/\s*Corporation$/gi, "")
    .replace(/\s*Inc\.?$/gi, "")
    .trim();
}

// 제약사명 fingerprint key — 매출 합산/매칭 비교용.
// "(주)셀트리온제약", "셀트리온제약 (주)", "셀트리온제약(본사)", "셀트리온제약(파트너스)"
// 모두 같은 키 "셀트리온제약" 으로 묶임.
//
// 작동:
// 1) normalizeCompanyName 으로 부수 표기 제거
// 2) 남은 모든 공백/괄호/구두점 제거
// 3) 소문자화
export function companyNameKey(name: string): string {
  if (!name) return "";
  return normalizeCompanyName(name)
    .replace(/[\s.,()/\-_·]/g, "")
    .toLowerCase();
}

// 제약사명 prefix 키 — 접미어 ("제약", "약품") 제거 후 핵심부만 추출.
// 후보 제안 전용 — 자동매칭에는 절대 사용하지 말 것 (동광 ≠ 동광제약 가능성).
//
// 예시:
// - "동광"     → prefix: "동광"
// - "동광제약" → prefix: "동광"
// - "동광약품" → prefix: "동광"
// → "동광"으로 검색하면 3개 후보가 모두 매칭되어 사용자가 선택
const TRAILING_SUFFIXES = ["제약", "약품"];
export function companyNamePrefixKey(name: string): string {
  let key = companyNameKey(name);
  for (const suffix of TRAILING_SUFFIXES) {
    if (key.endsWith(suffix) && key.length > suffix.length + 1) {
      key = key.slice(0, -suffix.length);
    }
  }
  return key;
}
