"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search, Building2, FileText, Filter, Eye, Users, ChevronLeft, ChevronRight, Pin } from "lucide-react";

const SLIDES = [
  {
    bg: "from-blue-900 to-blue-700",
    title: "Korea Medicine Data",
    sub: "의약품 영업사원을 위한 대체의약품 검색 플랫폼",
    desc: "성분명·제품명으로 빠르게 찾고, 제안서를 바로 출력하세요.",
    cta: { label: "통합검색 바로가기", href: "/search" },
  },
  {
    bg: "from-slate-800 to-blue-900",
    title: "정산제약사 검색",
    sub: "원외·원내 정산 가능 품목을 한눈에",
    desc: "거래처별 정산 가능 의약품을 신속하게 조회하세요.",
    cta: { label: "정산제약사 검색", href: "/search/settlement" },
  },
  {
    bg: "from-indigo-900 to-purple-800",
    title: "처방통계",
    sub: "처방전 이미지 업로드로 자동 분석",
    desc: "CLOVA OCR 기반 처방통계 자동 입력 및 관리.",
    cta: { label: "처방통계 등록", href: "/stats" },
  },
  {
    bg: "from-blue-800 to-cyan-700",
    title: "제안서 출력",
    sub: "장바구니에 담고 PDF로 바로 출력",
    desc: "고객사 맞춤 제안서를 빠르게 만들어 영업에 활용하세요.",
    cta: { label: "제안서 만들기", href: "/proposals" },
  },
];

interface Notice {
  id: string;
  title: string;
  content: string;
  category: string;
  isPinned: boolean;
  createdAt: string;
}

export default function LandingPage() {
  const [visits, setVisits] = useState<{ today: number; total: number } | null>(null);
  const [slide, setSlide] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/visits", { method: "POST" })
      .then(() => fetch("/api/visits"))
      .then((r) => r.json())
      .then(setVisits)
      .catch(() => null);
    fetch("/api/notices")
      .then((r) => r.json())
      .then((d) => setNotices(Array.isArray(d) ? d : []))
      .catch(() => null);
  }, []);

  const prev = useCallback(() => setSlide((s) => (s - 1 + SLIDES.length) % SLIDES.length), []);
  const next = useCallback(() => setSlide((s) => (s + 1) % SLIDES.length), []);

  useEffect(() => {
    const t = setInterval(next, 5000);
    return () => clearInterval(t);
  }, [next]);

  const cur = SLIDES[slide];

  return (
    <div className="flex flex-col">
      {/* ── 슬라이드 배너 ── */}
      <div className={`relative w-full bg-gradient-to-r ${cur.bg} transition-all duration-700 overflow-hidden`}
        style={{ minHeight: 340 }}>
        {/* 배경 패턴 */}
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)", backgroundSize: "60px 60px" }} />

        <div className="relative max-w-5xl mx-auto px-6 py-16 flex flex-col items-start justify-center" style={{ minHeight: 340 }}>
          <span className="text-xs font-semibold tracking-widest text-blue-200 uppercase mb-3">
            와이케이메디 | KMD Platform
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-3 leading-tight drop-shadow">
            {cur.title}
          </h1>
          <p className="text-lg text-blue-100 font-medium mb-2">{cur.sub}</p>
          <p className="text-sm text-blue-200 mb-8 max-w-lg">{cur.desc}</p>
          <Link href={cur.cta.href}
            className="inline-flex items-center gap-2 bg-white text-blue-700 font-bold px-6 py-3 rounded-xl shadow-lg hover:bg-blue-50 transition-all text-sm">
            {cur.cta.label} →
          </Link>
        </div>

        {/* 좌우 화살표 */}
        <button onClick={prev}
          className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2 transition-all">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button onClick={next}
          className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2 transition-all">
          <ChevronRight className="w-5 h-5" />
        </button>

        {/* 슬라이드 인디케이터 */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {SLIDES.map((_, i) => (
            <button key={i} onClick={() => setSlide(i)}
              className={`w-2 h-2 rounded-full transition-all ${i === slide ? "bg-white scale-125" : "bg-white/40"}`} />
          ))}
        </div>

        {/* 방문자 카운터 */}
        {visits !== null && (
          <div className="absolute top-4 right-4 flex items-center gap-3 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full">
            <div className="flex items-center gap-1 text-xs text-blue-100">
              <Eye className="w-3 h-3" />
              <span>오늘 <span className="font-bold text-white">{visits.today.toLocaleString()}</span></span>
            </div>
            <span className="text-white/30">|</span>
            <div className="flex items-center gap-1 text-xs text-blue-100">
              <Users className="w-3 h-3" />
              <span>전체 <span className="font-bold text-white">{visits.total.toLocaleString()}</span></span>
            </div>
          </div>
        )}
      </div>

      {/* ── 메뉴 바로가기 ── */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { href: "/search", label: "통합검색", icon: Search, desc: "제품명·성분명 검색" },
              { href: "/search/settlement", label: "정산제약사 검색", icon: Building2, desc: "정산 가능 품목 조회" },
              { href: "/filter", label: "제약사 필터링", icon: Filter, desc: "제약사별 품목 조회" },
              { href: "/proposals", label: "제안서", icon: FileText, desc: "장바구니·PDF 출력" },
            ].map(({ href, label, icon: Icon, desc }) => (
              <Link key={href} href={href}
                className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-300 transition-all group">
                <div className="w-9 h-9 rounded-lg bg-blue-100 group-hover:bg-blue-200 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{label}</div>
                  <div className="text-xs text-gray-400">{desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── 공지사항 게시판 ── */}
      <div className="max-w-5xl mx-auto px-6 py-10 w-full">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-1 h-5 rounded bg-blue-600 inline-block"></span>
          <h2 className="text-base font-bold text-gray-900">공지사항</h2>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {/* 헤더 */}
          <div className="grid grid-cols-12 text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-200 px-4 py-2.5">
            <div className="col-span-1 text-center">분류</div>
            <div className="col-span-8 pl-2">제목</div>
            <div className="col-span-3 text-right">날짜</div>
          </div>

          {notices.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">등록된 공지사항이 없습니다.</div>
          ) : (
            notices.map((n) => (
              <div key={n.id} className="border-b border-gray-100 last:border-0">
                <button
                  onClick={() => setExpanded(expanded === n.id ? null : n.id)}
                  className="w-full grid grid-cols-12 items-center px-4 py-3 hover:bg-gray-50 transition-all text-left">
                  <div className="col-span-1 text-center">
                    {n.isPinned ? (
                      <Pin className="w-3.5 h-3.5 text-blue-500 inline" />
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{n.category}</span>
                    )}
                  </div>
                  <div className="col-span-8 pl-2">
                    <span className={`text-sm ${n.isPinned ? "font-semibold text-blue-700" : "text-gray-800"}`}>
                      {n.isPinned && <span className="text-blue-500 mr-1">[필독]</span>}
                      {n.title}
                    </span>
                  </div>
                  <div className="col-span-3 text-right text-xs text-gray-400">
                    {new Date(n.createdAt).toLocaleDateString("ko-KR")}
                  </div>
                </button>
                {expanded === n.id && (
                  <div className="px-6 pb-5 pt-2 bg-blue-50 border-t border-blue-100">
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{n.content}</pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
