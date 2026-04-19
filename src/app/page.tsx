"use client";

import Link from "next/link";
import { Pill, Search, Building2, FileText, Filter } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center space-y-12">
      {/* 로고 & 슬로건 */}
      <div className="text-center space-y-4">
        <div className="flex justify-center items-center gap-3 mb-2">
          <Pill className="w-12 h-12 text-blue-400" />
          <span className="text-5xl font-bold text-white tracking-tight">MedAlt</span>
        </div>
        <p className="text-gray-400 text-lg">의약품 영업사원을 위한 대체의약품 검색 플랫폼</p>
        <p className="text-gray-600 text-sm">와이케이메디 | 공지사항 및 서비스 안내</p>
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
            className="flex flex-col items-center gap-2 p-5 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-500 transition-all group">
            <Icon className="w-6 h-6 text-blue-400 group-hover:text-blue-300" />
            <span className="text-white text-sm font-medium">{label}</span>
            <span className="text-gray-500 text-xs text-center">{desc}</span>
          </Link>
        ))}
      </div>

      {/* 공지 영역 (추후 게시판) */}
      <div className="w-full max-w-2xl bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h2 className="text-gray-300 text-sm font-semibold mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span>공지사항
        </h2>
        <p className="text-gray-600 text-sm text-center py-6">등록된 공지사항이 없습니다.</p>
      </div>
    </div>
  );
}
