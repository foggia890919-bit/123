"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TrendingUp, FileText, Building2, Loader2, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownRight, Minus, ExternalLink } from "lucide-react";

const MONTH_LABELS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }

interface MonthRow { month: number; count: number; hospitalCount: number; companyCount: number; totalFee: number; prescriptionTotal: number; }
interface CompanyRow { name: string; count: number; totalFee: number; }
interface Totals { count: number; hospitalCount: number; companyCount: number; totalFee: number; prescriptionTotal: number; }
interface Comparison { curMonth: number; prevMonth: number | null; curHospitals: number; prevHospitals: number; curCount: number; prevCount: number; curFee: number; prevFee: number; }
interface Data { year: number; monthly: MonthRow[]; totals: Totals; byCompany: CompanyRow[]; comparison: Comparison; availableYears: number[]; isAggregateOnly?: boolean; }

function DiffBadge({ cur, prev }: { cur: number; prev: number }) {
  const diff = cur - prev;
  if (diff === 0) return <span className="inline-flex items-center text-xs text-gray-400"><Minus className="w-3 h-3" />변동없음</span>;
  const up = diff > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? "text-green-600" : "text-red-500"}`}>
      {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {up ? "+" : ""}{diff.toLocaleString()}
    </span>
  );
}

function CompareCard({ title, sub, curLabel, prevLabel, cur, prev, unit = "" }: {
  title: string; sub: string; curLabel: string; prevLabel: string; cur: number; prev: number; unit?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs text-gray-500 mb-3">{title}</p>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[10px] text-gray-400 mb-0.5">{curLabel}</p>
          <p className="text-2xl font-bold text-gray-900 leading-tight">{cur.toLocaleString()}<span className="text-sm font-normal text-gray-600 ml-0.5">{unit}</span></p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-400 mb-0.5">{prevLabel}</p>
          <p className="text-base font-semibold text-gray-500">{prev.toLocaleString()}{unit}</p>
        </div>
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-gray-100 flex items-center justify-between">
        <p className="text-[10px] text-gray-400">{sub}</p>
        <DiffBadge cur={cur} prev={prev} />
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
    const uid = (session as { user?: { id?: string } } | null)?.user?.id;
    if (!uid) return;
    setLoading(true);
    fetch(`/api/mypage/performance?year=${year}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [(session as { user?: { id?: string } } | null)?.user?.id, year]); // eslint-disable-line

  if (status === "loading" || loading) {
    return <div className="flex items-center justify-center min-h-64 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />불러오는 중...</div>;
  }

  const curYear = new Date().getFullYear();
  const cmp = data?.comparison;
  const curMonthLabel = cmp ? MONTH_LABELS[cmp.curMonth - 1] : "";
  const prevMonthLabel = cmp?.prevMonth ? MONTH_LABELS[cmp.prevMonth - 1] : "전월";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg"><TrendingUp className="w-5 h-5 text-blue-600" /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">실적관리</h1>
            <p className="text-sm text-gray-500">처방통계 제출 실적을 월별로 확인합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-2 py-1">
          <button onClick={() => setYear((y) => y - 1)} className="p-1 rounded hover:bg-gray-100 text-gray-600"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-2 text-sm font-semibold text-gray-800 min-w-[48px] text-center">{year}년</span>
          <button onClick={() => setYear((y) => y + 1)} disabled={year >= curYear} className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {/* 요약 카드 4개 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 카드1: 전월 vs 당월 거래처 수 */}
        <CompareCard
          title="제출 거래처 현황"
          sub={`${prevMonthLabel} 대비 ${curMonthLabel}`}
          curLabel={`${curMonthLabel} (당월)`}
          prevLabel={`${prevMonthLabel} (전월)`}
          cur={cmp?.curHospitals ?? 0}
          prev={cmp?.prevHospitals ?? 0}
          unit="곳"
        />
        {/* 카드2: 전월 vs 당월 처방통계 건수 */}
        <CompareCard
          title="처방통계 제출 현황"
          sub={`${prevMonthLabel} 대비 ${curMonthLabel}`}
          curLabel={`${curMonthLabel} (당월)`}
          prevLabel={`${prevMonthLabel} (전월)`}
          cur={cmp?.curCount ?? 0}
          prev={cmp?.prevCount ?? 0}
          unit="건"
        />
        {/* 카드3: 총처방액 / 총수수료액 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs text-gray-500 mb-3">{year}년 처방액 / 수수료</p>
          <div className="space-y-2">
            <div>
              <p className="text-[10px] text-gray-400 mb-0.5">총 처방액</p>
              <p className="text-lg font-bold text-gray-900 leading-tight">{fmt(data?.totals.prescriptionTotal ?? 0)}</p>
            </div>
            <div className="pt-2 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 mb-0.5">총 수수료액</p>
              <p className="text-base font-semibold text-green-700">{fmt(data?.totals.totalFee ?? 0)}</p>
            </div>
          </div>
        </div>
        {/* 카드4: 자세히 보기 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs text-gray-500 mb-1">{year}년 전체 실적</p>
            <p className="text-2xl font-bold text-gray-900">{data?.totals.count ?? 0}<span className="text-sm font-normal text-gray-600 ml-0.5">건</span></p>
            <p className="text-xs text-gray-400 mt-1">{data?.totals.hospitalCount ?? 0}개 거래처</p>
          </div>
          {data?.isAggregateOnly ? (
            <p className="mt-4 text-[11px] text-gray-400 text-center">세부 내역은 담당 법인에 문의하세요</p>
          ) : (
            <Link
              href={`/mypage/performance/detail?year=${year}`}
              className="mt-4 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />자세히 보기
            </Link>
          )}
        </div>
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
                <th className="px-4 py-2.5 text-right">처방액</th>
                <th className="px-4 py-2.5 text-right">수수료</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.monthly.map((row) => (
                <tr key={row.month} className={`hover:bg-gray-50 transition-colors ${row.count === 0 ? "opacity-40" : ""}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-700">{MONTH_LABELS[row.month - 1]}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.count > 0 ? `${row.count}건` : "-"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.hospitalCount > 0 ? `${row.hospitalCount}곳` : "-"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{row.prescriptionTotal > 0 ? fmt(row.prescriptionTotal) : "-"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-green-700">{row.totalFee > 0 ? fmt(row.totalFee) : "-"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 text-xs font-bold border-t border-gray-200">
              <tr>
                <td className="px-4 py-2.5 text-gray-700">합계</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{data?.totals.count ?? 0}건</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{data?.totals.hospitalCount ?? 0}곳</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">{data ? fmt(data.totals.prescriptionTotal) : "-"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{data ? fmt(data.totals.totalFee) : "-"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 제약사별 실적 */}
      {data && data.byCompany.length > 0 && data.byCompany[0].name !== "기타" && (
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
                  <th className="px-4 py-2.5 text-right">수수료</th>
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
