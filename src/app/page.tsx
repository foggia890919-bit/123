"use client";

import Link from "next/link";
import { Search, Building2, FileText, Filter } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center space-y-12">
      {/* 로고 & 슬로건 */}
      <div className="text-center space-y-4">
        <div className="flex justify-center items-center gap-4 mb-2">
          <svg width="56" height="56" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="8" fill="#2563EB"/>
            <text x="16" y="22" textAnchor="middle" fill="white" fontSize="13" fontWeight="800" fontFamily="Arial, sans-serif" letterSpacing="-0.5">KMD</text>
          </svg>
          <div className="text-left">
            <div className="text-4xl font-extrabold text-gray-900 tracking-tight">Korea Medicine Data</div>
            <div className="text-sm font-medium text-blue-600 tracking-widest uppercase">KMD</div>
          </div>
        </div>
        <p className="text-gray-500 text-lg">의약품 영업사원을 위한 대체의약품 검색 플랫폼</p>
        <p className="text-gray-400 text-sm">와이케이메디 | 공지사항 및 서비스 안내</p>
      </div>

      {/* 메뉴 바로가기 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-2xl">
        {[
          { href: "/search", label: "통합검색", icon: Search, desc: "제품명·성분명 검색" },
          { href: "/search/settlement", label: "정산제약사 검색", icon: Building2, desc: "정산 가능 품목 조회" },
          { href: "/filter", label: "제약사 필터링", icon: Filter, desc: "제약사별 품목 조회" },
          { href: "/proposals", label: "제안서", icon: FileText, desc: "장바구니·PDF 출력" },
        ].map(({ href, label, icon: Icon, desc }) => (
          <Link key={href} href={href}
            className="flex flex-col items-center gap-2 p-5 rounded-xl bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 transition-all group shadow-sm">
            <Icon className="w-6 h-6 text-blue-600 group-hover:text-blue-700" />
            <span className="text-gray-900 text-sm font-semibold">{label}</span>
            <span className="text-gray-400 text-xs text-center">{desc}</span>
          </Link>
        ))}
      </div>

      {/* 공지 영역 */}
      <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-gray-700 text-sm font-semibold mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>공지사항
        </h2>
        <p className="text-gray-400 text-sm text-center py-6">등록된 공지사항이 없습니다.</p>
      </div>
    </div>
  );
}
