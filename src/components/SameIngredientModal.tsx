"use client";

import { useState, useEffect } from "react";
import { X, ShoppingCart, ChevronUp, ChevronDown, ChevronsUpDown, RefreshCw, Loader2 } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import AddToProposalDialog from "./AddToProposalDialog";
import type { MedicationItem } from "@/types";

interface ReplaceContext {
  proposalId: string;
  itemId: string;
  originalProductName: string;
  onDone?: () => void;
}

interface SelectContext {
  originalProductName: string;
  onSelect: (med: MedicationItem) => void;
}

interface Props {
  ingredientName: string;
  categoryBCode?: string;
  userId?: string;
  onClose: () => void;
  initialCols?: Partial<ColVis>;
  /** 기존 제안서 항목을 대체할 때 넘겨받는 컨텍스트 (DB 업데이트) */
  replaceContext?: ReplaceContext;
  /** DB 저장 없이 단순 선택만 하는 모드 (클라이언트 state 용) */
  selectContext?: SelectContext;
}

type SortKey = "productName" | "price" | "commissionRate" | "additionalRate" | "totalRate" | "settlement";
type SortDir = "asc" | "desc";

interface ColVis {
  categoryB: boolean; bioStatus: boolean; originalDrug: boolean;
  insuranceCode: boolean; notes: boolean;
}

