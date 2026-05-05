"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import {
  Building2, FileUp, FileSearch,
  ChevronRight, LayoutDashboard, ClipboardList,
  BarChart3, PercentCircle, Pill,
  Calculator, Network, Users, PackageSearch, Mail, Package, KeyRound, ShoppingCart,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BIZ_MENU_GROUPS = [
  {
    label: "유저 관리",
    items: [
      {
        href: "/biz/users",
        label: "유저 관리",
        desc: "병·의원·법인·영업사원 등록·승인·코드 생성",
        icon: Users,
        color: "bg-blue-50 text-blue-600",
      },
    ],
  },
  {
    label: "통계제출처 관리",
    items: [
      {
        href: "/biz/submission-routes",
        label: "통계 제출처 관리",
        desc: "거래처×제약사 제출처 매핑·신규/이관 분류·월별 제출체크·ZIP 다운",
        icon: BarChart3,
        color: "bg-cyan-50 text-cyan-600",
      },
      {
        href: "/biz/submission-package",
        label: "제출 패키지 다운로드",
        desc: "월별 통계를 (제출처×제약사) 단위 Excel + 이미지 ZIP 으로 일괄 다운로드",
        icon: Package,
        color: "bg-cyan-50 text-cyan-700",
      },
    ],
  },
  {
    label: "요율 관리",
    items: [
      {
        href: "/biz/rates",
        label: "요율 업데이트",
        desc: "법인 단위 제약사별 요율 매핑 (관리자 통합 요율 위에 비즈 오버라이드)",
        icon: Calculator,
        color: "bg-emerald-50 text-emerald-600",
      },
      {
        href: "/biz/co-promotion",
        label: "코프로모션 예외 관리",
        desc: "통계제약사 ≠ 정산제약사인 품목 매핑 (예: 다산제약 오마코 → 제일약품 정산)",
        icon: Pill,
        color: "bg-rose-50 text-rose-600",
      },
    ],
  },
  {
    label: "정산 관리",
    items: [
      {
        href: "/biz/settlement/upload",
        label: "정산내역서 업로드",
        desc: "법인별 정산 엑셀 드롭다운 업로드 + 컬럼매핑 미리보기",
        icon: FileUp,
        color: "bg-green-50 text-green-600",
      },
      {
        href: "/biz/settlement/review",
        label: "정산내역서 검수",
        desc: "업로드 이력·기간 필터·상태 추적·삭제",
        icon: FileSearch,
        color: "bg-orange-50 text-orange-600",
      },
    ],
  },
  {
    label: "필터링 관리",
    items: [
      {
        href: "/biz/filter-status",
        label: "필터링 현황·플로우",
        desc: "필터링 요청 현황 + 카톡 발송→응답 플로우 추적",
        icon: ClipboardList,
        color: "bg-teal-50 text-teal-600",
      },
      {
        href: "/biz/filter-mapping",
        label: "제약사→상위법인 매핑",
        desc: "제약사 필터링 요청 시 상위법인 담당자 매핑 (세로형 엑셀)",
        icon: Network,
        color: "bg-sky-50 text-sky-600",
      },
      {
        href: "/biz/corp-rates",
        label: "법인×제약사 추가수수료",
        desc: "필터링 결과별 추가수수료율 매핑",
        icon: PercentCircle,
        color: "bg-yellow-50 text-yellow-600",
      },
    ],
  },
  {
    label: "운영 모니터링",
    items: [
      {
        href: "/biz/team-status",
        label: "팀 상태 대시보드",
        desc: "8개 에이전트 작업 현황 + 작업 예상 마감 카운트다운",
        icon: Users,
        color: "bg-violet-50 text-violet-600",
      },
      {
        href: "/biz/inventory-status",
        label: "재고 크롤러 현황",
        desc: "ScrapeJob 이력·사이트별 성공률·최신 갱신 시각·지금 재시도",
        icon: PackageSearch,
        color: "bg-emerald-50 text-emerald-600",
      },
      {
        href: "/biz/email-inbox",
        label: "메일 자동 수신함",
        desc: "지메일 자동 수신 + 발신자 매핑 + 첨부 자동 분류·등록",
        icon: Mail,
        color: "bg-pink-50 text-pink-600",
      },
      {
        href: "/biz/epharms-accounts",
        label: "ePharms 상품 자동수집",
        desc: "거래처별 yk.ep45.co.kr 계정 등록 → 매일 자정 자동 sync → 영업사원 포털에 표시",
        icon: KeyRound,
        color: "bg-amber-50 text-amber-600",
      },
      {
        href: "/biz/products",
        label: "이팜스 상품 마스터",
        desc: "자동주문용 상품 카탈로그. 워커 자동 동기화 또는 엑셀 직접 업로드",
        icon: PackageSearch,
        color: "bg-blue-50 text-blue-600",
      },
      {
        href: "/biz/inhouse-orders",
        label: "원내거래 주문관리",
        desc: "영업사원이 요청한 원내거래 주문 확인·처리 (PENDING → CONFIRMED → ORDERED)",
        icon: ShoppingCart,
        color: "bg-amber-50 text-amber-600",
      },
    ],
  },
];

// 대시보드 카드용 평탄화
const BIZ_MENU_FLAT = BIZ_MENU_GROUPS.flatMap((g) => g.items);

export function BizLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") router.push("/");
  }, [session, status, router]);

  if (status === "loading") return null;

  const isDashboard = pathname === "/biz";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        {/* 사이드 메뉴 */}
        <aside className="hidden md:flex flex-col w-56 shrink-0 gap-1">
          <Link
            href="/biz"
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold mb-2",
              isDashboard ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-200"
            )}
          >
            <LayoutDashboard className="w-4 h-4" />
            비즈 관리
          </Link>

          {BIZ_MENU_GROUPS.map((group) => (
            <div key={group.label} className="mb-1">
              <p className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                {group.label}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                      active
                        ? "bg-white border border-gray-200 text-gray-900 shadow-sm"
                        : "text-gray-600 hover:bg-white hover:text-gray-900"
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </aside>

        {/* 메인 콘텐츠 */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

export default function BizDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") router.push("/");
  }, [session, status, router]);

  if (status === "loading") return null;

  return (
    <BizLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">비즈 관리 대시보드</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {session?.user.name}님의 비즈 관리 페이지입니다
          </p>
        </div>

        {BIZ_MENU_GROUPS.map((group) => (
          <div key={group.label}>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {group.label}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md hover:border-gray-300 transition-all group"
                  >
                    <div className="flex items-start justify-between">
                      <div className={cn("p-3 rounded-xl", item.color)}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-gray-500 transition-colors mt-1" />
                    </div>
                    <div className="mt-4">
                      <p className="text-base font-semibold text-gray-900">{item.label}</p>
                      <p className="text-sm text-gray-500 mt-1">{item.desc}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </BizLayout>
  );
}
