"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Pill, FileText, Building2, Search, LogIn, ShieldCheck, ChevronDown, Upload, User, LogOut } from "lucide-react";

const navItems = [
  { href: "/", label: "통합검색", icon: Search },
  { href: "/search/settlement", label: "정산제약사 검색", icon: Building2 },
  { href: "/filter", label: "제약사 필터링", icon: Building2 },
  { href: "/proposals", label: "제안서", icon: FileText },
];

const adminMenuItems = [
  { href: "/admin/dashboard", label: "요율표 업로드", icon: Upload },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const [adminOpen, setAdminOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const adminRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (adminRef.current && !adminRef.current.contains(e.target as Node)) setAdminOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 font-bold text-blue-600 text-lg">
            <Pill className="w-6 h-6" />
            MedAlt
          </Link>

          <div className="flex items-center gap-1">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  pathname === href
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {session ? (
              <div className="relative" ref={userRef}>
                <button
                  onClick={() => setUserOpen((p) => !p)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100"
                >
                  <User className="w-4 h-4" />
                  {session.user.name || "마이페이지"}
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", userOpen && "rotate-180")} />
                </button>
                {userOpen && (
                  <div className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
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
                <LogIn className="w-4 h-4" />로그인
              </Link>
            )}

            <div className="relative" ref={adminRef}>
              <button
                onClick={() => setAdminOpen((p) => !p)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-gray-800 hover:bg-gray-700"
              >
                <ShieldCheck className="w-4 h-4" />관리자
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", adminOpen && "rotate-180")} />
              </button>
              {adminOpen && (
                <div className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                  {adminMenuItems.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} onClick={() => setAdminOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      <Icon className="w-4 h-4 text-gray-500" />{label}
                    </Link>
                  ))}
                  <div className="border-t border-gray-100">
                    <Link href="/admin/login" onClick={() => setAdminOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50">
                      <ShieldCheck className="w-4 h-4" />관리자 로그인
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
