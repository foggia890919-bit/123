"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { FileText, Building2, Search, LogIn, ShieldCheck, ChevronDown, User, LogOut, Download, Menu, X, Filter, BarChart3, Upload } from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS, type UserRole } from "@/lib/roles";

interface NavLeaf {
  kind: "link";
  href: string;
  label: string;
  icon: React.ElementType;
  minRole: UserRole;
}
interface NavGroup {
  kind: "group";
  label: string;
  icon: React.ElementType;
  minRole: UserRole;
  // 그룹이 활성화되었을 때 매칭시킬 경로들
  matchPrefixes: string[];
  children: { href: string; label: string; icon: React.ElementType }[];
}
type NavItem = NavLeaf | NavGroup;

const navItems: NavItem[] = [
  { kind: "link",  href: "/search",            label: "통합검색",        icon: Search,    minRole: "BASIC"     },
  { kind: "link",  href: "/search/settlement", label: "정산제약사 검색", icon: Building2, minRole: "SALES_REP" },
  { kind: "link",  href: "/filter",            label: "제약사 필터링",   icon: Filter,    minRole: "BIZ"       },
  { kind: "link",  href: "/filter-list",       label: "리스트 다운",     icon: Download,  minRole: "SALES_REP" },
  {
    kind: "group",
    label: "제안서 목록",
    icon: FileText,
    minRole: "SALES_REP",
    matchPrefixes: ["/proposals", "/bulk-register"],
    children: [
      { href: "/proposals",     label: "제안서",       icon: FileText },
      { href: "/bulk-register", label: "제안서(대량)", icon: Upload   },
    ],
  },
  { kind: "link",  href: "/stats",             label: "처방통계",        icon: BarChart3, minRole: "BIZ"       },
];

export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [userOpen, setUserOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) setOpenGroup(null);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => { setMobileOpen(false); setOpenGroup(null); }, [pathname]);

  function isGroupActive(g: NavGroup) {
    return g.matchPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
  }

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm relative z-40">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* 로고 */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="#2563EB"/>
              <text x="16" y="22" textAnchor="middle" fill="white" fontSize="13" fontWeight="800" fontFamily="Arial, sans-serif" letterSpacing="-0.5">KMD</text>
            </svg>
            <span className="font-bold text-gray-900 text-lg tracking-tight">Korea Medicine Data</span>
          </Link>

          {/* 데스크탑 네비 */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              if (item.kind === "link") {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                      pathname === item.href ? "bg-blue-50 text-blue-600" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    )}>
                    <Icon className="w-4 h-4" />{item.label}
                  </Link>
                );
              }
              // group
              const Icon = item.icon;
              const active = isGroupActive(item);
              const isOpen = openGroup === item.label;
              return (
                <div key={item.label} className="relative" ref={isOpen ? groupRef : undefined}>
                  <button
                    onClick={() => setOpenGroup((g) => (g === item.label ? null : item.label))}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                      active ? "bg-blue-50 text-blue-600" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    )}
                  >
                    <Icon className="w-4 h-4" />{item.label}
                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isOpen && "rotate-180")} />
                  </button>
                  {isOpen && (
                    <div className="absolute left-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        const childActive = pathname === child.href;
                        return (
                          <Link key={child.href} href={child.href}
                            onClick={() => setOpenGroup(null)}
                            className={cn(
                              "flex items-center gap-2 px-4 py-2.5 text-sm",
                              childActive ? "bg-blue-50 text-blue-600 font-medium" : "text-gray-700 hover:bg-gray-50"
                            )}>
                            <ChildIcon className="w-4 h-4 shrink-0" />{child.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 우측 버튼 */}
          <div className="flex items-center gap-2">
            {session ? (
              <div className="relative" ref={userRef}>
                <button onClick={() => setUserOpen((p) => !p)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100">
                  <User className="w-4 h-4" />
                  <span className="hidden sm:inline">{session.user.name || "마이페이지"}</span>
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", userOpen && "rotate-180")} />
                </button>
                {userOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-semibold text-gray-800 truncate">{session.user.name || "사용자"}</p>
                      <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[session.user.role as UserRole] ?? "bg-gray-100 text-gray-600"}`}>
                        {ROLE_LABELS[session.user.role as UserRole] ?? session.user.role}
                      </span>
                    </div>
                    <Link href="/mypage" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      <User className="w-4 h-4 text-gray-400" />마이페이지
                    </Link>
                    <div className="border-t border-gray-100">
                      <button onClick={() => { signOut({ callbackUrl: "/" }); setUserOpen(false); }}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 w-full">
                        <LogOut className="w-4 h-4" />로그아웃
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link href="/login"
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100">
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline">로그인</span>
              </Link>
            )}

            <Link href="/admin/login"
              className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-gray-800 hover:bg-gray-700">
              <ShieldCheck className="w-4 h-4" />관리자
            </Link>

            {/* 햄버거 버튼 (모바일) */}
            <button onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden p-2 rounded-md text-gray-600 hover:bg-gray-100">
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* 모바일 메뉴 */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white shadow-lg">
          <div className="px-4 py-2 space-y-0.5">
            {navItems.map((item) => {
              if (item.kind === "link") {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors",
                      pathname === item.href ? "bg-blue-50 text-blue-600" : "text-gray-700 hover:bg-gray-50"
                    )}>
                    <Icon className="w-4 h-4 shrink-0" />{item.label}
                  </Link>
                );
              }
              const Icon = item.icon;
              return (
                <div key={item.label}>
                  <div className="flex items-center gap-3 px-3 pt-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    <Icon className="w-4 h-4 shrink-0" />{item.label}
                  </div>
                  {item.children.map((child) => {
                    const ChildIcon = child.icon;
                    return (
                      <Link key={child.href} href={child.href} onClick={() => setMobileOpen(false)}
                        className={cn(
                          "flex items-center gap-3 pl-10 pr-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                          pathname === child.href ? "bg-blue-50 text-blue-600" : "text-gray-700 hover:bg-gray-50"
                        )}>
                        <ChildIcon className="w-4 h-4 shrink-0" />{child.label}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
            <div className="border-t border-gray-100 pt-2 pb-1">
              <Link href="/admin/login" onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium text-white bg-gray-800">
                <ShieldCheck className="w-4 h-4" />관리자
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
