// 신구 enum 값을 모두 포함하는 superset (Phase 5 완료까지 union 유지)
export type UserRole =
  | "ADMIN" | "BIZ"
  | "SALES" | "GENERAL" | "HOSPITAL" | "PHARMACY"      // 신규
  | "BUSINESS" | "BASIC" | "DOCTOR" | "PHARMACIST";    // legacy (Phase 8에서 제거)

// 레거시 → 신규 매핑 (BACKFILL과 동일)
export const LEGACY_TO_NEW: Record<string, UserRole> = {
  BUSINESS: "SALES",
  BASIC: "GENERAL",
  DOCTOR: "HOSPITAL",
  PHARMACIST: "PHARMACY",
};

// 입력 role을 신규 값으로 정규화. 신규면 그대로, 레거시면 변환.
export function normalizeRole(role: string | null | undefined): UserRole {
  if (!role) return "GENERAL";
  return (LEGACY_TO_NEW[role] ?? role) as UserRole;
}

const HIERARCHY: Record<UserRole, number> = {
  // 일반 사용자 등급 (메뉴 접근 권한 없음)
  GENERAL: 0, BASIC: 0,
  HOSPITAL: 0, DOCTOR: 0,
  PHARMACY: 0, PHARMACIST: 0,
  // 영업 (CSO 기본)
  SALES: 1, BUSINESS: 1,
  // 비즈 관리자 (회원관리에서 부여)
  BIZ: 2,
  // 최상위
  ADMIN: 99,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  GENERAL: "일반", BASIC: "일반",
  HOSPITAL: "병의원", DOCTOR: "병의원",
  PHARMACY: "약국", PHARMACIST: "약국",
  SALES: "CSO(영업)", BUSINESS: "CSO(영업)",
  BIZ: "비즈관리자",
  ADMIN: "관리자",
};

export const ROLE_COLORS: Record<UserRole, string> = {
  GENERAL: "bg-gray-100 text-gray-600",
  BASIC: "bg-gray-100 text-gray-600",
  HOSPITAL: "bg-green-100 text-green-700",
  DOCTOR: "bg-green-100 text-green-700",
  PHARMACY: "bg-teal-100 text-teal-700",
  PHARMACIST: "bg-teal-100 text-teal-700",
  SALES: "bg-blue-100 text-blue-700",
  BUSINESS: "bg-blue-100 text-blue-700",
  BIZ: "bg-purple-100 text-purple-700",
  ADMIN: "bg-red-100 text-red-700",
};

export function hasRole(userRole: string | undefined, required: UserRole): boolean {
  if (!userRole) return false;
  const u = normalizeRole(userRole);
  const r = normalizeRole(required);
  if (u === "ADMIN") return true;
  return (HIERARCHY[u] ?? -1) >= HIERARCHY[r];
}

// 카테고리 판정 헬퍼 — 신구 모두 인식
export function isAdmin(role: string | undefined): boolean { return normalizeRole(role) === "ADMIN"; }
export function isBiz(role: string | undefined): boolean { const r = normalizeRole(role); return r === "BIZ" || r === "ADMIN"; }
export function isSales(role: string | undefined): boolean { return normalizeRole(role) === "SALES"; }
export function isHospital(role: string | undefined): boolean { return normalizeRole(role) === "HOSPITAL"; }
export function isPharmacy(role: string | undefined): boolean { return normalizeRole(role) === "PHARMACY"; }
export function isGeneral(role: string | undefined): boolean { return normalizeRole(role) === "GENERAL"; }
// CSO 분류 = SALES/BIZ/ADMIN (CSO 가입자에서 권한 분기)
export function isCsoCategory(role: string | undefined): boolean {
  const r = normalizeRole(role);
  return r === "SALES" || r === "BIZ" || r === "ADMIN";
}

// 전체 메뉴 접근 가능 — CSO 분류(SALES/BIZ/ADMIN)만.
// 의사/약사/일반은 통합검색만 보임. 관리자가 SALES/BIZ로 승격해야 전체 메뉴 보임.
export function canAccessFullMenu(role: string | undefined): boolean {
  return isCsoCategory(role);
}

// 통합검색만 보이는 분류 — HOSPITAL/PHARMACY/GENERAL.
export function isSearchOnly(role: string | undefined): boolean {
  const r = normalizeRole(role);
  return r === "HOSPITAL" || r === "PHARMACY" || r === "GENERAL";
}

// 가입 시 직업 분류 (사용자에게 노출되는 4가지)
export type Occupation = "HOSPITAL" | "PHARMACY" | "CSO" | "GENERAL";

// 분류 선택 → 기본 부여 role
export function occupationToDefaultRole(occ: Occupation): UserRole {
  switch (occ) {
    case "HOSPITAL": return "HOSPITAL";
    case "PHARMACY": return "PHARMACY";
    case "CSO":      return "SALES";   // CSO 기본은 SALES, BIZ/ADMIN은 관리자가 부여
    case "GENERAL":  return "GENERAL";
  }
}

// role → 직업 분류 역매핑 (관리자 화면 그룹핑용)
export function roleToOccupation(role: string | undefined): Occupation {
  const r = normalizeRole(role);
  if (r === "HOSPITAL") return "HOSPITAL";
  if (r === "PHARMACY") return "PHARMACY";
  if (r === "SALES" || r === "BIZ" || r === "ADMIN") return "CSO";
  return "GENERAL";
}

// 기능별 최소 역할
export const FEATURE_ROLES = {
  search: "GENERAL",          // 통합검색 (수수료 숨김)
  commission: "SALES",  // 수수료율 표시
  settlement: "SALES",  // 정산제약사 검색
  download: "SALES",    // 리스트 다운
  proposals: "SALES",   // 제안서 (기본)
  filter: "BIZ",            // 제약사 필터링
  filterRequest: "BIZ",     // 필터링 요청
  clientReg: "BIZ",         // 거래처 등록
  stats: "BIZ",             // 처방통계
} as const satisfies Record<string, UserRole>;
