// ─── Shared Types for Users Page ─────────────────────────────────────────────

// ClientsTab types
export interface HospClient {
  id: string;
  clientName: string;
  bizNumber: string;
  bizFileName?: string;
  approved: boolean;
  createdAt: string;
  code?: string | null;
}
export interface GlobalClient { clientName: string; bizNumber: string; }
export type ModalStep = "search" | "found" | "new" | "notfound" | "saving";

// DealersTab types
export type DealerType = "CORPORATION" | "INDIVIDUAL" | "UPPER_CORP" | "LOWER_CORP" | "SELF" | null;
export type DealerModalStep = "biz" | "checking" | "found" | "form" | "saving";

export const DEALER_LABELS: Record<string, string> = {
  CORPORATION: "법인", UPPER_CORP: "상위법인", SELF: "자사",
  LOWER_CORP: "하위법인", INDIVIDUAL: "개인사업자(딜러)",
};
export const DEALER_COLORS: Record<string, string> = {
  CORPORATION: "bg-blue-100 text-blue-700", UPPER_CORP: "bg-indigo-100 text-indigo-700",
  SELF: "bg-purple-100 text-purple-700", LOWER_CORP: "bg-cyan-100 text-cyan-700",
  INDIVIDUAL: "bg-green-100 text-green-700",
};
export const TYPE_ORDER = ["CORPORATION", "UPPER_CORP", "SELF", "LOWER_CORP", "INDIVIDUAL"];

export interface DealerClient {
  id: string; clientName: string; bizNumber: string; dealerType: DealerType;
  approved: boolean; managerName?: string | null; managerPhone?: string | null;
  managerEmail?: string | null; memo?: string | null; code?: string | null;
  isSettlementTarget?: boolean | null; isRateTarget?: boolean | null;
  corpClassification?: string | null; partnerGrade?: string | null;
  promotionBaseDate?: string | null;
}

// SalesRepsTab types
export interface SalesRep {
  id: string; name: string | null; email: string; phone: string | null;
  approved: boolean; salesCode: string | null; createdAt: string;
}
export interface BulkRow { name: string; email: string; phone: string; password: string; bizNumbersText: string; }
export interface BulkResult {
  row: number; status: "ok" | "error"; createdNew?: boolean; email?: string; salesCode?: string;
  mappedClients?: number; unmappedBizNumbers?: string[]; error?: string;
}

// InhouseClientsTab types
export interface InhouseKmdUser {
  id: string;
  email: string;
  name: string | null;
  role?: string;
}

export interface InhouseAccount {
  id: string;
  bizNumber: string;
  clientName: string;
  loginId: string;
  active: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  memo: string | null;
  kmdUserId: string | null;
  kmdUser: InhouseKmdUser | null;
  createdAt: string;
  updatedAt: string;
}

export interface InhouseKmdClient {
  bizNumber: string;
  clientName: string;
}

export interface InhouseBulkResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface InhouseBulkPreviewRow {
  bizNumber: string;
  clientName: string;
  loginId: string;
  loginPw: string;
  kmdEmail: string;
  memo: string;
  kmdUserEmail: string;
}

export const INHOUSE_EMPTY = {
  bizNumber: "",
  clientName: "",
  loginId: "",
  loginPw: "",
  memo: "",
  kmdUserId: "" as string,
};

// AllTab types
export interface AllClient {
  id: string; userId: string; clientName: string; bizNumber: string;
  dealerType?: string | null; approved: boolean; createdAt: string;
  user: { name: string | null; email: string; phone?: string | null };
}

// Main page types
export type Tab = "all" | "clients" | "inhouse-clients" | "upper-corp" | "lower-corp" | "sales-reps";
