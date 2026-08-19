"use client";

import { useState, useEffect } from "react";
import { X, Factory } from "lucide-react";
import { formatPrice } from "@/lib/utils";

// 동일제조소 모달 — 식약처 "의약품 묶음정보" 기반으로 같은 제조소에서 생산되는
// 동일성분 제네릭 묶음을 보여준다. 우리 DB에 있는 품목은 약가/수수료를 함께 표시.
interface FactoryRow {
  groupKey: string;
  manufacturerName: string | null;
  itemName: string | null;
  entpName: string | null;
  ingredientName: string | null;
  itemSeq: string | null;
  medication: {
    id: string;
    price: number | null;
    commissionRate: number | null;
    additionalRate: number | null;
    insuranceCode: string | null;
    paymentType: string | null;
    isSettlement: boolean;
  } | null;
}

interface ApiResponse {
  rows: FactoryRow[];
  total: number;
  synced: boolean;
  lastSync: string | null;
  error?: string;
}

interface Props {
  productName: string;
  userId?: string;
  onClose: () => void;
}

function normalizeLoose(s: string): string {
  return s.replace(/\([^)]*\)/g, "").replace(/\s+/g, "").toLowerCase();
}

export default function SameFactoryModal({ productName, userId, onClose }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const uid = userId ? `&userId=${encodeURIComponent(userId)}` : "";
    fetch(`/api/medications/same-factory?productName=${encodeURIComponent(productName)}${uid}`)
      .then((r) => r.json())
      .then((d: ApiResponse) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("조회 중 오류가 발생했어요."))
      .finally(() => setLoading(false));
  }, [productName, userId]);

  // 제조소명 → 합계수수료 내림차순 정렬
  const rows = [...(data?.rows ?? [])].sort((a, b) => {
    const fa = a.manufacturerName ?? "￿", fb = b.manufacturerName ?? "￿";
    if (fa !== fb) return fa.localeCompare(fb);
    const ta = a.medication?.commissionRate != null ? a.medication.commissionRate + (a.medication.additionalRate ?? 0) : -1;
    const tb = b.medication?.commissionRate != null ? b.medication.commissionRate + (b.medication.additionalRate ?? 0) : -1;
    return tb - ta;
  });

  const selfKey = normalizeLoose(productName);
  const factoryCount = new Set(rows.map((r) => r.manufacturerName).filter(Boolean)).size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
              <Factory className="w-4 h-4 text-violet-600" />
              동일제조소 생산 의약품
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 break-all">
              {productName} · 식약처 묶음정보 기준
              {rows.length > 0 && ` · 제조소 ${factoryCount}곳 / ${rows.length}개 품목`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 shrink-0"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="flex justify-center py-16 text-gray-400 text-sm">검색 중...</div>
          ) : error ? (
            <div className="flex justify-center py-16 text-red-500 text-sm px-4 text-center">{error}</div>
          ) : !data?.synced ? (
            <div className="flex flex-col items-center gap-1 py-16 text-gray-400 text-sm px-4 text-center">
              <p>묶음정보가 아직 동기화되지 않았어요.</p>
              <p className="text-xs">관리자에게 문의해주세요.</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex justify-center py-16 text-gray-400 text-sm px-4 text-center">
              이 품목의 묶음정보(동일제조소 데이터)가 없어요.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold">
                <tr>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">제조소</th>
                  <th className="px-3 py-2.5 text-left">제품명 / 업체</th>
                  <th className="hidden sm:table-cell px-3 py-2.5 text-left">성분명</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">약가</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">기본수수료</th>
                  <th className="hidden sm:table-cell px-3 py-2.5 text-right whitespace-nowrap">추가</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">합계</th>
                  <th className="hidden sm:table-cell px-3 py-2.5 text-left whitespace-nowrap">보험코드</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => {
                  const med = r.medication;
                  const base = med?.commissionRate ?? null;
                  const extra = med?.additionalRate ?? null;
                  const total = base != null ? base + (extra ?? 0) : null;
                  const isSelf = r.itemName ? normalizeLoose(r.itemName) === selfKey : false;
                  const prevFactory = i > 0 ? rows[i - 1].manufacturerName : undefined;
                  const showFactory = i === 0 || r.manufacturerName !== prevFactory;
                  return (
                    <tr key={`${r.groupKey}|${r.itemSeq ?? r.itemName ?? i}`} className={isSelf ? "bg-violet-50/60" : "hover:bg-gray-50"}>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap align-top">
                        {showFactory ? (r.manufacturerName || "-") : <span className="text-gray-300">〃</span>}
                      </td>
                      <td className="px-3 py-2">
                        <p className={`leading-snug ${isSelf ? "font-bold text-violet-800" : "font-medium text-gray-900"}`}>
                          {r.itemName || "-"}
                          {isSelf && <span className="ml-1 text-[10px] text-violet-600 border border-violet-200 bg-violet-50 rounded px-1 py-0.5 align-middle">현재 품목</span>}
                        </p>
                        <p className="text-gray-400 mt-0.5">{r.entpName || "-"}</p>
                        <p className="sm:hidden text-gray-400 mt-0.5">{r.ingredientName || ""}</p>
                      </td>
                      <td className="hidden sm:table-cell px-3 py-2 text-gray-500">{r.ingredientName || "-"}</td>
                      {med ? (
                        <>
                          <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">{formatPrice(med.price)}</td>
                          <td className="px-3 py-2 text-right text-blue-600 font-medium whitespace-nowrap">{base != null ? `${base}%` : "-"}</td>
                          <td className="hidden sm:table-cell px-3 py-2 text-right text-gray-500 whitespace-nowrap">{extra != null ? `${extra}%` : "-"}</td>
                          <td className="px-3 py-2 text-right font-semibold text-blue-700 whitespace-nowrap">{total != null ? `${total}%` : "-"}</td>
                          <td className="hidden sm:table-cell px-3 py-2 font-mono text-gray-500 whitespace-nowrap">{med.insuranceCode || "-"}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="px-3 py-2 text-center">
                          <span className="text-[10px] text-gray-400 border border-gray-200 bg-gray-50 rounded px-1.5 py-0.5">우리 DB 미보유</span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-2 border-t bg-gray-50 text-[11px] text-gray-400 shrink-0 flex justify-between items-center">
          <span>출처: 식약처 의약품안전나라 제네릭의약품 묶음정보 (동일 제조소 · 동일 주성분)</span>
          {data?.lastSync && <span>동기화 {new Date(data.lastSync).toLocaleDateString("ko-KR")}</span>}
        </div>
      </div>
    </div>
  );
}
