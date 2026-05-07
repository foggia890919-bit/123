"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Wallet, CheckCircle2, Clock, FileText, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

interface MonthRow { month: number; confirmed: number; pending: number; confirmedFee: number; }
interface Item { id: string; year: number; month: number; hospitalName: string | null; companyName: string | null; totalFee: number | null; status: string; createdAt: string; }
interface Totals { totalFee: number; confirmedCount: number; pendingCount: number; totalCount: number; }
interface Data { year: number; monthly: MonthRow[]; totals: Totals; items: Item[]; availableYears: number[]; }

const MONTH_LABELS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
function fmt(n: number) { return n.toLocaleString("ko-KR") + "원"; }

function StatCard({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className="text-xl font-bold text-gray-900 leading-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function SettlementsPage() {
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
    fetch(`/api/mypage/settlements?year=${year}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [(session as { user?: { id?: string } } | null)?.user?.id, year]); // eslint-disable-line

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center min-h-64 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />불러오는 중...
      </div>
    );
  }

  const curYear = new Date().getFullYear();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-50 rounded-lg">
            <Wallet className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">정산관리</h1>
            <p className="text-sm text-gray-500">처방 수수료 정산 현황을 확인합니다</p>
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

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="정산 완료 금액" value={data ? fmt(data.totals.totalFee) : "-"} icon={Wallet} color="bg-green-50 text-green-600" />
        <StatCard label="정산 완료 건수" value={`${data?.totals.confirmedCount ?? 0}건`} icon={CheckCircle2} color="bg-blue-50 text-blue-600" />
        <StatCard label="정산 대기 건수" value={`${data?.totals.pendingCount ?? 0}건`} sub="처방금액 미입력" icon={Clock} color="bg-orange-50 text-orange-600" />
      </div>

      {/* 월별 정산 테이블 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">월별 정산 현황</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 font-semibold">
              <tr>
                <th className="px-4 py-2.5 text-left">월</th>
                <th className="px-4 py-2.5 text-right">정산 완료</th>
                <th className="px-4 py-2.5 text-right">대기</th>
                <th className="px-4 py-2.5 text-right">정산 금액</th>
                <th className="px-4 py-2.5 text-center">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.monthly.map((row) => {
                const total = row.confirmed + row.pending;
                return (
                  <tr key={row.month} className={`hover:bg-gray-50 transition-colors ${total === 0 ? "opacity-40" : ""}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-700">{MONTH_LABELS[row.month - 1]}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-green-700">{row.confirmed > 0 ? `${row.confirmed}건` : "-"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-orange-500">{row.pending > 0 ? `${row.pending}건` : "-"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">
                      {row.confirmedFee > 0 ? fmt(row.confirmedFee) : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {total === 0 ? null : row.pending > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">
                          <Clock className="w-3 h-3" />대기
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                          <CheckCircle2 className="w-3 h-3" />완료
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 text-xs font-bold border-t border-gray-200">
              <tr>
                <td className="px-4 py-2.5 text-gray-700">합계</td>
                <td className="px-4 py-2.5 text-right text-green-700">{data?.totals.confirmedCount ?? 0}건</td>
                <td className="px-4 py-2.5 text-right text-orange-500">{data?.totals.pendingCount ?? 0}건</td>
                <td className="px-4 py-2.5 text-right text-gray-800">{data ? fmt(data.totals.totalFee) : "-"}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 최근 내역 */}
      {data && data.items.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">처방 정산 내역 (최근 50건)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <tr>
                  <th className="px-4 py-2.5 text-left">기간</th>
                  <th className="px-4 py-2.5 text-left">거래처</th>
                  <th className="px-4 py-2.5 text-left">제약사</th>
                  <th className="px-4 py-2.5 text-right">정산금액</th>
                  <th className="px-4 py-2.5 text-center">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 tabular-nums text-gray-500 whitespace-nowrap">{item.year}년 {item.month}월</td>
                    <td className="px-4 py-2.5 text-gray-700 max-w-[120px] truncate">{item.hospitalName || "-"}</td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-[100px] truncate">{item.companyName || "-"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {item.totalFee != null && item.totalFee > 0
                        ? <span className="text-green-700">{fmt(item.totalFee)}</span>
                        : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {item.status === "CONFIRMED" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                          <CheckCircle2 className="w-3 h-3" />완료
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">
                          <Clock className="w-3 h-3" />대기
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.totals.totalCount === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{year}년 정산 데이터가 없습니다</p>
          <p className="text-xs mt-1">처방통계를 등록하고 수수료 금액이 입력되면 정산 내역이 표시됩니다</p>
        </div>
      )}
    </div>
  );
}
