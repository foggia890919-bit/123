import { prisma } from "./prisma";

export type MasterRow = {
  id: string;
  insuranceCode: string | null;
  productName: string;
  companyName: string;
  price: number | null;
  commissionRate: number | null;
};

// LLM/Gemini 추출 결과의 한 행. 어댑터가 RxDrugRow → 이 형태로 변환 후 matchMedication 호출.
export interface MergedDrug {
  insuranceCode: string;
  productName: string;
  companyName: string;
  quantity: string;
  confidence: number;
  priceHint?: number;
}

export async function fetchMasterByCodes(codes: string[]): Promise<Map<string, MasterRow>> {
  const map = new Map<string, MasterRow>();
  if (codes.length === 0) return map;
  const rows = await prisma.medication.findMany({
    where: { insuranceCode: { in: codes } },
    select: { id: true, insuranceCode: true, productName: true, companyName: true, price: true, commissionRate: true },
  });
  for (const r of rows) {
    if (r.insuranceCode) map.set(r.insuranceCode, r);
  }
  return map;
}

// 제품명(한글 prefix) 으로 마스터 일괄 조회. 보험코드 매칭 실패한 행을 제품명으로 backfill.
// 한 호출에 다수 prefix 를 OR 로 처리 — N+1 DB hit 회피.
// 응답 Map 키: 정규화된 한글 prefix (parseDrugName.korean 의 처음 4글자, 소문자/공백제거).
export async function fetchMasterByNamePrefixes(names: string[]): Promise<Map<string, MasterRow[]>> {
  const map = new Map<string, MasterRow[]>();
  if (names.length === 0) return map;

  // 한 약품명 → 한글 prefix 추출 → 모든 prefix 모음
  const prefixSet = new Set<string>();
  for (const n of names) {
    const k = parseDrugName(n).korean;
    if (k.length >= 2) prefixSet.add(k.slice(0, 4));   // 첫 4글자 prefix
  }
  if (prefixSet.size === 0) return map;

  // prisma OR — startsWith 다수
  const rows = await prisma.medication.findMany({
    where: {
      OR: Array.from(prefixSet).map((p) => ({
        productName: { startsWith: p, mode: "insensitive" as const },
      })),
    },
    select: { id: true, insuranceCode: true, productName: true, companyName: true, price: true, commissionRate: true },
    take: 500,   // 안전 limit
  });

  // 각 row 의 한글 prefix 로 grouping
  for (const r of rows) {
    const k = parseDrugName(r.productName).korean.slice(0, 4).toLowerCase();
    if (!k) continue;
    const arr = map.get(k) ?? [];
    arr.push(r);
    map.set(k, arr);
  }
  return map;
}

// 한 약품 행에 대해 마스터에서 제품명 + dose 매칭. 보험코드 매칭 실패 시 폴백.
// 후보 중 dose (10/10, 20mg 등) 일치 우선, 없으면 첫 candidate.
function findByNameAndDose(
  productName: string,
  byNamePrefix: Map<string, MasterRow[]>,
): MasterRow | null {
  const parsed = parseDrugName(productName);
  if (parsed.korean.length < 2) return null;
  const key = parsed.korean.slice(0, 4).toLowerCase();
  const candidates = byNamePrefix.get(key);
  if (!candidates || candidates.length === 0) return null;

  // dose 일치 우선
  if (parsed.dose) {
    const doseNorm = normalizeForDose(parsed.dose);
    const withDose = candidates.find((r) => normalizeForDose(r.productName).includes(doseNorm));
    if (withDose) return withDose;
  }
  // dose 없거나 안 맞으면 첫 후보 (prefix 일치만)
  return candidates[0];
}

// 검증 결과 별도 레이어 — MatchResult fat 화 방지 (Architect 권장).
// source: 어디서 온 검증 신호인가. master = 마스터DB 매칭 시점, gemini-self = Gemini 텍스트 자가검증.
// mismatchFields: OCR 값과 검증값이 어긋난 필드. UI 가 어느 셀을 강조할지 결정.
// suggestion: 검증자가 제안하는 정답(부분/전체). 검수자가 채택 결정.
export interface ValidationResult {
  source: "master" | "gemini-self";
  mismatchFields: ("productName" | "insuranceCode" | "unitPrice")[];
  suggestion: {
    productName?: string;
    insuranceCode?: string;
    unitPrice?: number;
  };
}

export interface MatchResult {
  insuranceCode: string;
  productName: string;
  companyName: string;
  unitPrice: number | null;
  commissionRate: number | null;
  matchedMedicationId: string | null;
  matchConfidence: number;
  nameCodeMismatch: { masterProductName: string; ocrProductName: string } | null;
  // Case B (보험코드 매칭 + 이름 불일치) 에서 마스터 이름으로 자동 교체된 경우 true.
  // 검수 UI 가 originalProductName 을 호버 툴팁으로 노출.
  originalProductName: string;
  nameAutoReplaced: boolean;
  // Gemini 자가검증 결과 (별도 단계에서 채움). matchMedication 본체는 건드리지 않음.
  validation?: ValidationResult;
}