export default function SameIngredientModal({ ingredientName, categoryBCode, userId, onClose, initialCols, replaceContext, selectContext }: Props) {
  const [medications, setMedications] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [proposalTarget, setProposalTarget] = useState<MedicationItem | null>(null);
  const [replacingId, setReplacingId] = useState<string>("");
  const [replaceError, setReplaceError] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [cols, setCols] = useState<ColVis>({
    categoryB: initialCols?.categoryB ?? false,
    bioStatus: initialCols?.bioStatus ?? false,
    originalDrug: initialCols?.originalDrug ?? false,
    insuranceCode: initialCols?.insuranceCode ?? true,
    notes: initialCols?.notes ?? false,
  });

  async function replaceItem(med: MedicationItem) {
    if (!replaceContext) return;
    setReplaceError(""); setReplacingId(med.id);
    try {
      const res = await fetch(`/api/proposals/${replaceContext.proposalId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: replaceContext.itemId, newMedicationId: med.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (d.error === "already_exists") setReplaceError("이 품목은 이미 제안서에 있어요");
        else if (d.error === "same_medication") setReplaceError("원본과 동일한 품목이에요");
        else setReplaceError("대체 실패");
        return;
      }
      replaceContext.onDone?.();
      onClose();
    } finally {
      setReplacingId("");
    }
  }

  useEffect(() => {
    if (!categoryBCode) { setLoading(false); return; }
    const uid = userId ? `&userId=${userId}` : "";
    fetch(`/api/medications/search?categoryBCode=${encodeURIComponent(categoryBCode)}${uid}&limit=500`)
      .then((r) => r.json())
      .then((d) => { setMedications(d.medications || []); setTotal(d.total || 0); })
      .finally(() => setLoading(false));
  }, [categoryBCode, userId]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = [...medications].sort((a, b) => {
    if (!sortKey) return 0;
    const getVal = (m: MedicationItem) => {
      const base = m.commissionRate ?? 0;
      const extra = m.additionalRate ?? 0;
      const total = base + extra;
      if (sortKey === "price") return m.price ?? 0;
      if (sortKey === "commissionRate") return m.commissionRate ?? -1;
      if (sortKey === "additionalRate") return m.additionalRate ?? -1;
      if (sortKey === "totalRate") return (m.commissionRate != null ? total : -1);
      if (sortKey === "settlement") return m.price != null && m.commissionRate != null ? Math.round(m.price * total / 100) : -1;
      if (sortKey === "productName") return m.productName;
      return 0;
    };
    const va = getVal(a), vb = getVal(b);
    if (typeof va === "string" && typeof vb === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
  });

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronsUpDown className="w-3 h-3 inline ml-0.5 text-gray-300" />;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline ml-0.5 text-blue-500" /> : <ChevronDown className="w-3 h-3 inline ml-0.5 text-blue-500" />;
  }

  function SortTh({ label, k, right }: { label: string; k: SortKey; right?: boolean }) {
    return (
      <th onClick={() => toggleSort(k)} className={`px-4 py-3 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap ${right ? "text-right" : "text-left"}`}>
        {label}<SortIcon k={k} />
      </th>
    );
  }

  const hasRate = sorted.some((m) => m.commissionRate != null);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
            <div>
              <h2 className="font-bold text-gray-900">동일성분 검색</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {categoryBCode ? `주성분코드: ${categoryBCode}` : ingredientName} · 총 {total}개 품목
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
          </div>

          {/* 대체 모드 배너 */}
          {replaceContext && (
            <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 text-xs flex items-center justify-between">
              <div className="text-gray-700">
                <span className="font-semibold">대체 모드:</span>{" "}
                <span className="text-gray-500 line-through">{replaceContext.originalProductName}</span>{" "}
                을(를) 선택한 품목으로 교체합니다.
              </div>
              {replaceError && <span className="text-red-600">{replaceError}</span>}
            </div>
          )}
          {selectContext && !replaceContext && (
            <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-100 text-xs">
              <span className="font-semibold text-gray-700">대체품 선택 모드:</span>{" "}
              <span className="text-gray-500 line-through">{selectContext.originalProductName}</span>{" "}
              의 대체 품목을 선택하세요.
            </div>
          )}

          {/* 컬럼 토글 */}
          <div className="px-6 py-2 border-b bg-gray-50 flex flex-wrap gap-3 text-xs">
            {([
              ["categoryB", "분류B"],
              ["bioStatus", "생동/생산"],
              ["originalDrug", "오리지날"],
              ["insuranceCode", "보험코드"],
              ["notes", "특이사항"],
            ] as [keyof ColVis, string][]).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer text-gray-600">
                <input type="checkbox" checked={cols[key]} onChange={(e) => setCols((c) => ({ ...c, [key]: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded" />
                {label}
              </label>
            ))}
          </div>

          {/* 테이블 */}
          <div className="overflow-auto flex-1">
            {!categoryBCode ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-400 text-sm">
                <p>주성분코드 정보가 없어 동일성분 검색이 불가합니다.</p>
                <p className="text-xs text-gray-300">요율표 엑셀에 분류(B) 주성분코드를 포함해 업로드하면 검색됩니다.</p>
              </div>
            ) : loading ? (
              <div className="flex justify-center py-16 text-gray-400 text-sm">검색 중...</div>
            ) : sorted.length === 0 ? (
              <div className="flex justify-center py-16 text-gray-400 text-sm">결과가 없어요.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-xs text-gray-500 font-semibold">
                  <tr>
                    <SortTh label="제품명" k="productName" />
                    <th className="px-4 py-3 text-left">성분명</th>
                    <th className="px-4 py-3 text-left">제약사</th>
                    {cols.categoryB && <th className="px-4 py-3 text-center">분류B</th>}
                    {cols.bioStatus && <th className="px-4 py-3 text-center">생동/생산</th>}
                    {cols.originalDrug && <th className="px-4 py-3 text-center">오리지날</th>}
                    {cols.insuranceCode && <th className="px-4 py-3 text-left">보험코드</th>}
                    {cols.notes && <th className="px-4 py-3 text-left">특이사항</th>}
                    <th className="px-4 py-3 text-center">재고</th>
                    <SortTh label="약가" k="price" right />
                    {hasRate && (
                      <>
                        <SortTh label="기본수수료" k="commissionRate" right />
                        <SortTh label="추가수수료" k="additionalRate" right />
                        <SortTh label="합계수수료" k="totalRate" right />
                        <SortTh label="수수료금액" k="settlement" right />
                      </>
                    )}
                    <th className="px-4 py-3 text-center w-16">제안서</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sorted.map((med) => {
                    const base = med.commissionRate ?? null;
                    const extra = med.additionalRate ?? null;
                    const totalRate = base != null ? base + (extra ?? 0) : null;
                    const settlement = med.price != null && totalRate != null ? Math.round(med.price * totalRate / 100) : null;
                    return (
                      <tr key={med.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-gray-900 text-xs">
                            {med.productName}
                            {med.isSettlement && (med.settlementType === "원외" || med.settlementType === "원내") && (
                              <span className={`inline-block text-[10px] border px-1 py-0.5 rounded ml-1 align-middle ${
                                med.settlementType === "원외" ? "text-blue-700 bg-blue-50 border-blue-200" :
                                "text-indigo-700 bg-indigo-50 border-indigo-200"
                              }`}>
                                {med.settlementType === "원외" ? "cso" : "원내가능"}
                              </span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[140px] truncate">{med.ingredientName}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{med.companyName}</td>
                        {cols.categoryB && <td className="px-4 py-2.5 text-center text-xs text-gray-500">{med.categoryB || "-"}</td>}
                        {cols.bioStatus && <td className="px-4 py-2.5 text-center text-xs text-gray-500">{med.bioStatus || "-"}</td>}
                        {cols.originalDrug && <td className="px-4 py-2.5 text-center text-xs text-gray-500">{med.originalDrug || "-"}</td>}
                        {cols.insuranceCode && <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{med.insuranceCode || "-"}</td>}
                        {cols.notes && <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[100px] truncate">{med.notes || "-"}</td>}
                        <td className="px-4 py-2.5 text-center text-xs text-gray-400">-</td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-700 whitespace-nowrap">{formatPrice(med.price)}</td>
                        {hasRate && (
                          <>
                            <td className="px-4 py-2.5 text-right text-xs text-blue-600 font-medium">{base != null ? `${base}%` : "-"}</td>
                            <td className="px-4 py-2.5 text-right text-xs text-gray-500">{extra != null ? `${extra}%` : "-"}</td>
                            <td className="px-4 py-2.5 text-right text-xs font-semibold text-blue-700">{totalRate != null ? `${totalRate}%` : "-"}</td>
                            <td className="px-4 py-2.5 text-right text-xs font-semibold text-green-700 whitespace-nowrap">{settlement != null ? `${settlement.toLocaleString()}원` : "-"}</td>
                          </>
                        )}
                        <td className="px-4 py-2.5 text-center">
                          {selectContext ? (
                            <button onClick={() => { selectContext.onSelect(med); onClose(); }}
                              className="text-xs text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1 flex items-center gap-1 whitespace-nowrap mx-auto">
                              선택
                            </button>
                          ) : userId ? (
                            <div className="flex items-center gap-1 justify-center">
                              {replaceContext && (
                                <button onClick={() => replaceItem(med)}
                                  disabled={!!replacingId}
                                  className="text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded px-2 py-1 flex items-center gap-1 whitespace-nowrap">
                                  {replacingId === med.id
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <RefreshCw className="w-3 h-3" />}
                                  대체
                                </button>
                              )}
                              <button onClick={() => setProposalTarget(med)}
                                className="text-xs text-white bg-green-600 hover:bg-green-700 rounded px-2 py-1 flex items-center gap-1 whitespace-nowrap">
                                <ShoppingCart className="w-3 h-3" />추가
                              </button>
                            </div>
                          ) : <span className="text-xs text-gray-300">로그인 필요</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {proposalTarget && userId && (
        <AddToProposalDialog medication={proposalTarget} userId={userId} onClose={() => setProposalTarget(null)} />
      )}
    </>
  );
}
