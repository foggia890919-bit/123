"use client";

import { useState, useEffect, Suspense, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft, Search, X } from "lucide-react";

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
function fmt(n: number) { return n > 0 ? n.toLocaleString("ko-KR") + "원" : "-"; }

interface CrossRow { hospitalName: string; companyName: string; months: number[]; }
interface LineItem { hospitalName: string; companyName: string; productName: string; month: number; quantity: number; unitPrice: number; prescription: number; fee: number; }
interface DetailData { year: number; crossTab: CrossRow[]; lineItems: LineItem[]; isUpperCorp?: boolean; }

function DetailContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const year = parseInt(params.get("year") ?? String(new Date().getFullYear()));

  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [hospitalQuery, setHospitalQuery] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    const uid = (session as { user?: { id?: string } } | null)?.user?.id;
    if (!uid) return;
    setLoading(true);
    fetch(`/api/mypage/performance/detail?year=${year}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [(session as { user?: { id?: string } } | null)?.user?.id, year]); // eslint-disable-line

  // 데이터가 있는 월만 필터 버튼으로 표시
  const activeMonthIndexes = useMemo(() =>
    MONTHS.map((_, i) => i).filter((mi) =>
      (data?.crossTab ?? []).some((r) => r.months[mi] > 0)
    ), [data]);

  // 크로스탭: 선택된 월만, 거래처 검색 적용
  const filteredCrossTab = useMemo(() => {
    const q = hospitalQuery.trim().toLowerCase();
    return (data?.crossTab ?? []).filter((r) =>
      (!q || r.hospitalName.toLowerCase().includes(q) || r.companyName.toLowerCase().includes(q))
    );
  }, [data, hospitalQuery]);

  const displayMonths = selectedMonth !== null
    ? [selectedMonth]
    : (activeMonthIndexes.length > 0 ? activeMonthIndexes : Array.from({ length: 12 }, (_, i) => i));

  // 품목 라인: 월 + 거래처 검색 적용
  const filteredLineItems = useMemo(() => {
    const q = hospitalQuery.trim().toLowerCase();
    return (data?.lineItems ?? []).filter((item) =>
      (selectedMonth === null || item.month === selectedMonth + 1) &&
      (!q || item.hospitalName.toLowerCase().includes(q) || item.companyName.toLowerCase().includes(q))
    );
  }, [data, selectedMonth, hospitalQuery]);

  const corpLabel = data?.isUpperCorp ? "법인" : "거래처";

  if (status === "loading" || loading) {
    return <div className="flex items-center justify-center min-h-64 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />불러오는 중...</div>;
  }

  return (
    <div className="max-w-screen-lg mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <Link href="/mypage/performance" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">실적 상세보기</h1>
          <p className="text-sm text-gray-500">{year}년 처방통계 제출 현황 및 품목별 내역</p>
        </div>
      </div>

      {/* 필터 바 */}
      {data && (data.crossTab.length > 0 || data.lineItems.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3">
          {/* 월 필터 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400 mr-0.5">월</span>
            <button
              onClick={() => setSelectedMonth(null)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${selectedMonth === null ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >전체</button>
            {activeMonthIndexes.map((mi) => (
              <button
                key={mi}
                onClick={() => setSelectedMonth(selectedMonth === mi ? null : mi)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${selectedMonth === mi ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >{MONTHS[mi]}</button>
            ))}
          </div>
          {/* 거래처 검색 */}
          <div className="relative ml-auto min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={hospitalQuery}
              onChange={(e) => setHospitalQuery(e.target.value)}
              placeholder={`${corpLabel} 또는 제약사 검색`}
              className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
            {hospitalQuery && (
              <button onClick={() => setHospitalQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 크로스탭 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">
            {data?.isUpperCorp ? "제출현황 — 법인 × 제약사 × 월별 처방금액" : "제출현황 — 거래처 × 제약사 × 월별 처방금액"}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">처방금액 = 수량 × 단가</p>
        </div>
        {filteredCrossTab.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-500 font-semibold">
                <tr>
                  <th className="px-4 py-2.5 text-left sticky left-0 bg-gray-50 z-10 min-w-[110px]">{corpLabel}</th>
                  <th className="px-4 py-2.5 text-left min-w-[100px]">제약사</th>
                  {displayMonths.map((mi) => (
                    <th key={mi} className="px-3 py-2.5 text-right min-w-[80px]">{MONTHS[mi]}</th>
                  ))}
                  <th className="px-4 py-2.5 text-right min-w-[100px] bg-gray-100">합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCrossTab.map((row, i) => {
                  const rowTotal = selectedMonth !== null
                    ? row.months[selectedMonth]
                    : row.months.reduce((s, v) => s + v, 0);
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
                    const colTotal = filteredCrossTab.reduce((s, r) => s + r.months[mi], 0);
                    return (
                      <td key={mi} className="px-3 py-2.5 text-right tabular-nums text-gray-800">
                        {colTotal > 0 ? colTotal.toLocaleString("ko-KR") : "-"}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-right tabular-nums text-green-700">
                    {filteredCrossTab.reduce((s, r) =>
                      s + (selectedMonth !== null ? r.months[selectedMonth] : r.months.reduce((a, b) => a + b, 0)), 0
                    ).toLocaleString("ko-KR")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-gray-400 text-sm">
            {hospitalQuery ? `"${hospitalQuery}" 검색 결과가 없습니다` : `${year}년 제출 데이터가 없습니다`}
          </div>
        )}
      </div>

      {/* 품목별 상세 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">품목별 상세 내역</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {data?.isUpperCorp ? "법인별 합산 — 법인 / 제약사 / 수량 / 처방금액" : "처방통계에 인식된 약품 기준 — 거래처 / 제약사 / 품목 / 수량 / 처방금액"}
            </p>
          </div>
          {filteredLineItems.length > 0 && (
            <span className="text-xs text-gray-400">{filteredLineItems.length}건</span>
          )}
        </div>
        {filteredLineItems.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-500 font-semibold">
                <tr>
                  <th className="px-4 py-2.5 text-left min-w-[60px]">월</th>
                  <th className="px-4 py-2.5 text-left min-w-[110px]">{corpLabel}</th>
                  <th className="px-4 py-2.5 text-left min-w-[100px]">제약사</th>
                  <th className="px-4 py-2.5 text-left min-w-[160px]">품목</th>
                  <th className="px-4 py-2.5 text-right min-w-[60px]">수량</th>
                  <th className="px-4 py-2.5 text-right min-w-[80px]">단가</th>
                  <th className="px-4 py-2.5 text-right min-w-[100px]">처방금액</th>
                  <th className="px-4 py-2.5 text-right min-w-[90px]">수수료</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredLineItems.map((item, i) => (
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
                    {filteredLineItems.reduce((s, i) => s + i.prescription, 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-green-700">
                    {filteredLineItems.reduce((s, i) => s + i.fee, 0).toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-gray-400 text-sm">
            {hospitalQuery || selectedMonth !== null
              ? "조건에 맞는 데이터가 없습니다"
              : <>{year}년 품목 데이터가 없습니다<br /><span className="text-xs">처방통계에 약품이 인식된 경우에만 표시됩니다</span></>
            }
          </div>
        )}
      </div>
    </div>
  );
}

export default function DetailPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-64 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />불러오는 중...</div>}>
      <DetailContent />
    </Suspense>
  );
}
