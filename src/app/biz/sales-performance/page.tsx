"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TrendingUp, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { BizLayout } from "../page";

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
function fmt(n: number) { return n > 0 ? n.toLocaleString("ko-KR") : "-"; }
function fmtFee(n: number) { return n > 0 ? n.toLocaleString("ko-KR") + "원" : "-"; }

interface MonthData { month: number; count: number; prescriptionTotal: number; totalFee: number; }
interface UserRow {
  id: string; name: string | null; email: string; salesCode: string | null;
  months: MonthData[];
  totals: { count: number; prescriptionTotal: number; totalFee: number };
}
interface Data { year: number; users: UserRow[]; availableYears: number[]; }

type SortKey = "name" | "count" | "prescriptionTotal" | "totalFee";

export default function SalesPerformancePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "totalFee", asc: false });

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    const uid = (session as { user?: { id?: string } } | null)?.user?.id;
    if (!uid) return;
    setLoading(true);
    fetch(`/api/biz/sales-performance?year=${year}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [(session as { user?: { id?: string } } | null)?.user?.id, year]);

  const curYear = new Date().getFullYear();

  const sorted = [...(data?.users ?? [])].sort((a, b) => {
    const dir = sort.asc ? 1 : -1;
    if (sort.key === "name") return dir * (a.name ?? "").localeCompare(b.name ?? "");
    return dir * (a.totals[sort.key] - b.totals[sort.key]);
  });

  function toggleSort(key: SortKey) {
    setSort((s) => s.key === key ? { key, asc: !s.asc } : { key, asc: false });
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sort.key !== k) return <span className="text-gray-300 text-[10px]">↕</span>;
    return sort.asc
      ? <ChevronUp className="w-3 h-3 inline-block text-orange-500" />
      : <ChevronDown className="w-3 h-3 inline-block text-orange-500" />;
  }

  // 전체 합계
  const grandTotal = (data?.users ?? []).reduce(
    (acc, u) => ({
      count: acc.count + u.totals.count,
      prescriptionTotal: acc.prescriptionTotal + u.totals.prescriptionTotal,
      totalFee: acc.totalFee + u.totals.totalFee,
    }),
    { count: 0, prescriptionTotal: 0, totalFee: 0 }
  );

  return (
    <BizLayout>
      <div className="space-y-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-50 rounded-lg">
              <TrendingUp className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">영업사원 실적 현황</h1>
              <p className="text-sm text-gray-500">전체 영업사원의 처방통계 제출 현황을 확인합니다</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1">
            <button onClick={() => setYear((y) => y - 1)} className="p-1 rounded hover:bg-gray-100 text-gray-600">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-sm font-semibold text-gray-800 min-w-[48px] text-center">{year}년</span>
            <button onClick={() => setYear((y) => y + 1)} disabled={year >= curYear} className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center min-h-64 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />불러오는 중...
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">
                영업사원별 합계 <span className="text-gray-400 font-normal ml-1">({sorted.length}명)</span>
              </h2>
              <p className="text-xs text-gray-400">행 클릭 시 월별 상세 펼쳐짐</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 font-semibold">
                  <tr>
                    <th className="px-4 py-2.5 text-left cursor-pointer select-none" onClick={() => toggleSort("name")}>
                      영업사원 <SortIcon k="name" />
                    </th>
                    <th className="px-3 py-2.5 text-right cursor-pointer select-none" onClick={() => toggleSort("count")}>
                      제출건수 <SortIcon k="count" />
                    </th>
                    <th className="px-3 py-2.5 text-right cursor-pointer select-none" onClick={() => toggleSort("prescriptionTotal")}>
                      처방액 <SortIcon k="prescriptionTotal" />
                    </th>
                    <th className="px-3 py-2.5 text-right cursor-pointer select-none" onClick={() => toggleSort("totalFee")}>
                      수수료 <SortIcon k="totalFee" />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sorted.map((u) => (
                    <>
                      <tr
                        key={u.id}
                        className={`cursor-pointer hover:bg-orange-50 transition-colors ${u.totals.count === 0 ? "opacity-40" : ""}`}
                        onClick={() => setExpanded(expanded === u.id ? null : u.id)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${expanded === u.id ? "rotate-180" : ""}`} />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-800">{u.name || "(이름없음)"}</p>
                              <p className="text-[11px] text-gray-400">{u.salesCode ?? u.email}</p>
                            </div>
                            <Link
                              href={`/biz/sales-performance/${u.id}?year=${year}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-shrink-0 p-1 rounded hover:bg-orange-100 text-gray-300 hover:text-orange-600 transition-colors"
                              title="세부내역 보기"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                          {u.totals.count > 0 ? `${u.totals.count}건` : "-"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                          {fmt(u.totals.prescriptionTotal)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-green-700">
                          {fmtFee(u.totals.totalFee)}
                        </td>
                      </tr>
                      {expanded === u.id && (
                        <tr key={`${u.id}-detail`}>
                          <td colSpan={4} className="px-0 py-0 bg-gray-50">
                            <table className="w-full text-xs">
                              <thead className="text-gray-400 font-semibold border-b border-gray-200">
                                <tr>
                                  <th className="px-8 py-2 text-left">월</th>
                                  <th className="px-3 py-2 text-right">제출건수</th>
                                  <th className="px-3 py-2 text-right">처방액</th>
                                  <th className="px-4 py-2 text-right">수수료</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {u.months.map((m) => (
                                  <tr key={m.month} className={m.count === 0 ? "opacity-30" : ""}>
                                    <td className="px-8 py-1.5 text-gray-600">{MONTHS[m.month - 1]}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                                      {m.count > 0 ? `${m.count}건` : "-"}
                                    </td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                                      {fmt(m.prescriptionTotal)}
                                    </td>
                                    <td className="px-4 py-1.5 text-right tabular-nums text-green-700">
                                      {fmtFee(m.totalFee)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-bold text-xs border-t-2 border-gray-200">
                  <tr>
                    <td className="px-4 py-2.5 text-gray-700">전체 합계</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                      {grandTotal.count > 0 ? `${grandTotal.count}건` : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                      {fmt(grandTotal.prescriptionTotal)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-green-700">
                      {fmtFee(grandTotal.totalFee)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </BizLayout>
  );
}
