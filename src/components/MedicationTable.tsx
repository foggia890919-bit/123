"use client";

import { useState } from "react";
import { ShoppingCart, Search } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type { MedicationItem } from "@/types";
import SameIngredientModal from "./SameIngredientModal";
import AddToProposalDialog from "./AddToProposalDialog";

export interface ColumnVisibility {
  showCategoryB?: boolean;
  showBioStatus?: boolean;
  showOriginalDrug?: boolean;
  showInsuranceCode?: boolean;
  showNotes?: boolean;
  showStock?: boolean;
  showRate?: boolean;
}

interface Props extends ColumnVisibility {
  medications: MedicationItem[];
  loading?: boolean;
  userId?: string;
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
  if (type === "원외") return <span className="inline-block text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-1 py-0.5 rounded ml-1 align-middle">정산·원외</span>;
  if (type === "원내") return <span className="inline-block text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-1 py-0.5 rounded ml-1 align-middle">정산·원내</span>;
  return <span className="inline-block text-[10px] text-green-700 bg-green-50 border border-green-200 px-1 py-0.5 rounded ml-1 align-middle">정산</span>;
}

export default function MedicationTable({ medications, loading, userId, showCategoryB, showBioStatus, showOriginalDrug, showInsuranceCode, showNotes, showStock, showRate }: Props) {
  const [ingredientModal, setIngredientModal] = useState<{ name: string; categoryB?: string | null } | null>(null);
  const [proposalTarget, setProposalTarget] = useState<MedicationItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTargets, setBulkTargets] = useState<MedicationItem[] | null>(null);

  const allSelected = medications.length > 0 && medications.every((m) => selectedIds.has(m.id));
  const someSelected = medications.some((m) => selectedIds.has(m.id));

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

  if (loading) return <div className="flex justify-center py-16 text-gray-400 text-sm">검색 중...</div>;
  if (medications.length === 0) return <div className="flex justify-center py-16 text-gray-400 text-sm">검색 결과가 없어요.</div>;

  const selectedCount = medications.filter((m) => selectedIds.has(m.id)).length;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 font-semibold">
              <th className="px-3 py-3 text-center w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                  aria-label="전체 선택"
                />
              </th>
              <th className="px-4 py-3 text-left">제약사</th>
              <th className="px-4 py-3 text-left">제품명</th>
              <th className="px-4 py-3 text-left">성분명</th>
              <th className="px-4 py-3 text-center w-28"></th>
              {showCategoryB && <th className="px-4 py-3 text-center">분류B</th>}
              {showBioStatus && <th className="px-4 py-3 text-center">생동/생산</th>}
              {showOriginalDrug && <th className="px-4 py-3 text-center">오리지날</th>}
              {showInsuranceCode && <th className="px-4 py-3 text-left">보험코드</th>}
              {showNotes && <th className="px-4 py-3 text-left">특이사항</th>}
              {showStock && <th className="px-4 py-3 text-center">재고</th>}
              <th className="px-4 py-3 text-right">약가</th>
              {showRate && (
                <>
                  <th className="px-4 py-3 text-right">기본수수료</th>
                  <th className="px-4 py-3 text-right">추가수수료</th>
                  <th className="px-4 py-3 text-right">합계수수료</th>
                  <th className="px-4 py-3 text-right">정산금액</th>
                </>
              )}
              <th className="px-4 py-3 text-center w-36">
                <button
                  onClick={openBulkAdd}
                  disabled={selectedCount === 0 || !userId}
                  className="text-xs text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed rounded px-2 py-1.5 inline-flex items-center gap-1 transition-colors"
                >
                  <ShoppingCart className="w-3 h-3" />
                  체크품목 제안서 추가{selectedCount > 0 ? ` (${selectedCount})` : ""}
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {medications.map((med) => (
              <tr key={med.id} className={`hover:bg-gray-50 transition-colors ${selectedIds.has(med.id) ? "bg-blue-50/40" : ""}`}>
                <td className="px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(med.id)}
                    onChange={() => toggleOne(med.id)}
                    className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                    aria-label={`${med.productName} 선택`}
                  />
                </td>
                <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{med.companyName}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">
                    {med.productName}
                    <SettlementBadge med={med} />
                  </p>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  <IngredientName name={med.ingredientName} />
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => setIngredientModal({ name: med.ingredientName, categoryB: med.categoryB })}
                    className="text-xs text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded px-2 py-1 whitespace-nowrap transition-colors">
                    <Search className="w-3 h-3 inline mr-1" />동일성분
                  </button>
                </td>
                {showCategoryB && <td className="px-4 py-3 text-center text-xs text-gray-500">{med.categoryB || "-"}</td>}
                {showBioStatus && <td className="px-4 py-3 text-center text-xs text-gray-500">{med.bioStatus || "-"}</td>}
                {showOriginalDrug && <td className="px-4 py-3 text-center text-xs text-gray-500">{med.originalDrug || "-"}</td>}
                {showInsuranceCode && <td className="px-4 py-3 text-xs font-mono text-gray-500">{med.insuranceCode || "-"}</td>}
                {showNotes && <td className="px-4 py-3 text-xs text-gray-500 max-w-[120px] truncate">{med.notes || "-"}</td>}
                {showStock && <td className="px-4 py-3 text-center text-xs text-gray-400">-</td>}
                <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">{formatPrice(med.price)}</td>
                {showRate && (() => {
                  const base = med.commissionRate ?? null;
                  const extra = med.additionalRate ?? null;
                  const total = base != null ? base + (extra ?? 0) : null;
                  const settlement = med.price != null && total != null ? Math.round(med.price * total / 100) : null;
                  return (
                    <>
                      <td className="px-4 py-3 text-right text-blue-600 font-medium whitespace-nowrap">{base != null ? `${base}%` : "-"}</td>
                      <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">{extra != null ? `${extra}%` : "-"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-blue-700 whitespace-nowrap">{total != null ? `${total}%` : "-"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-green-700 whitespace-nowrap">{settlement != null ? `${settlement.toLocaleString()}원` : "-"}</td>
                    </>
                  );
                })()}
                <td className="px-4 py-3 text-center">
                  {userId ? (
                    <button onClick={() => setProposalTarget(med)}
                      className="text-xs text-white bg-green-600 hover:bg-green-700 rounded px-3 py-1.5 whitespace-nowrap transition-colors flex items-center gap-1 mx-auto">
                      <ShoppingCart className="w-3 h-3" />제안서 추가
                    </button>
                  ) : (
                    <span className="text-xs text-gray-300">로그인 필요</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ingredientModal && (
        <SameIngredientModal
          ingredientName={ingredientModal.name}
          categoryBCode={ingredientModal.categoryB ?? undefined}
          userId={userId}
          onClose={() => setIngredientModal(null)}
          initialCols={{
            categoryB: showCategoryB,
            bioStatus: showBioStatus,
            originalDrug: showOriginalDrug,
            insuranceCode: showInsuranceCode,
            notes: showNotes,
          }}
        />
      )}

      {proposalTarget && userId && (
        <AddToProposalDialog
          medication={proposalTarget}
          userId={userId}
          onClose={() => setProposalTarget(null)}
        />
      )}

      {bulkTargets && userId && (
        <AddToProposalDialog
          medications={bulkTargets}
          userId={userId}
          onClose={() => { setBulkTargets(null); setSelectedIds(new Set()); }}
        />
      )}
    </>
  );
}
