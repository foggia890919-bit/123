"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import {
  Hospital, Building2, FileUp, FileSearch,
  ChevronRight, LayoutDashboard, GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BIZ_MENU = [
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
    href: "/biz/filter-mapping",
    label: "필터링 매핑 관리",
    desc: "거래처\xd7제약사별 제출처\xb7담당자 설정",
    icon: GitBranch,
    color: "bg-yellow-50 text-yellow-600",
  },
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
];

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
      {/* 비즈 사이드바 + 콘텐츠 */}
      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        {/* 사이드 메뉴 */}
        <aside className="hidden md:flex flex-col w-56 shrink-0 gap-1">
          <Link
            href="/biz"
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold mb-2",
              isDashboard
                ? "bg-gray-900 text-white"
                : "text-gray-700 hover:bg-gray-200"
            )}
          >
            <LayoutDashboard className="w-4 h-4" />
            비즈 관리
          </Link>
          {BIZ_MENU.map((item) => {
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {BIZ_MENU.map((item) => {
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
    </BizLayout>
  );
}
