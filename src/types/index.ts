export type Role = "ADMIN" | "SALES_REP" | "DOCTOR" | "PHARMACIST";

export interface MedicationItem {
  id: string;
  categoryA: string | null;
  ingredientName: string;
  categoryB: string | null;
  commissionRate: number | null;
  companyName: string;
  bioStatus: string | null;
  productName: string;
  price: number | null;
  originalDrug: string | null;
  insuranceCode: string | null;
  notes: string | null;
  isSettlement: boolean;
  source: "EXCEL" | "PUBLIC_API";
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
