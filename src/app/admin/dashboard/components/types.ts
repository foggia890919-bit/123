export type Tab = "upload" | "members" | "rates" | "filterReqs" | "userClients" | "bizManagement" | "corpRelation" | "apiSources" | "notices" | "companySubmissions" | "bulkSubmit" | "submissionTree" | "loginLogs" | "fileMigration" | "banners" | "boards";

export interface MenuItem { key: Tab; label: string; icon: React.ElementType }
export interface MenuGroup { title: string; items: MenuItem[] }

export interface UserDoc { id: string; docType: string; fileName: string; fileData?: string; }
export interface User {
  id: string; email: string; name: string | null;
  role: string; approved: boolean; isBusinessApproved?: boolean; createdAt: string;
  phone?: string | null; carrier?: string | null;
  documents?: UserDoc[];
  userClients?: { id: string; clientName: string; bizNumber: string; address: string | null; bizFileName: string | null; bizFileKey: string | null }[];
}

export interface CompanySubmission {
  companyName: string;
  submissionEntity: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  defaultAdditionalRate: number | null;
  notes: string | null;
}

export interface SubmissionEntity {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  notes: string | null;
}

export interface FilterReq {
  id: string; userName: string; clientName: string; bizNumber: string;
  companyName: string; status: string; createdAt: string;
  replyText: string | null; repliedAt: string | null;
  user: { name: string | null; email: string };
}

export interface RateRow { companyName: string; additionalRate: number }

export interface SubUploadRow {
  companyName: string;
  submissionEntity: string;
  contactName: string;
  email: string;
  phone: string;
  fax: string;
  defaultAdditionalRate: string;
  notes: string;
  _error?: string;
}

export interface AdminUserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  bizDocument: string | null;
  bizFileName: string | null;
  hasBizDocument?: boolean;
  approved: boolean;
  createdAt: string;
  userId: string;
  dealerType?: string | null;
  user: { name: string | null; email: string; phone?: string | null };
}

export type BizSubTab = "all" | "hospital" | "upper-corp" | "lower-corp";

export interface EditValues {
  clientName: string;
  bizNumber: string;
  dealerType: string | null;
  approved: boolean;
}

export interface Notice { id: string; title: string; content: string; category: string; isPinned: boolean; showAsPopup: boolean; popupUntil: string | null; createdAt: string; }

export interface LoginLogEntry {
  id: string;
  email: string;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { name: string | null; role: string; phone: string | null; email: string } | null;
}

export interface MigrationStatus {
  storageEnabled: boolean;
  remaining: { userDocuments: number; userClients: number; filterRequests: number; prescriptionReports: number };
  totalRemaining: number;
}

export interface Banner {
  id: string; title: string; subtitle: string | null; description: string | null;
  buttonText: string | null; buttonLink: string | null; imageKey: string | null;
  imageUrl: string | null; bgColor: string | null; order: number; active: boolean;
}

export interface BoardRow {
  id: string; slug: string; name: string; description: string | null;
  type: "TEXT" | "IMAGE" | "MIXED"; order: number; active: boolean;
  _count: { posts: number; editors: number };
}
export interface EditorRow { id: string; userId: string; user: { id: string; name: string | null; email: string; role: string } }
export interface UserOption { id: string; name: string | null; email: string; role: string }

export interface CorpRow {
  id: string | null;
  userId: string;
  clientName: string | null;
  bizNumber: string | null;
  dealerType: string | null;
  parentCorpId: string | null;
  approved: boolean | null;
  createdAt: string;
  user: { name: string | null; email: string; phone?: string | null };
  isUserOnly: boolean;
  extraBizCount?: number;
}

export interface PreviewResult {
  format?: string;
  totalCount?: number;
  columns?: string[];
  sample?: Record<string, unknown>[];
  error?: string;
  raw?: string;
}

export interface TreeUser { id: string; name: string | null; email: string; isBusinessApproved?: boolean | null }
export interface TreeRoute { id: string; clientName: string; companyName: string; submissionEntity: string; active: boolean }
export interface TreeChild { owner: TreeUser; routes: TreeRoute[] }
export interface TreeParent { parent: TreeUser; childCount: number; routeCount: number; children: TreeChild[] }
export interface TreeResponse {
  parents: TreeParent[];
  unlinked: { owners: TreeChild[]; routeCount: number };
  totals: { parentCount: number; routeCount: number; unlinkedRouteCount: number };
}

export type EditSub = CompanySubmission & { isNew?: boolean };

// 신구 enum 값 모두 라벨/색상 매핑 (Phase 5 완료까지 superset 유지)
export const roleLabel: Record<string, string> = {
  ADMIN: "관리자", BIZ: "비즈관리자",
  SALES: "CSO(영업)", BUSINESS: "CSO(영업)",
  HOSPITAL: "병의원", DOCTOR: "병의원",
  PHARMACY: "약국", PHARMACIST: "약국",
  GENERAL: "일반", BASIC: "일반",
};
export const roleColor: Record<string, string> = {
  ADMIN: "bg-red-100 text-red-700",
  BIZ: "bg-purple-100 text-purple-700",
  SALES: "bg-blue-100 text-blue-700", BUSINESS: "bg-blue-100 text-blue-700",
  HOSPITAL: "bg-green-100 text-green-700", DOCTOR: "bg-green-100 text-green-700",
  PHARMACY: "bg-teal-100 text-teal-700", PHARMACIST: "bg-teal-100 text-teal-700",
  GENERAL: "bg-gray-100 text-gray-600", BASIC: "bg-gray-100 text-gray-600",
};

export const statusOptions = [
  { value: "PENDING", label: "대기", cls: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  { value: "REVIEWING", label: "확인중", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "REJECTED", label: "거래불가", cls: "bg-red-50 text-red-700 border-red-200" },
  { value: "APPROVED", label: "거래가능", cls: "bg-green-50 text-green-700 border-green-200" },
];

export const emptySubmission = (): Omit<CompanySubmission, "companyName"> & { companyName: string } => ({
  companyName: "", submissionEntity: "", contactName: "", email: "", phone: "", fax: "", defaultAdditionalRate: null, notes: "",
});

export const EXPECTED_COLUMNS: Record<string, keyof SubUploadRow> = {
  "제약사명": "companyName",
  "제출처법인명": "submissionEntity",
  "담당자": "contactName",
  "담당자명": "contactName",
  "이메일": "email",
  "전화번호": "phone",
  "전화": "phone",
  "팩스": "fax",
  "추가수수료": "defaultAdditionalRate",
  "추가수수료율": "defaultAdditionalRate",
  "비고": "notes",
};

export function validateRow(row: SubUploadRow): string | undefined {
  if (!row.companyName) return "제약사명 없음";
  if (row.defaultAdditionalRate && isNaN(Number(row.defaultAdditionalRate))) return `추가수수료 숫자 아님: ${row.defaultAdditionalRate}`;
  return undefined;
}

export const BG_PRESETS = [
  { label: "파랑", value: "from-blue-900 to-blue-700" },
  { label: "남색", value: "from-slate-800 to-blue-900" },
  { label: "보라", value: "from-indigo-900 to-purple-800" },
  { label: "청록", value: "from-blue-800 to-cyan-700" },
  { label: "초록", value: "from-green-800 to-teal-700" },
  { label: "빨강", value: "from-red-900 to-rose-700" },
];

export const BOARD_TYPE_LABELS: Record<string, string> = { TEXT: "글자형", IMAGE: "사진형", MIXED: "글자+사진형" };
