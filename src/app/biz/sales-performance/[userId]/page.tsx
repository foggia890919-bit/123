"use client";

import { useState, useEffect, use } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { BizLayout } from "../../page";

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

interface CrossRow { hospitalName: string; companyName: string; months: number[]; }
interface LineItem { hospitalName: string; companyName: string; productName: string; month: number; quantity: number; unitPrice: number; prescription: number; fee: number; }
interface UserInfo { id: string; name: string | null; email: string; salesCode: string | null; }
interface DetailData { year: number; user: UserInfo; crossTab: CrossRow[]; lineItems: LineItem[]; }

export default function SalesRepDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [year, setYear] = useState(parseInt(searchParams.get("year") ?? String(new Date().getFullYear())));
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    const uid = (session as { user?: { id?: string } } | null)?.user?.id;
    if (!uid) return;
    setLoading(true);
    fetch(`/api/biz/sales-performance/${userId}?year=${year}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [(session as { user?: { id?: string } } | null)?.user?.id, userId, year]);

  const curYear = new Date().getFullYear();

  const activeMonths = MONTHS.map((_, i) => i).filter((mi) =>
    (data?.crossTab ?? []).some((r) => r.months[mi] > 0)
  );
  const displayMonths = activeMonths.length > 0 ? activeMonths : Array.from({ length: 12 }, (_, i) => i);

  if (status === "loading" || loading) {
    return (
      <BizLayout>
        <div className="flex items-center justify-center min-h-64 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />불러오는 중...
        </div>
      </BizLayout>
    );
  }

  return (
    <BizLayout>
      <div className="space-y-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/biz/sales-performance" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {data?.user.name || data?.user.email || "영업사원"} — 실적 상세
              </h1>
              <p className="text-sm text-gray-500">
                {data?.user.salesCode && <span className="mr-2 text-gray-400">{data.user.salesCode}</span>}
                {data?.user.email} · {year}년
              </p>
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

        {/* 크로스탭 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">제출현황 — 거래처 × 제약사 × 월별 처방금액</h2>
            <p className="text-xs text-gray-400 mt-0.5">처방금액 = 수량 × 단가</p>
          </div>
          {data && data.crossTab.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-500 font-semibold">
                  <tr>
                    <th className="px-4 py-2.5 text-left sticky left-0 bg-gray-50 z-10 min-w-[110px]">거래처</th>
                    <th className="px-4 py-2.5 text-left min-w-[100px]">제약사</th>
                    {displayMonths.map((mi) => (
                      <th key={mi} className="px-3 py-2.5 text-right min-w-[80px]">{MONTHS[mi]}</th>
                    ))}
                    <th className="px-4 py-2.5 text-right min-w-[100px] bg-gray-100">합계</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.crossTab.map((row, i) => {
                    const rowTotal = row.months.reduce((s, v) => s + v, 0);
                    return (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2 font-medium text-gray-700 sticky left-0 bg-white hover:bg-gray-50">{row.hospitalName}</td>
                        <td className="px-4 py-2 text-gray-600">{row.companyName}</td>
                        {displayMonths.map((mi) => (
                          <td key={mi} className="px-3 py-2 text-right tabular-nums text-gray-700">
                            {row.months[mi] > 0 ? row.months[mi].toLocaleString("ko-KR") : "-"}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-green-700 bg-gray-50">
                          {rowTotal > 0 ? rowTotal.toLocaleString("ko-KR") : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-100 font-bold border-t border-gray-200">
                  <tr>
                    <td className="px-4 py-2.5 text-gray-700 sticky left-0 bg-gray-100">합계</td>
                    <td className="px-4 py-2.5" />
                    {displayMonths.map((mi) => {
                      const colTotal = (data.crossTab ?? []).reduce((s, r) => s + r.months[mi], 0);
                      return (
                        <td key={mi} className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                          {colTotal > 0 ? colTotal.toLocaleString("ko-KR") : "-"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right tabular-nums text-green-700">
                      {(data.crossTab ?? []).reduce((s, r) => s + r.months.reduce((a, b) => a + b, 0), 0).toLocaleString("ko-KR")}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="p-10 text-center text-gray-400 text-sm">{year}년 제출 데이터가 없습니다</div>
          )}
        </div>

        {/* 품목별 상세 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-800">품목별 상세 내역</h2>
            <p className="text-xs text-gray-400 mt-0.5">거래처 / 제약사 / 품목 / 수량 / 처방금액 / 수수료</p>
          </div>
          {data && data.lineItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-gray-50 text-gray-500 font-semibold">
                  <tr>
                    <th className="px-4 py-2.5 text-left min-w-[60px]">월</th>
                    <th className="px-4 py-2.5 text-left min-w-[110px]">거래처</th>
                    <th className="px-4 py-2.5 text-left min-w-[100px]">제약사</th>
                    <th className="px-4 py-2.5 text-left min-w-[160px]">품목</th>
                    <th className="px-4 py-2.5 text-right min-w-[60px]">수량</th>
                    <th className="px-4 py-2.5 text-right min-w-[80px]">단가</th>
                    <th className="px-4 py-2.5 text-right min-w-[100px]">처방금액</th>
                    <th className="px-4 py-2.5 text-right min-w-[90px]">수수료</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.lineItems.map((item, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2 text-gray-500">{MONTHS[item.month - 1]}</td>
                      <td className="px-4 py-2 font-medium text-gray-700 max-w-[130px] truncate">{item.hospitalName}</td>
                      <td className="px-4 py-2 text-gray-600 max-w-[120px] truncate">{item.companyName}</td>
                      <td className="px-4 py-2 text-gray-700 max-w-[200px] truncate" title={item.productName}>{item.productName}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{item.quantity > 0 ? item.quantity.toLocaleString() : "-"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">{item.unitPrice > 0 ? item.unitPrice.toLocaleString() : "-"}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-gray-800">{item.prescription > 0 ? item.prescription.toLocaleString() : "-"}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-green-700">{item.fee > 0 ? item.fee.toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 font-bold border-t border-gray-200">
                  <tr>
                    <td colSpan={6} className="px-4 py-2.5 text-gray-700">합계</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-800">
                      {data.lineItems.reduce((s, i) => s + i.prescription, 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-green-700">
                      {data.lineItems.reduce((s, i) => s + i.fee, 0).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="p-10 text-center text-gray-400 text-sm">
              {year}년 품목 데이터가 없습니다
            </div>
          )}
        </div>
      </div>
    </BizLayout>
  );
}