// 보험코드 9자리로 마스터 매칭 + 한글 첫 3자 sanity check.
// 정확 매칭 시 단가/수수료/companyName 마스터값 채워줌. 보험코드 매칭 실패 시
// byNamePrefix 가 주어지면 제품명 prefix + dose 매칭으로 폴백 (사용자 요구).
export function matchMedication(
  item: MergedDrug,
  masterByCode: Map<string, MasterRow>,
  byNamePrefix?: Map<string, MasterRow[]>,
): MatchResult {
  const code = item.insuranceCode.replace(/\D/g, "");

  // ── 1단계: 보험코드 9자리 정확 매칭 ──
  if (code.length === 9 && masterByCode.has(code)) {
    const m = masterByCode.get(code)!;
    const ocrKorean = parseDrugName(item.productName).korean;
    const masterKorean = parseDrugName(m.productName).korean;
    let nameSimilar = ocrKorean.length < 2 || masterKorean.length < 2;
    if (!nameSimilar) {
      const limit = Math.min(3, ocrKorean.length, masterKorean.length);
      for (let i = 0; i < limit; i++) {
        if (ocrKorean[i] === masterKorean[i]) { nameSimilar = true; break; }
      }
    }
    if (nameSimilar) {
      return {
        insuranceCode: code,
        productName: item.productName || m.productName,
        companyName: item.companyName || m.companyName,
        unitPrice: m.price,
        commissionRate: m.commissionRate,
        matchedMedicationId: m.id,
        matchConfidence: 100,
        nameCodeMismatch: null,
        originalProductName: item.productName,
        nameAutoReplaced: false,
      };
    }
    // Case B — 보험코드 9자리 정확 매칭 + 이름 sanity check 실패.
    // 사용자 요구: 코드를 신뢰하고 마스터 이름으로 자동 교체. 원본은 originalProductName 에 보존.
    return {
      insuranceCode: code,
      productName: m.productName,
      companyName: item.companyName || m.companyName,
      unitPrice: m.price,
      commissionRate: m.commissionRate,
      matchedMedicationId: m.id,
      matchConfidence: 95,
      nameCodeMismatch: { masterProductName: m.productName, ocrProductName: item.productName },
      originalProductName: item.productName,
      nameAutoReplaced: true,
    };
  }

  // ── 2단계: 보험코드 매칭 실패 → 제품명 prefix + dose 매칭 폴백 ──
  // Gemini 가 보험코드를 잘못 읽었거나 마스터에 9자리가 다른 약품을 제품명으로 backfill.
  if (byNamePrefix && item.productName) {
    const found = findByNameAndDose(item.productName, byNamePrefix);
    if (found) {
      return {
        insuranceCode: found.insuranceCode ?? item.insuranceCode,
        productName: item.productName || found.productName,
        companyName: item.companyName || found.companyName,
        unitPrice: found.price,
        commissionRate: found.commissionRate,
        matchedMedicationId: found.id,
        matchConfidence: 70,        // 제품명 매칭은 코드 매칭(100) 보다 신뢰도 낮음
        nameCodeMismatch: null,
        originalProductName: item.productName,
        nameAutoReplaced: false,
      };
    }
  }

  // ── 3단계: 모두 실패 — LLM 결과 그대로 반환 (검수에서 사용자가 채움) ──
  return {
    insuranceCode: item.insuranceCode,
    productName: item.productName,
    companyName: item.companyName,
    unitPrice: null,
    commissionRate: null,
    matchedMedicationId: null,
    matchConfidence: 0,
    nameCodeMismatch: null,
    originalProductName: item.productName,
    nameAutoReplaced: false,
  };
}

// "로수듀오정(rosuva/ezt10/20)HLB제약" 같은 약품명에서 한글 약품명과 용량 분리.
export function parseDrugName(s: string): { korean: string; dose: string } {
  if (!s) return { korean: "", dose: "" };
  const withSuffix = s.match(/([가-힣][가-힣\s]*(?:정|캡슐|캅셀|시럽|주사액|주사|연고|크림|겔|패취|포|산제|환제|액|주|에스|서방정|장용정))/);
  const fallback = !withSuffix ? s.match(/([가-힣][가-힣\s]+)/) : null;
  const korean = (withSuffix?.[1] ?? fallback?.[1] ?? "").replace(/\s+/g, "").trim();
  let doseSearchFrom = 0;
  if (withSuffix?.[1]) {
    const idx = s.indexOf(withSuffix[1]);
    if (idx >= 0) doseSearchFrom = idx + withSuffix[1].length;
  }
  const tail = s.slice(doseSearchFrom);
  const doseMatch = tail.match(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/)
    ?? s.match(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/);
  const dose = doseMatch?.[1]?.replace(/\s+/g, "") ?? "";
  return { korean, dose };
}

export function normalizeForDose(s: string): string {
  return s.toLowerCase()
    .replace(/\s+/g, "")
    .replace(/밀리그램|밀리그람/g, "mg")
    .replace(/마이크로그램|마이크로그람/g, "ug");
}
