"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { TrendingUp, FileText, Building2, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

interface MonthRow { month: number; count: number; hospitalCount: number; companyCount: number; totalFee: number; }
interface CompanyRow { name: string; count: number; totalFee: number; }
interface Totals { count: number; hospitalCount: number; companyCount: number; totalFee: number; }
interface Data {
  year: number;
  monthly: MonthRow[];
  totals: Totals;
  byCompany: CompanyRow[];
  availableYears: number[];
}

const MONTH_LABELS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className="text-xl font-bold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function PerformancePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    fetch(`/api/mypage/performance?year=${year}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session, year]);

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center min-h-64 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />불러오는 중...
      </div>
    );
  }

  const curYear = new Date().getFullYear();
  const years = data?.availableYears?.length ? data.availableYears : [curYear];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg">
            <TrendingUp className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">실적관리</h1>
            <p className="text-sm text-gray-500">처방통계 제출 실적을 월별로 확인합니다</p>
          </div>
        </div>
        {/* 연도 선택 */}
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

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="총 처방건수" value={`${data?.totals.count ?? 0}건`} icon={FileText} color="bg-blue-50 text-blue-600" />
        <StatCard label="총 처방금액" value={data ? fmt(data.totals.totalFee) : "-"} icon={TrendingUp} color="bg-green-50 text-green-600" />
        <StatCard label="처방 거래처" value={`${data?.totals.hospitalCount ?? 0}곳`} icon={Building2} color="bg-orange-50 text-orange-600" />
        <StatCard label="제약사" value={`${data?.totals.companyCount ?? 0}개`} icon={FileText} color="bg-violet-50 text-violet-600" />
      </div>

      {/* 월별 실적 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">월별 처방 실적</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 font-semibold">
              <tr>
                <th className="px-4 py-2.5 text-left">월</th>
                <th className="px-4 py-2.5 text-right">처방건수</th>
                <th className="px-4 py-2.5 text-right">거래처 수</th>
                <th className="px-4 py-2.5 text-right">제약사 수</th>
                <th className="px-4 py-2.5 text-right">처방금액</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.monthly.map((row) => (
                <tr key={row.month} className={`hover:bg-gray-50 transition-colors ${row.count === 0 ? "opacity-40" : ""}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-700">{MONTH_LABELS[row.month - 1]}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.count > 0 ? `${row.count}건` : "-"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.hospitalCount > 0 ? `${row.hospitalCount}곳` : "-"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.companyCount > 0 ? `${row.companyCount}개` : "-"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-green-700">
                    {row.totalFee > 0 ? fmt(row.totalFee) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 text-xs font-bold border-t border-gray-200">
              <tr>
                <td className="px-4 py-2.5 text-gray-700">합계</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{data?.totals.count ?? 0}건</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{data?.totals.hospitalCount ?? 0}곳</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{data?.totals.companyCount ?? 0}개</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{data ? fmt(data.totals.totalFee) : "-"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 제약사별 실적 */}
      {data && data.byCompany.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">제약사별 실적 (상위 10개)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <tr>
                  <th className="px-4 py-2.5 text-left">제약사</th>
                  <th className="px-4 py-2.5 text-right">처방건수</th>
                  <th className="px-4 py-2.5 text-right">처방금액</th>
                  <th className="px-4 py-2.5 text-right">비중</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.byCompany.map((row) => {
                  const ratio = data.totals.totalFee > 0 ? (row.totalFee / data.totals.totalFee) * 100 : 0;
                  return (
                    <tr key={row.name} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-gray-700">{row.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{row.count}건</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-green-700">{fmt(row.totalFee)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(ratio, 100)}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 tabular-nums w-10 text-right">{ratio.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.totals.count === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{year}년 처방 실적 데이터가 없습니다</p>
          <p className="text-xs mt-1">통계자동입력 메뉴에서 처방통계를 등록하면 실적이 집계됩니다</p>
        </div>
      )}
    </div>
  );
}
