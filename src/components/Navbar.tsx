"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Pill, FileText, Building2, Search, LogOut } from "lucide-react";

const navItems = [
  { href: "/", label: "통합검색", icon: Search },
  { href: "/search/settlement", label: "정산제약사 검색", icon: Building2 },
  { href: "/filter", label: "제약사 필터링", icon: Building2 },
  { href: "/proposals", label: "제안서", icon: FileText },
];

export default function Navbar() {
  const pathname = usePathname();

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
          </div>
        </div>
      </div>
    </nav>
  );
}
