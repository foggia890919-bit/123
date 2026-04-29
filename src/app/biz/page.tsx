"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import {
  Hospital, Building2, FileUp, FileSearch,
  ChevronRight, LayoutDashboard, ClipboardList,
  Users, BarChart3, PercentCircle, GitMerge, Pill, UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BIZ_MENU_GROUPS = [
  {
    label: "거래처/유저 관리",
    items: [
      {
        href: "/biz/clients",
        label: "병·의원 등록/관리",
        desc: "거래처 병의원 등록 및 승인 관리",
        icon: Hospital,
        color: "bg-blue-50 text-blue-600",
      },
      {
        href: "/biz/dealers",
        label: "법인·딜러 등록/관리",
        desc: "법인 및 딜러 계층 분류 관리",
        icon: Building2,
        color: "bg-purple-50 text-purple-600",
      },
      {
        href: "/biz/sales-reps",
        label: "영업사원 관리",
        desc: "영업사원 승인 및 코드 관리",
        icon: UserCheck,
        color: "bg-indigo-50 text-indigo-600",
      },
    ],
  },
  {
    label: "정산 관리",
    items: [
      {
        href: "/biz/settlement/upload",
        label: "정산내역서 업로드",
        desc: "법인별 정산 엑셀 파일 업로드",
        icon: FileUp,
        color: "bg-green-50 text-green-600",
      },
      {
        href: "/biz/settlement/review",
        label: "정산내역서 검수",
        desc: "업로드된 정산내역 확인 및 취합",
        icon: FileSearch,
        color: "bg-orange-50 text-orange-600",
      },
      {
        href: "/biz/corp-rates",
        label: "추가수수료 매핑",
        desc: "법인별·제약사별 추가수수료율 관리",
        icon: PercentCircle,
        color: "bg-yellow-50 text-yellow-600",
      },
    ],
  },
  {
    label: "제약사/제품 관리",
    items: [
      {
        href: "/biz/submission-routes",
        label: "통계제출처 관리",
        desc: "병의원×제약사 통계제출 경로 관리",
        icon: BarChart3,
        color: "bg-cyan-50 text-cyan-600",
      },
      {
        href: "/biz/co-promotion",
        label: "코프로모션 예외 관리",
        desc: "통계제약사와 정산제약사가 다른 품목 관리",
        icon: Pill,
        color: "bg-rose-50 text-rose-600",
      },
    ],
  },
  {
    label: "필터링 관리",
    items: [
      {
        href: "/biz/filter-status",
        label: "필터링 관리",
        desc: "현황·플로우·매핑 통합 관리",
        icon: ClipboardList,
        color: "bg-teal-50 text-teal-600",
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
