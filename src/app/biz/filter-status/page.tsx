"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Search, CheckCircle, XCircle, Clock, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BizLayout } from "../page";

interface FilterRow {
  id: string;
  clientName: string;
  bizNumber: string;
  companyName: string;
  requestType: string;
  status: string;
  respondedResult: string | null;
  respondedAt: string | null;
  createdAt: string;
  user?: { name: string | null; email: string };
}

const STATUS_LABEL: Record<string, string> = {
  PENDING:   "대기",
  REVIEWING: "검토중",
  APPROVED:  "승인",
  REJECTED:  "반려",
};

function ResultBadge({ result, status }: { result: string | null; status: string }) {
  if (result === "가능") return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
      <CheckCircle className="w-3 h-3" /> 가능
    </span>
  );
  if (result === "불가") return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
      <XCircle className="w-3 h-3" /> 불가
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">
      <Clock className="w-3 h-3" /> {STATUS_LABEL[status] ?? "대기"}
    </span>
  );
}

export default function FilterStatusPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState<FilterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<"ALL" | "가능" | "불가" | "대기">("ALL");

  const isAdmin = session?.user?.role === "ADMIN";

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") { router.push("/"); return; }

    const url = role === "ADMIN" ? "/api/filter-request?all=true" : "/api/filter-request";
    fetch(url)
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, [session, status, router]);

  const filtered = rows.filter((r) => {
    const matchQ = !query ||
      r.clientName.includes(query) ||
      r.companyName.includes(query) ||
      r.bizNumber.includes(query) ||
      (r.user?.name ?? "").includes(query);
    const matchResult = resultFilter === "ALL" ||
      (resultFilter === "대기" ? !r.respondedResult : r.respondedResult === resultFilter);
    return matchQ && matchResult;
  });

  // 거래처별로 그룹핑
  const grouped = filtered.reduce<Record<string, FilterRow[]>>((acc, r) => {
    const key = `${r.clientName}__${r.bizNumber}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const counts = {
    ALL: rows.length,
    가능: rows.filter((r) => r.respondedResult === "가능").length,
    불가: rows.filter((r) => r.respondedResult === "불가").length,
    대기: rows.filter((r) => !r.respondedResult).length,
  };

  function formatDate(s: string | null) {
    if (!s) return "-";
    return new Date(s).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
  }
  function formatBiz(n: string) {
    const d = n.replace(/\D/g, "");
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    return n;
  }

  return (
    <BizLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">필터링 현황</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isAdmin ? "전체 영업사원의 거래처×제약사 필터링 요청 현황" : "내 거래처별 제약사 필터링 요청 현황"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
            <Filter className="w-3.5 h-3.5" />
            총 {rows.length}건
          </div>
        </div>

        {/* 검색 + 결과 필터 */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder={isAdmin ? "거래처명, 제약사명, 영업사원 검색" : "거래처명 또는 제약사명 검색"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
          <div className="flex gap-1">
            {(["ALL", "가능", "불가", "대기"] as const).map((f) => (
              <button key={f}
                onClick={() => setResultFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors whitespace-nowrap ${
                  resultFilter === f
                    ? f === "가능" ? "bg-green-600 text-white"
                    : f === "불가" ? "bg-red-600 text-white"
                    : f === "대기" ? "bg-yellow-500 text-white"
                    : "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {f === "ALL" ? "전체" : f} ({counts[f]})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
            {query || resultFilter !== "ALL" ? "검색 결과가 없습니다" : "필터링 요청 내역이 없습니다"}
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([key, items]) => {
              const [clientName, bizNumber] = key.split("__");
              return (
                <div key={key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  {/* 거래처 헤더 */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{clientName}</p>
                      <p className="text-xs text-gray-400 font-mono">{formatBiz(bizNumber)}</p>
                    </div>
                    {isAdmin && items[0].user && (
                      <span className="ml-auto text-xs text-gray-400">
                        {items[0].user.name ?? items[0].user.email}
                      </span>
                    )}
                    <span className={`${isAdmin ? "" : "ml-auto"} text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full`}>
                      {items.length}개 제약사
                    </span>
                  </div>

                  {/* 제약사별 행 */}
                  <div className="divide-y divide-gray-50">
                    {/* 테이블 헤더 */}
                    <div className={`grid text-xs font-medium text-gray-400 px-4 py-2 bg-white ${isAdmin ? "grid-cols-[1fr_auto_auto_auto_auto]" : "grid-cols-[1fr_auto_auto_auto]"}`}>
                      <span>제약사</span>
                      <span className="w-12 text-center">유형</span>
                      <span className="w-20 text-center">결과</span>
                      <span className="w-20 text-right">요청일</span>
                      {isAdmin && <span className="w-20 text-right">처리일</span>}
                    </div>
                    {items.map((r) => (
                      <div key={r.id}
                        className={`grid items-center px-4 py-2.5 text-xs hover:bg-gray-50 ${isAdmin ? "grid-cols-[1fr_auto_auto_auto_auto]" : "grid-cols-[1fr_auto_auto_auto]"}`}>
                        <span className="font-medium text-gray-800 truncate pr-2">{r.companyName}</span>
                        <span className="w-12 text-center text-gray-500">{r.requestType}</span>
                        <span className="w-20 flex justify-center">
                          <ResultBadge result={r.respondedResult} status={r.status} />
                        </span>
                        <span className="w-20 text-right text-gray-400">{formatDate(r.createdAt)}</span>
                        {isAdmin && <span className="w-20 text-right text-gray-400">{formatDate(r.respondedAt)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BizLayout>
  );
}
