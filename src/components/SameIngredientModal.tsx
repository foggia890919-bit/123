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
  ingredientCode?: string;
  userId?: string;
  onClose: () => void;
  initialCols?: Partial<ColVis>;
  replaceContext?: ReplaceContext;
  selectContext?: SelectContext;
}

type SortKey = "productName" | "price" | "commissionRate" | "additionalRate" | "totalRate" | "settlement";
type SortDir = "asc" | "desc";

interface ColVis {
  categoryB: boolean; bioStatus: boolean; originalDrug: boolean;
  insuranceCode: boolean; notes: boolean;
}

export default function SameIngredientModal({ ingredientName, ingredientCode, userId, onClose, initialCols, replaceContext, selectContext }: Props) {
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
    bioStatus: initialCols?.bioStatus ?? true,
    originalDrug: initialCols?.originalDrug ?? true,
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
        if (d.error === "already_exists") setReplaceError("이미 제안서에 있어요");
        else if (d.error === "same_medication") setReplaceError("원본과 동일해요");
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
    if (!ingredientCode && !ingredientName) { setLoading(false); return; }
    const uid = userId ? `&userId=${userId}` : "";
    const url = ingredientCode
      ? `/api/medications/search?ingredientCode=${encodeURIComponent(ingredientCode)}${uid}&limit=500`
      : `/api/medications/search?q=${encodeURIComponent(ingredientName)}${uid}&ingredientOnly=true&limit=500`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => { setMedications(d.medications || []); setTotal(d.total || 0); })
      .finally(() => setLoading(false));
  }, [ingredientCode, ingredientName, userId]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = [...medications].sort((a, b) => {
    if (!sortKey) return 0;
    const getVal = (m: MedicationItem) => {
      const base = m.commissionRate ?? 0;
      const extra = m.additionalRate ?? 0;
      if (sortKey === "price") return m.price ?? -1;
      if (sortKey === "commissionRate") return m.commissionRate ?? -1;
      if (sortKey === "additionalRate") return m.additionalRate ?? -1;
      if (sortKey === "totalRate") return m.commissionRate != null ? base + extra : -1;
      if (sortKey === "settlement") return m.price != null && m.commissionRate != null ? Math.round(m.price * (base + extra) / 100) : -1;
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
      <th onClick={() => toggleSort(k)} className={`px-2 py-2.5 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap text-xs ${right ? "text-right" : "text-left"}`}>
        {label}<SortIcon k={k} />
      </th>
    );
  }

  const hasRate = sorted.some((m) => m.commissionRate != null);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div>
              <h2 className="font-bold text-gray-900 text-sm">동일성분 검색</h2>
              <p className="text-xs text-gray-500 mt-0.5 break-all">
                {ingredientCode ? `주성분코드: ${ingredientCode}` : ingredientName} · 총 {total}개
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 shrink-0"><X className="w-5 h-5" /></button>
          </div>

          {/* 대체 모드 배너 */}
          {replaceContext && (
            <div className="px-4 py-2 bg-blue-50 border-b border-blue-100 text-xs flex items-center justify-between gap-2">
              <div className="text-gray-700 min-w-0">
                <span className="font-semibold">대체 모드:</span>{" "}
                <span className="text-gray-500 line-through truncate">{replaceContext.originalProductName}</span>{" "}
                을(를) 선택한 품목으로 교체
              </div>
              {replaceError && <span className="text-red-600 shrink-0">{replaceError}</span>}
            </div>
          )}
          {selectContext && !replaceContext && (
            <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 text-xs">
              <span className="font-semibold text-gray-700">대체품 선택 모드:</span>{" "}
              <span className="text-gray-500 line-through">{selectContext.originalProductName}</span>{" "}
              의 대체 품목을 선택하세요.
            </div>
          )}

          {/* 컬럼 토글 */}
          <div className="px-4 py-2 border-b bg-gray-50 flex flex-wrap gap-3 text-xs shrink-0">
            {([
              ["bioStatus", "생동/생산"],
              ["originalDrug", "오리지날"],
              ["insuranceCode", "보험코드"],
              ["categoryB", "분류B"],
              ["notes", "특이사항"],
            ] as [keyof ColVis, string][]).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer text-gray-600 select-none">
                <input type="checkbox" checked={cols[key]} onChange={(e) => setCols((c) => ({ ...c, [key]: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded" />
                {label}
              </label>
            ))}
          </div>

          {/* 테이블 */}
          <div className="overflow-auto flex-1">
            {!ingredientCode && !ingredientName ? (
              <div className="flex justify-center py-16 text-gray-400 text-sm">검색 정보가 없습니다.</div>
            ) : loading ? (
              <div className="flex justify-center py-16 text-gray-400 text-sm">검색 중...</div>
            ) : sorted.length === 0 ? (
              <div className="flex justify-center py-16 text-gray-400 text-sm">결과가 없어요.</div>
            ) : (
              <table className="text-xs" style={{ minWidth: "max-content", width: "100%" }}>
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold">
                  <tr>
                    <SortTh label="제품명" k="productName" />
                    <th className="px-2 py-2.5 text-left whitespace-nowrap">제약사</th>
                    {cols.bioStatus && <th className="px-2 py-2.5 text-left whitespace-nowrap">생동/생산</th>}
                    {cols.originalDrug && <th className="px-2 py-2.5 text-left whitespace-nowrap">오리지날</th>}
                    {cols.insuranceCode && <th className="px-2 py-2.5 text-left whitespace-nowrap">보험코드</th>}
                    {cols.categoryB && <th className="px-2 py-2.5 text-left whitespace-nowrap">분류B</th>}
                    {cols.notes && <th className="px-2 py-2.5 text-left whitespace-nowrap">특이사항</th>}
                    <SortTh label="약가" k="price" right />
                    {hasRate && (
                      <>
                        <SortTh label="기본수수료" k="commissionRate" right />
                        <SortTh label="추가수수료" k="additionalRate" right />
                        <SortTh label="합계" k="totalRate" right />
                        <SortTh label="정산금액" k="settlement" right />
                      </>
                    )}
                    <th className="px-2 py-2.5 text-center whitespace-nowrap">제안서</th>
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
                        <td className="px-2 py-2 min-w-[140px] max-w-[220px]">
                          <p className="font-medium text-gray-900 break-keep leading-tight">
                            {med.productName}
                            {med.isSettlement && (
                              <span className={`inline-block text-[9px] border px-1 py-0.5 rounded ml-1 align-middle ${
                                med.settlementType === "원외" ? "text-blue-700 bg-blue-50 border-blue-200" :
                                "text-indigo-700 bg-indigo-50 border-indigo-200"
                              }`}>
                                {med.settlementType === "원외" ? "cso" : "원내"}
                              </span>
                            )}
                          </p>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-gray-600">{med.companyName}</td>
                        {cols.bioStatus && <td className="px-2 py-2 whitespace-nowrap text-gray-500">{med.bioStatus || "-"}</td>}
                        {cols.originalDrug && <td className="px-2 py-2 whitespace-nowrap text-gray-500 max-w-[120px] truncate" title={med.originalDrug || ""}>{med.originalDrug || "-"}</td>}
                        {cols.insuranceCode && <td className="px-2 py-2 whitespace-nowrap font-mono text-gray-500">{med.insuranceCode || "-"}</td>}
                        {cols.categoryB && <td className="px-2 py-2 whitespace-nowrap text-gray-500">{med.categoryB || "-"}</td>}
                        {cols.notes && <td className="px-2 py-2 text-gray-500 max-w-[100px] truncate" title={med.notes || ""}>{med.notes || "-"}</td>}
                        <td className="px-2 py-2 text-right whitespace-nowrap text-gray-700">{formatPrice(med.price)}</td>
                        {hasRate && (
                          <>
                            <td className="px-2 py-2 text-right whitespace-nowrap text-blue-600 font-medium">{base != null ? `${base}%` : "-"}</td>
                            <td className="px-2 py-2 text-right whitespace-nowrap text-gray-500">{extra != null ? `${extra}%` : "-"}</td>
                            <td className="px-2 py-2 text-right whitespace-nowrap font-semibold text-blue-700">{totalRate != null ? `${totalRate}%` : "-"}</td>
                            <td className="px-2 py-2 text-right whitespace-nowrap font-semibold text-green-700">{settlement != null ? `${settlement.toLocaleString()}원` : "-"}</td>
                          </>
                        )}
                        <td className="px-2 py-2 text-center">
                          {selectContext ? (
                            <button onClick={() => { selectContext.onSelect(med); onClose(); }}
                              className="text-white bg-emerald-600 hover:bg-emerald-700 rounded px-2 py-1 whitespace-nowrap">
                              선택
                            </button>
                          ) : userId ? (
                            <div className="flex items-center gap-1 justify-center">
                              {replaceContext && (
                                <button onClick={() => replaceItem(med)} disabled={!!replacingId}
                                  className="text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded px-2 py-1 flex items-center gap-1 whitespace-nowrap">
                                  {replacingId === med.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                  대체
                                </button>
                              )}
                              <button onClick={() => setProposalTarget(med)}
                                className="text-white bg-green-600 hover:bg-green-700 rounded px-2 py-1 flex items-center gap-1 whitespace-nowrap">
                                <ShoppingCart className="w-3 h-3" />추가
                              </button>
                            </div>
                          ) : <span className="text-gray-300 whitespace-nowrap">로그인 필요</span>}
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
