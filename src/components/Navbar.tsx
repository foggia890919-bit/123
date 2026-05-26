"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Building2, LogIn, ShieldCheck, ChevronDown, User, LogOut, Lock, LayoutDashboard, MessageCircle, TrendingUp, Wallet, Users, Upload, BarChart3, Bell, Check, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, ROLE_COLORS, type UserRole } from "@/lib/roles";
import { navItems, type NavGroup } from "@/lib/nav-items";

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  // 일반회원 (사업자 미인증) 은 통합검색 외 모든 메뉴 차단 + 안내
  const isBusinessApproved = !!(session?.user as { isBusinessApproved?: boolean } | undefined)?.isBusinessApproved;
  function handleLockedNavClick(e: React.MouseEvent, label: string) {
    e.preventDefault();
    if (confirm(`'${label}' 은(는) 사업자 인증이 필요한 기능이에요.\n\n마이페이지에서 사업자등록증을 등록하고 관리자 승인을 받으면 사용할 수 있어요.\n\n마이페이지로 이동할까요?`)) {
      router.push("/mypage");
    }
  }
  const [userOpen, setUserOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  // ── 알람 종 ──
  interface NotifItem { id: string; type: string; title: string; body: string | null; link: string | null; isRead: boolean; createdAt: string }
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifList, setNotifList] = useState<NotifItem[]>([]);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

  async function refreshNotifications() {
    if (!session) return;
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json() as { list: NotifItem[]; unreadCount: number };
      setNotifList(data.list);
      setNotifUnreadCount(data.unreadCount);
    } catch { /* network */ }
  }

  useEffect(() => {
    if (!session) return;
    refreshNotifications();
    // 60 초마다 폴링
    const interval = setInterval(refreshNotifications, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.email]);

  async function markRead(id: string) {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isRead: true }),
    });
    setNotifList((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
    setNotifUnreadCount((c) => Math.max(0, c - 1));
  }
  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allRead: true }),
    });
    setNotifList((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setNotifUnreadCount(0);
  }
  async function deleteNotif(id: string) {
    await fetch(`/api/notifications?id=${id}`, { method: "DELETE" });
    setNotifList((prev) => prev.filter((n) => n.id !== id));
    refreshNotifications();
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) setOpenGroup(null);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => { setOpenGroup(null); }, [pathname]);

  function isGroupActive(g: NavGroup) {
    return g.matchPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
  }

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm relative z-40">
      <div className="max-w-screen-2xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* 로고 */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="kmd-g" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#fb923c"/>
                  <stop offset="100%" stopColor="#c2410c"/>
                </linearGradient>
              </defs>
              <rect width="32" height="32" rx="8" fill="url(#kmd-g)"/>
              <text x="16" y="22" textAnchor="middle" fill="white" fontSize="13" fontWeight="800" fontFamily="Arial, sans-serif" letterSpacing="-0.5">KMD</text>
            </svg>
            <span className="font-bold text-gray-900 text-lg tracking-tight">Korea Medicine Data</span>
          </Link>

          {/* 데스크톱 네비 */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              // 일반회원이면 통합검색(/search) 외 모든 메뉴 잠금
              const isLocked = !!session && !isBusinessApproved && (item.kind === "link" ? item.href !== "/search" : true);
              if (item.kind === "link") {
                const Icon = item.icon;
                if (isLocked) {
                  return (
                    <button key={item.href} onClick={(e) => handleLockedNavClick(e, item.label)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-gray-400 hover:bg-gray-50 cursor-not-allowed">
                      <Lock className="w-3.5 h-3.5" />{item.label}
                    </button>
                  );
                }
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
              // 그룹 (제안서, 통계, 원내거래) — 일반회원이면 전체 잠금
              if (isLocked) {
                const Icon = item.icon;
                return (
                  <button key={item.label} onClick={(e) => handleLockedNavClick(e, item.label)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-gray-400 hover:bg-gray-50 cursor-not-allowed">
                    <Lock className="w-3.5 h-3.5" />{item.label}
                  </button>
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

          {/* 우측 버튼 — 데스크톱 전용 (모바일은 BottomNav + MobileSidebar에서 처리) */}
          <div className="hidden md:flex items-center gap-2">
            {session && (
              <div className="relative" ref={notifRef}>
                <button onClick={() => setNotifOpen((p) => !p)}
                  className="relative p-2 rounded-md text-gray-600 hover:bg-gray-100"
                  title="알람">
                  <Bell className="w-5 h-5" />
                  {notifUnreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {notifUnreadCount > 99 ? "99+" : notifUnreadCount}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                      <p className="text-sm font-semibold text-gray-800">알람 {notifUnreadCount > 0 && <span className="text-red-500">({notifUnreadCount})</span>}</p>
                      {notifUnreadCount > 0 && (
                        <button onClick={markAllRead} className="text-[11px] text-blue-600 hover:underline flex items-center gap-0.5">
                          <Check className="w-3 h-3" />모두 읽음
                        </button>
                      )}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifList.length === 0 ? (
                        <div className="py-8 px-4 text-center text-xs text-gray-400">알람이 없어요</div>
                      ) : (
                        notifList.map((n) => (
                          <div key={n.id} className={`px-4 py-3 border-b border-gray-50 last:border-0 ${n.isRead ? "bg-white" : "bg-blue-50/40"}`}>
                            <div className="flex items-start gap-2">
                              {!n.isRead && <span className="w-1.5 h-1.5 mt-1.5 bg-red-500 rounded-full shrink-0" />}
                              <div className="flex-1 min-w-0">
                                {n.link ? (
                                  <Link href={n.link} onClick={() => { setNotifOpen(false); if (!n.isRead) markRead(n.id); }}
                                    className="block">
                                    <p className={`text-sm ${n.isRead ? "font-normal text-gray-700" : "font-semibold text-gray-900"} truncate`}>{n.title}</p>
                                    {n.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
                                  </Link>
                                ) : (
                                  <>
                                    <p className={`text-sm ${n.isRead ? "font-normal text-gray-700" : "font-semibold text-gray-900"} truncate`}>{n.title}</p>
                                    {n.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
                                  </>
                                )}
                                <p className="text-[10px] text-gray-400 mt-1">{new Date(n.createdAt).toLocaleString("ko-KR")}</p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {!n.isRead && (
                                  <button onClick={() => markRead(n.id)} className="p-1 text-gray-300 hover:text-blue-600" title="읽음 처리">
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button onClick={() => deleteNotif(n.id)} className="p-1 text-gray-300 hover:text-red-500" title="삭제">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {session ? (
              <div className="relative" ref={userRef}>
                <button onClick={() => setUserOpen((p) => !p)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100">
                  <User className="w-4 h-4" />
                  <span>{session.user.name || "마이페이지"}</span>
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
                    <div className="px-4 pt-2 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">업무관리</div>
                    <Link href="/mypage/clients" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 pl-6">
                      <Building2 className="w-4 h-4 text-gray-400" />거래처관리(의료기관)
                    </Link>
                    <Link href="/mypage/sub-clients" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 pl-6">
                      <Users className="w-4 h-4 text-gray-400" />거래처관리(사업자)
                    </Link>
                    <Link href="/mypage/stat-upload" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 pl-6">
                      <Upload className="w-4 h-4 text-gray-400" />통계업로드
                    </Link>
                    <Link href="/stats" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 pl-6">
                      <BarChart3 className="w-4 h-4 text-gray-400" />통계자동입력
                    </Link>
                    <Link href="/mypage/performance" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      <TrendingUp className="w-4 h-4 text-gray-400" />실적관리
                    </Link>
                    <Link href="/mypage/settlements" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      <Wallet className="w-4 h-4 text-gray-400" />정산관리(신)
                    </Link>
                    <Link href="/mypage/settlement" onClick={() => setUserOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      <Wallet className="w-4 h-4 text-gray-400" />정산관리(구)
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
                <span>로그인</span>
              </Link>
            )}

            <a
              href="https://open.kakao.com/me/ykmedi"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-yellow-900 bg-yellow-400 hover:bg-yellow-500 transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              <span>카톡 문의</span>
            </a>

            {(["BIZ", "ADMIN"] as string[]).includes((session?.user as { role?: string } | undefined)?.role ?? "") && (
              <Link href="/biz"
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-purple-600 hover:bg-purple-700">
                <LayoutDashboard className="w-4 h-4" />비즈관리
              </Link>
            )}
            {(session?.user as { role?: string } | undefined)?.role === "ADMIN" && (
              <Link href="/admin/dashboard"
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-gray-800 hover:bg-gray-700">
                <ShieldCheck className="w-4 h-4" />관리자
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
