export type Role = "ADMIN" | "SALES_REP" | "DOCTOR" | "PHARMACIST";

/**
 * HIRA 주성분코드 정밀 매칭 레벨
 *  exact           — 9자리 완전일치 (동일 성분/제형/단위/용량)
 *  same_form       — 8자리 prefix 일치 (동일 성분/제형/단위, 용량만 다름)
 *  same_ingredient — 6자리 prefix 일치 (동일 성분, 제형/용량 다름)
 */
export type IngredientMatchLevel = "exact" | "same_form" | "same_ingredient";

export interface MedicationItem {
  id: string;
  categoryA: string | null;
  ingredientName: string;
  categoryB: string | null;      // 식약분류 (엑셀 분류B)
  ingredientCode: string | null; // HIRA 주성분코드 (ATC 매핑)
  commissionRate: number | null;
  companyName: string;
  bioStatus: string | null;
  productName: string;
  price: number | null;
  originalDrug: string | null;
  insuranceCode: string | null;
  notes: string | null;
  stock?: number | null;
  isSettlement: boolean;
  settlementType?: string | null;
  source: "EXCEL" | "PUBLIC_API";
  additionalRate?: number | null;
  /** ingredientCode 검색 시에만 포함 — 주성분코드 prefix 기반 매칭 수준 */
  matchLevel?: IngredientMatchLevel;
}

export interface ProposalCartItem {
  id: string;
  originalMedication?: MedicationItem;
  altMedication?: MedicationItem;
  quantity: number;
  note?: string;
  order: number;
}

export interface SearchResult {
  medications: MedicationItem[];
  total: number;
}
