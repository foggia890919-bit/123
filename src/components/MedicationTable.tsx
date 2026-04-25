"use client";

import { useState, useEffect, Fragment } from "react";
import { ShoppingCart, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type { MedicationItem } from "@/types";
import SameIngredientModal from "./SameIngredientModal";
import AddToProposalDialog from "./AddToProposalDialog";

type SortKey = "productName" | "price" | "commissionRate" | "additionalRate" | "totalRate" | "settlement";
type SortDir = "asc" | "desc";

export interface ColumnVisibility {
  showCategoryA?: boolean;
  showIngredientName?: boolean;
  showCategoryB?: boolean;
  showRate?: boolean;
  showCompanyName?: boolean;
  showBioStatus?: boolean;
  showProductName?: boolean;
  showPrice?: boolean;
  showOriginalDrug?: boolean;
  showInsuranceCode?: boolean;
  showNotes?: boolean;
  showStock?: boolean;
}

interface Props extends ColumnVisibility {
  medications: MedicationItem[];
  loading?: boolean;
  userId?: string;
}

const DOSE_RE = /^(.+?)\s+(\d[\d.,/]*\s*(?:mg|mcg|μg|ug|g|ml|mL|IU|iu|%|mEq)[^\s]*.*)$/i;

function splitDose(name: string): [string, string | null] {
  const m = name.match(DOSE_RE);
  return m ? [m[1], m[2]] : [name, null];
}

function ProductName({ name }: { name: string }) {
  const [base, dose] = splitDose(name);
  if (!dose) return <span>{name}</span>;
  return (
    <span>
      {base}
      <span className="block text-[11px] font-normal text-gray-400 mt-0.5">{dose}</span>
    </span>
  );
}

function IngredientName({ name }: { name: string }) {
  const parts = name.split("/").map((p) => p.trim());
  if (parts.length <= 1) return <span>{name}</span>;
  return (
    <span>
      {parts.map((part, i) => (
        <span key={i}>
          {part}{i < parts.length - 1 ? " /" : ""}
          {i < parts.length - 1 && <br />}
        </span>
      ))}
    </span>
  );
}

function SettlementBadge({ med }: { med: MedicationItem }) {
  if (!med.isSettlement) return null;
  const type = med.settlementType;
  if (type === "원외") return <span className="inline-block text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-1 py-0.5 rounded ml-1 align-middle">cso</span>;
  if (type === "원내") return <span className="inline-block text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-1 py-0.5 rounded ml-1 align-middle">원내가능</span>;
  return null;
}

export default function MedicationTable({ medications, loading, userId, showCategoryA, showIngredientName, showCategoryB, showRate, showBioStatus, showPrice, showOriginalDrug, showInsuranceCode, showNotes, showStock }: Props) {
  const [ingredientModal, setIngredientModal] = useState<{ name: string; categoryB?: string | null } | null>(null);
  const [proposalTarget, setProposalTarget] = useState<MedicationItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTargets, setBulkTargets] = useState<MedicationItem[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const allSelected = medications.length > 0 && medications.every((m) => selectedIds.has(m.id));
  const someSelected = medications.some((m) => selectedIds.has(m.id));
  const selectedCount = medications.filter((m) => selectedIds.has(m.id)).length;

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      medications.forEach((m) => next.add(m.id));
      return next;
    });
  }

  function openBulkAdd() {
    const selected = medications.filter((m) => selectedIds.has(m.id));
    if (selected.length === 0) return;
    setBulkTargets(selected);
  }

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = [...medications].sort((a, b) => {
    if (!sortKey) return 0;
    const getVal = (m: MedicationItem): string | number => {
      const base = m.commissionRate ?? 0;
      const extra = m.additionalRate ?? 0;
      if (sortKey === "productName") return m.productName;
      if (sortKey === "price") return m.price ?? -1;
      if (sortKey === "commissionRate") return m.commissionRate ?? -1;
      if (sortKey === "additionalRate") return m.additionalRate ?? -1;
      if (sortKey === "totalRate") return m.commissionRate != null ? base + extra : -1;
      if (sortKey === "settlement") return m.price != null && m.commissionRate != null ? Math.round(m.price * (base + extra) / 100) : -1;
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

  function SortTh({ label, k }: { label: string; k: SortKey }) {
    return (
      <th onClick={() => toggleSort(k)} className="px-1.5 py-2 text-right cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap">
        {label}<SortIcon k={k} />
      </th>
    );
  }

  if (loading) return <div className="flex justify-center py-16 text-gray-400 text-sm">검색 중...</div>;
  if (medications.length === 0) return <div className="flex justify-center py-16 text-gray-400 text-sm">검색 결과가 없어요.</div>;

  const hasDetailPanel = showIngredientName || showBioStatus || showOriginalDrug || showInsuranceCode || showCategoryA || showCategoryB || showNotes;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-[11px] text-gray-500 font-semibold">
              <th className="px-2 py-1.5 text-center w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 rounded border-gray-300 cursor-pointer"
                  aria-label="전체 선택/해제"
                  title="전체 선택 / 전체 해제"
                />
              </th>
              <th onClick={() => toggleSort("productName")} className="px-2 py-2 text-left cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap">
                제품명 / 제약사 <SortIcon k="productName" />
              </th>
              {showStock && <th className="px-2 py-2 text-right whitespace-nowrap">재고</th>}
              <th className="px-1.5 py-2 w-20" />
              {showPrice && <SortTh label="약가" k="price" />}
              {showRate && (
                <>
                  <SortTh label="기본수수료" k="commissionRate" />
                  <SortTh label="추가수수료" k="additionalRate" />
                  <SortTh label="합계" k="totalRate" />
                  <SortTh label="정산금액" k="settlement" />
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((med) => {
              const isExpanded = expandedRows.has(med.id);
              const isSelected = selectedIds.has(med.id);
              const base = med.commissionRate ?? null;
              const extra = med.additionalRate ?? null;
              const total = base != null ? base + (extra ?? 0) : null;
              const settlement = med.price != null && total != null ? Math.round(med.price * total / 100) : null;

              return (
                <Fragment key={med.id}>
                  <tr className={`transition-colors ${isSelected ? "bg-blue-50/40" : "hover:bg-gray-50"}`}>
                    {/* 체크박스 */}
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(med.id)}
                        className="w-3.5 h-3.5 rounded border-gray-300 cursor-pointer"
                        aria-label={`${med.productName} 선택`}
                      />
                    </td>

                    {/* 제품명 + 펼침 버튼 */}
                    <td className="px-2 py-1.5">
                      <div className="flex items-start gap-1">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 leading-snug">
                            <ProductName name={med.productName} />
                            <SettlementBadge med={med} />
                          </p>
                          <p className="text-[11px] text-gray-500 mt-0.5">{med.companyName}</p>
                        </div>
                        {hasDetailPanel && (
                          <button
                            type="button"
                            onClick={() => toggleRow(med.id)}
                            className="shrink-0 p-1.5 -mr-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors mt-0.5"
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 재고 */}
                    {showStock && (
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {med.stock != null
                          ? <span className={med.stock > 0 ? "text-green-700 font-medium" : "text-red-500"}>{med.stock > 0 ? med.stock.toLocaleString() : "품절"}</span>
                          : <span className="text-gray-300">-</span>}
                      </td>
                    )}

                    {/* 액션 버튼 (재고 뒤, 약가 앞) */}
                    <td className="px-1.5 py-1.5">
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => userId ? setProposalTarget(med) : undefined}
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap transition-colors ${userId ? "text-green-700 hover:bg-green-50" : "text-gray-300 cursor-not-allowed"}`}
                        >
                          제안서추가
                        </button>
                        <button
                          type="button"
                          onClick={() => setIngredientModal({ name: med.ingredientName, categoryB: med.ingredientCode ?? null })}
                          className="text-[10px] font-medium text-blue-600 hover:bg-blue-50 px-1.5 py-0.5 rounded whitespace-nowrap transition-colors"
                        >
                          동일성분
                        </button>
                      </div>
                    </td>

                    {/* 약가 */}
                    {showPrice && (
                      <td className="px-1.5 py-1.5 text-right text-gray-700 whitespace-nowrap">{formatPrice(med.price)}</td>
                    )}
                    {showRate && (
                      <>
                        <td className="px-1.5 py-1.5 text-right text-blue-600 font-medium whitespace-nowrap">{base != null ? `${base}%` : "-"}</td>
                        <td className="px-1.5 py-1.5 text-right text-gray-500 whitespace-nowrap">{extra != null ? `${extra}%` : "-"}</td>
                        <td className="px-1.5 py-1.5 text-right font-semibold text-blue-700 whitespace-nowrap">{total != null ? `${total}%` : "-"}</td>
                        <td className="px-1.5 py-1.5 text-right font-semibold text-green-700 whitespace-nowrap">{settlement != null ? `${settlement.toLocaleString()}원` : "-"}</td>
                      </>
                    )}
                  </tr>

                  {isExpanded && hasDetailPanel && (
                    <tr className={isSelected ? "bg-blue-50/30" : "bg-gray-50/60"}>
                      <td />
                      <td colSpan={1 + (showStock ? 1 : 0) + 1 + (showPrice ? 1 : 0) + (showRate ? 4 : 0)} className="px-4 pb-3 pt-1">
                        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5 text-xs">
                          {showIngredientName && (
                            <div className="col-span-2 sm:col-span-3">
                              <p className="text-gray-400 mb-0.5">성분명</p>
                              <p className="text-gray-700"><IngredientName name={med.ingredientName} /></p>
                            </div>
                          )}
                          {showBioStatus && (
                            <div>
                              <p className="text-gray-400 mb-0.5">생동/생산</p>
                              <p className="text-gray-700">{med.bioStatus || "-"}</p>
                            </div>
                          )}
                          {showOriginalDrug && (
                            <div>
                              <p className="text-gray-400 mb-0.5">오리지날/대조약</p>
                              <p className="text-gray-700">{med.originalDrug || "-"}</p>
                            </div>
                          )}
                          {showInsuranceCode && (
                            <div>
                              <p className="text-gray-400 mb-0.5">보험코드</p>
                              <p className="font-mono text-gray-700">{med.insuranceCode || "-"}</p>
                            </div>
                          )}
                          {showCategoryA && (
                            <div>
                              <p className="text-gray-400 mb-0.5">분류(A)</p>
                              <p className="text-gray-700">{med.categoryA || "-"}</p>
                            </div>
                          )}
                          {showCategoryB && (
                            <div>
                              <p className="text-gray-400 mb-0.5">ATC코드</p>
                              <p className="text-gray-700 font-mono">{med.ingredientCode || "-"}</p>
                            </div>
                          )}
                          {showNotes && (
                            <div className="col-span-2 sm:col-span-3">
                              <p className="text-gray-400 mb-0.5">특이사항</p>
                              <p className="text-gray-700">{med.notes || "-"}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 하단 고정 제안서 추가 바 — 항상 표시 */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg px-4 py-3 flex justify-center">
        <button
          onClick={openBulkAdd}
          disabled={!userId || selectedCount === 0}
          className={`text-sm rounded-lg px-5 py-2.5 inline-flex items-center gap-2 font-medium transition-all ${
            selectedCount > 0 && userId
              ? "text-white bg-green-600 hover:bg-green-700 shadow"
              : "text-gray-400 bg-gray-100 cursor-default"
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          {selectedCount > 0
            ? `체크 ${selectedCount}개 제안서에 추가`
            : "제품을 선택하면 제안서에 추가할 수 있어요"}
        </button>
      </div>
      {/* 고정 바 높이만큼 여백 */}
      <div className="h-16" />

      {ingredientModal && (
        <SameIngredientModal
          ingredientName={ingredientModal.name}
          ingredientCode={ingredientModal.categoryB ?? undefined}
          userId={userId}
          onClose={() => setIngredientModal(null)}
          initialCols={{ categoryB: false, bioStatus: true, originalDrug: true, insuranceCode: true, notes: false }}
        />
      )}

      {proposalTarget && userId && (
        <AddToProposalDialog medication={proposalTarget} userId={userId} onClose={() => setProposalTarget(null)} />
      )}

      {bulkTargets && userId && (
        <AddToProposalDialog medications={bulkTargets} userId={userId} onClose={() => { setBulkTargets(null); setSelectedIds(new Set()); }} />
      )}
    </>
  );
}
