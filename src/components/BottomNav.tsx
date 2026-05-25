"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Menu, X, Home, Bell } from "lucide-react";

interface Props {
  onMenuToggle: () => void;
  sidebarOpen: boolean;
}

export default function BottomNav({ onMenuToggle, sidebarOpen }: Props) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/notifications");
        if (!res.ok || cancelled) return;
        const data = await res.json() as { unreadCount: number };
        if (!cancelled) setUnreadCount(data.unreadCount);
      } catch { /* network */ }
    }
    check();
    const interval = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [session?.user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = [
    {
      key: "menu",
      icon: sidebarOpen ? X : Menu,
      label: "메뉴",
      active: sidebarOpen,
      onClick: onMenuToggle,
    },
    {
      key: "home",
      icon: Home,
      label: "홈",
      active: pathname === "/" && !sidebarOpen,
      href: "/",
    },
    {
      key: "notifications",
      icon: Bell,
      label: "알림",
      active: false,
      href: "/mypage",
      badge: session ? unreadCount : 0,
    },
  ] as const;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const inner = (
            <div className={cn(
              "flex flex-col items-center justify-center gap-0.5 relative",
              tab.active ? "text-blue-600" : "text-gray-500"
            )}>
              <div className="relative">
                <Icon className="w-6 h-6" />
                {"badge" in tab && tab.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {tab.badge > 99 ? "99+" : tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{tab.label}</span>
            </div>
          );

          if ("onClick" in tab && tab.onClick) {
            return (
              <button key={tab.key} onClick={tab.onClick}
                className="flex-1 flex items-center justify-center py-1">
                {inner}
              </button>
            );
          }
          return (
            <Link key={tab.key} href={"href" in tab ? tab.href : "/"}
              className="flex-1 flex items-center justify-center py-1">
              {inner}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
