"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { navItems, type NavGroup } from "@/lib/nav-items";
import { ROLE_LABELS, ROLE_COLORS, type UserRole } from "@/lib/roles";
import {
  X, Lock, User, LogOut, LayoutDashboard, ShieldCheck,
  Building2, Users, Upload, BarChart3, TrendingUp, Wallet,
  MessageCircle,
} from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MobileSidebar({ open, onClose }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const isBusinessApproved = !!(session?.user as { isBusinessApproved?: boolean } | undefined)?.isBusinessApproved;
  const role = (session?.user as { role?: string } | undefined)?.role ?? "";
  // 의사/약사/일반은 통합검색만. CSO 분류(SALES/BIZ/ADMIN)만 전체 메뉴.
  const fullMenu = !session
    || role === "ADMIN" || role === "BIZ" || role === "SALES" || role === "BUSINESS"
    || isBusinessApproved;

  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleLockedNavClick(label: string) {
    onClose();
    if (confirm(`'${label}' 은(는) 사업자 인증이 필요한 기능이에요.\n\n마이페이지에서 사업자등록증을 등록하고 관리자 승인을 받으면 사용할 수 있어요.\n\n마이페이지로 이동할까요?`)) {
      router.push("/mypage");
    }
  }

  const mypageLinks = [
    { href: "/mypage",              label: "마이페이지",           icon: User       },
    { href: "/mypage/clients",      label: "거래처관리(의료기관)", icon: Building2  },
    { href: "/mypage/sub-clients",  label: "거래처관리(사업자)",   icon: Users      },
    { href: "/mypage/stat-upload",  label: "통계업로드",           icon: Upload     },
    { href: "/mypage/performance",  label: "실적관리",             icon: TrendingUp },
    { href: "/mypage/settlements",  label: "정산관리(신)",         icon: Wallet     },
    { href: "/mypage/settlement",   label: "정산관리(구)",         icon: Wallet     },
  ];

  return (
    <>
      {/* overlay */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 md:hidden",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* sidebar panel */}
      <aside
        className={cn(
          "fixed left-0 top-0 bottom-0 w-[280px] z-50 bg-white shadow-2xl overflow-y-auto transition-transform duration-300 ease-in-out md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* user header */}
        <div className="px-5 pt-6 pb-4 border-b border-gray-200">
          <button onClick={onClose} className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
          {session ? (
            <>
              <p className="text-lg font-bold text-gray-900">{session.user.name || "사용자"}님</p>
              <p className="text-sm text-gray-500 mt-0.5">안녕하세요</p>
              <span className={`inline-block mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[role as UserRole] ?? "bg-gray-100 text-gray-600"}`}>
                {ROLE_LABELS[role as UserRole] ?? role}
              </span>
            </>
          ) : (
            <Link href="/login" onClick={onClose} className="text-lg font-bold text-blue-600 hover:underline">
              로그인해주세요
            </Link>
          )}
        </div>

        {/* nav items — always expanded */}
        <div className="px-3 py-3 space-y-0.5">
          {navItems.map((item) => {
            const isLocked = !!session && !fullMenu && (item.kind === "link" ? item.href !== "/search" : true);

            if (item.kind === "link") {
              const Icon = item.icon;
              if (isLocked) {
                return (
                  <button key={item.href} onClick={() => handleLockedNavClick(item.label)}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-400 text-left">
                    <Lock className="w-4 h-4 shrink-0" />{item.label}
                  </button>
                );
              }
              return (
                <Link key={item.href} href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors",
                    pathname === item.href ? "bg-blue-50 text-blue-600 font-semibold" : "text-gray-700 hover:bg-gray-50"
                  )}>
                  <Icon className="w-5 h-5 shrink-0" />{item.label}
                </Link>
              );
            }

            // group — always expanded
            const Icon = item.icon;
            if (isLocked) {
              return (
                <button key={item.label} onClick={() => handleLockedNavClick(item.label)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-400 text-left">
                  <Lock className="w-4 h-4 shrink-0" />{item.label}
                </button>
              );
            }
            return (
              <div key={item.label}>
                <div className="flex items-center gap-3 px-3 pt-4 pb-1.5 text-xs font-bold text-gray-400 uppercase tracking-wide">
                  <Icon className="w-4 h-4 shrink-0" />{item.label}
                </div>
                {(item as NavGroup).children.map((child) => {
                  const ChildIcon = child.icon;
                  const active = pathname === child.href;
                  return (
                    <Link key={child.href} href={child.href}
                      className={cn(
                        "flex items-center gap-3 pl-10 pr-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                        active ? "bg-blue-50 text-blue-600 font-semibold" : "text-gray-700 hover:bg-gray-50"
                      )}>
                      <ChildIcon className="w-4 h-4 shrink-0" />{child.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* admin/biz links */}
        {(["BIZ", "ADMIN"] as string[]).includes(role) && (
          <div className="px-3 pt-1 pb-2 border-t border-gray-100 mt-1">
            <Link href="/biz" className="flex items-center gap-3 px-3 py-3 mt-2 rounded-lg text-sm font-medium text-white bg-purple-600 hover:bg-purple-700">
              <LayoutDashboard className="w-5 h-5" />비즈관리
            </Link>
          </div>
        )}
        {role === "ADMIN" && (
          <div className="px-3 pb-2">
            <Link href="/admin/dashboard" className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-white bg-gray-800 hover:bg-gray-700">
              <ShieldCheck className="w-5 h-5" />관리자
            </Link>
          </div>
        )}

        {/* mypage links */}
        {session && (
          <div className="px-3 pt-2 pb-2 border-t border-gray-100">
            <div className="px-3 pt-2 pb-1.5 text-xs font-bold text-gray-400 uppercase tracking-wide">
              업무관리
            </div>
            {mypageLinks.map((link) => {
              const Icon = link.icon;
              const active = pathname === link.href;
              return (
                <Link key={link.href} href={link.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    active ? "bg-blue-50 text-blue-600 font-semibold" : "text-gray-700 hover:bg-gray-50"
                  )}>
                  <Icon className="w-4 h-4 shrink-0 text-gray-400" />{link.label}
                </Link>
              );
            })}
          </div>
        )}

        {/* kakao + logout */}
        <div className="px-3 pt-2 pb-6 border-t border-gray-100 space-y-1">
          <a href="https://open.kakao.com/me/ykmedi" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-yellow-900 bg-yellow-400 hover:bg-yellow-500 transition-colors">
            <MessageCircle className="w-5 h-5" />카톡 문의
          </a>
          {session && (
            <button onClick={() => { signOut({ callbackUrl: "/" }); onClose(); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50">
              <LogOut className="w-5 h-5" />로그아웃
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
