"use client";

import { useSession } from "next-auth/react";
import { Lock, ArrowUpCircle, MessageCircle } from "lucide-react";
import { hasRole, ROLE_LABELS, type UserRole } from "@/lib/roles";

const KAKAO_URL = "https://open.kakao.com/me/ykmedi";

const GRADE_DESC: Record<UserRole, string> = {
  BASIC: "일반회원",
  SALES_REP: "영맨회원 — 통합검색 수수료·정산제약사·리스트다운·제안서",
  BIZ: "비즈회원 — 제약사 필터링·거래처 등록·처방통계",
  ADMIN: "관리자",
  DOCTOR: "의사",
  PHARMACIST: "약사",
};

interface Props {
  minRole: UserRole;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function RequireRole({ minRole, children, fallback }: Props) {
  const { data: session, status } = useSession();
  if (status === "loading") return null;

  const role = session?.user?.role as UserRole | undefined;
  if (!role || !hasRole(role, minRole)) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6 max-w-md mx-auto text-center">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
          <Lock className="w-8 h-8 text-gray-400" />
        </div>

        <div className="space-y-2">
          <p className="text-lg font-bold text-gray-800">접근 권한이 없습니다</p>
          <p className="text-sm text-gray-500">
            이 메뉴는{" "}
            <span className="font-semibold text-gray-700">{ROLE_LABELS[minRole]}</span>{" "}
            이상만 이용할 수 있습니다.
          </p>
        </div>

        <div className="w-full bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-1 text-left">
          <p className="text-xs font-semibold text-blue-700 flex items-center gap-1">
            <ArrowUpCircle className="w-3.5 h-3.5" />
            {ROLE_LABELS[minRole]} 이용 가능 기능
          </p>
          <p className="text-xs text-blue-600">{GRADE_DESC[minRole]}</p>
        </div>

        <div className="w-full space-y-3">
          <p className="text-sm text-gray-500">등급 변경을 원하시면 카카오톡으로 문의해 주세요.</p>
          <a
            href={KAKAO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#FEE500] hover:bg-[#FFCF00] text-[#3C1E1E] font-semibold text-sm transition-colors shadow-sm"
          >
            <MessageCircle className="w-4 h-4" />
            등급 변경 요청하러 가기 (카카오톡)
          </a>
        </div>

        <p className="text-xs text-gray-400">
          현재 등급:{" "}
          <span className="font-medium text-gray-600">{ROLE_LABELS[role ?? "BASIC"]}</span>
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
