"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Pill, FileText, Building2, Search, LogOut, ShieldCheck, ChevronDown, Upload } from "lucide-react";

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
  const [adminOpen, setAdminOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAdminOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
            <Link
              href="/login"
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              <LogOut className="w-4 h-4" />
              로그인
            </Link>

            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setAdminOpen((prev) => !prev)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-gray-800 hover:bg-gray-700"
              >
                <ShieldCheck className="w-4 h-4" />
                관리자
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", adminOpen && "rotate-180")} />
              </button>

              {adminOpen && (
                <div className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                  {adminMenuItems.map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setAdminOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <Icon className="w-4 h-4 text-gray-500" />
                      {label}
                    </Link>
                  ))}
                  <div className="border-t border-gray-100">
                    <Link
                      href="/admin/login"
                      onClick={() => setAdminOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      관리자 로그인
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
