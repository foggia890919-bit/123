export type UserRole = "BASIC" | "SALES_REP" | "BIZ" | "ADMIN" | "DOCTOR" | "PHARMACIST";

const HIERARCHY: Record<UserRole, number> = {
  BASIC: 0,
  DOCTOR: 0,
  PHARMACIST: 0,
  SALES_REP: 1,
  BIZ: 2,
  ADMIN: 99,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  BASIC: "일반회원",
  SALES_REP: "영맨회원",
  BIZ: "비즈회원",
  ADMIN: "관리자",
  DOCTOR: "의사",
  PHARMACIST: "약사",
};

export const ROLE_COLORS: Record<UserRole, string> = {
  BASIC: "bg-gray-100 text-gray-600",
  SALES_REP: "bg-blue-100 text-blue-700",
  BIZ: "bg-purple-100 text-purple-700",
  ADMIN: "bg-red-100 text-red-700",
  DOCTOR: "bg-green-100 text-green-700",
  PHARMACIST: "bg-teal-100 text-teal-700",
};

export function hasRole(userRole: string | undefined, required: UserRole): boolean {
  if (!userRole) return false;
  if (userRole === "ADMIN") return true;
  return (HIERARCHY[userRole as UserRole] ?? -1) >= HIERARCHY[required];
}

// 기능별 최소 역할
export const FEATURE_ROLES = {
  search: "BASIC",          // 통합검색 (수수료 숨김)
  commission: "SALES_REP",  // 수수료율 표시
  settlement: "SALES_REP",  // 정산제약사 검색
  download: "SALES_REP",    // 리스트 다운
  proposals: "SALES_REP",   // 제안서 (기본)
  filter: "BIZ",            // 제약사 필터링
  filterRequest: "BIZ",     // 필터링 요청
  clientReg: "BIZ",         // 거래처 등록
  stats: "BIZ",             // 처방통계
} as const satisfies Record<string, UserRole>;
