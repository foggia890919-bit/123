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

export interface MatchResult {
  insuranceCode: string;
  productName: string;
  companyName: string;
  unitPrice: number | null;
  commissionRate: number | null;
  matchedMedicationId: string | null;
  matchConfidence: number;
  nameCodeMismatch: { masterProductName: string; ocrProductName: string } | null;
}

// 보험코드 9자리로 마스터 매칭 + 한글 첫 2자 sanity check.
// 정확 매칭 시 단가/수수료/companyName 마스터값 채워줌. 매칭 실패 시 LLM 결과 그대로 반환.
export function matchMedication(
  item: MergedDrug,
  masterByCode: Map<string, MasterRow>,
): MatchResult {
  const code = item.insuranceCode.replace(/\D/g, "");
  if (code.length === 9 && masterByCode.has(code)) {
    const m = masterByCode.get(code)!;
    const ocrKorean = parseDrugName(item.productName).korean;
    const masterKorean = parseDrugName(m.productName).korean;
    let nameSimilar = ocrKorean.length < 2 || masterKorean.length < 2;
    if (!nameSimilar) {
      const limit = Math.min(2, ocrKorean.length, masterKorean.length);
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
      };
    }
    return {
      insuranceCode: code,
      productName: item.productName,
      companyName: item.companyName,
      unitPrice: m.price,
      commissionRate: m.commissionRate,
      matchedMedicationId: m.id,
      matchConfidence: 80,
      nameCodeMismatch: { masterProductName: m.productName, ocrProductName: item.productName },
    };
  }

  return {
    insuranceCode: item.insuranceCode,
    productName: item.productName,
    companyName: item.companyName,
    unitPrice: null,
    commissionRate: null,
    matchedMedicationId: null,
    matchConfidence: 0,
    nameCodeMismatch: null,
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
