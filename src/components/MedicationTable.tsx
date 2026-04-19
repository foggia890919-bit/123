"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { ShoppingCart, Search, ChevronUp, ChevronDown, ChevronsUpDown, Filter } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type { MedicationItem } from "@/types";
import SameIngredientModal from "./SameIngredientModal";
import AddToProposalDialog from "./AddToProposalDialog";

type SortKey = "productName" | "companyName" | "price" | "commissionRate" | "additionalRate" | "totalRate" | "settlement";
type SortDir = "asc" | "desc";

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
  if (type === "원외") return <span className="inline-block text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-1 py-0.5 rounded ml-1 align-middle">cso</span>;
  if (type === "원내") return <span className="inline-block text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-200 px-1 py-0.5 rounded ml-1 align-middle">원내가능</span>;
  return null;
}

export default function MedicationTable({ medications, loading, userId, showCategoryB, showBioStatus, showOriginalDrug, showNotes, showRate }: Props) {
  const [ingredientModal, setIngredientModal] = useState<{ name: string; categoryB?: string | null } | null>(null);
  const [proposalTarget, setProposalTarget] = useState<MedicationItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTargets, setBulkTargets] = useState<MedicationItem[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [companyFilter, setCompanyFilter] = useState<Set<string>>(new Set());
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [companyQuery, setCompanyQuery] = useState("");
  const companyMenuRef = useRef<HTMLDivElement>(null);

  const companies = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of medications) counts.set(m.companyName, (counts.get(m.companyName) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [medications]);

  const filteredMedications = useMemo(() => {
    if (companyFilter.size === 0) return medications;
    return medications.filter((m) => companyFilter.has(m.companyName));
  }, [medications, companyFilter]);

  useEffect(() => {
    if (!companyMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (companyMenuRef.current && !companyMenuRef.current.contains(e.target as Node)) setCompanyMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [companyMenuOpen]);

  const allSelected = filteredMedications.length > 0 && filteredMedications.every((m) => selectedIds.has(m.id));
  const someSelected = filteredMedications.some((m) => selectedIds.has(m.id));

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        filteredMedications.forEach((m) => next.delete(m.id));
        return next;
      }
      const next = new Set(prev);
      filteredMedications.forEach((m) => next.add(m.id));
      return next;
    });
  }

  function openBulkAdd() {
    const selected = filteredMedications.filter((m) => selectedIds.has(m.id));
    if (selected.length === 0) return;
    setBulkTargets(selected);
  }

  function toggleCompany(name: string) {
    setCompanyFilter((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }
  function selectAllCompanies() { setCompanyFilter(new Set(companies.map(([n]) => n))); }
  function clearCompanies() { setCompanyFilter(new Set()); }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = [...filteredMedications].sort((a, b) => {
    if (!sortKey) return 0;
    const getVal = (m: MedicationItem): string | number => {
      const base = m.commissionRate ?? 0;
      const extra = m.additionalRate ?? 0;
      const total = base + extra;
      if (sortKey === "productName") return m.productName;
      if (sortKey === "companyName") return m.companyName;
      if (sortKey === "price") return m.price ?? 0;
      if (sortKey === "commissionRate") return m.commissionRate ?? -1;
      if (sortKey === "additionalRate") return m.additionalRate ?? -1;
      if (sortKey === "totalRate") return m.commissionRate != null ? total : -1;
      if (sortKey === "settlement") return m.price != null && m.commissionRate != null ? Math.round(m.price * total / 100) : -1;
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

  function SortTh({ label, k, right, className }: { label: string; k: SortKey; right?: boolean; className?: string }) {
    return (
      <th onClick={() => toggleSort(k)} className={`px-4 py-3 cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap ${right ? "text-right" : "text-left"} ${className ?? ""}`}>
        {label}<SortIcon k={k} />
      </th>
    );
  }

  if (loading) return <div className="flex justify-center py-16 text-gray-400 text-sm">검색 중...</div>;
  if (medications.length === 0) return <div className="flex justify-center py-16 text-gray-400 text-sm">검색 결과가 없어요.</div>;

  const selectedCount = filteredMedications.filter((m) => selectedIds.has(m.id)).length;
  const filteredCompanyList = companyQuery.trim()
    ? companies.filter(([n]) => n.toLowerCase().includes(companyQuery.toLowerCase().trim()))
    : companies;

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <div ref={companyMenuRef} className="relative">
          <button
            onClick={() => setCompanyMenuOpen((v) => !v)}
            className="text-xs border border-gray-300 bg-white hover:bg-gray-50 rounded px-2.5 py-1.5 inline-flex items-center gap-1.5 text-gray-700"
          >
            <Filter className="w-3 h-3" />
            제약사 필터
            {companyFilter.size > 0 && (
              <span className="bg-blue-100 text-blue-700 rounded px-1.5 py-0.5 text-[10px] font-semibold">{companyFilter.size}</span>
            )}
            <ChevronDown className="w-3 h-3" />
          </button>
          {companyMenuOpen && (
            <div className="absolute z-20 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg">
              <div className="p-2 border-b flex gap-1">
                <button onClick={selectAllCompanies} className="flex-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded px-2 py-1">전체선택</button>
                <button onClick={clearCompanies} className="flex-1 text-xs bg-gray-50 hover:bg-gray-100 text-gray-700 rounded px-2 py-1">전체해제</button>
              </div>
              <div className="p-2 border-b">
                <input
                  type="text"
                  value={companyQuery}
                  onChange={(e) => setCompanyQuery(e.target.value)}
                  placeholder="제약사 검색..."
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {filteredCompanyList.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-4">제약사가 없어요.</p>
                ) : (
                  filteredCompanyList.map(([name, count]) => (
                    <label key={name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={companyFilter.has(name)}
                        onChange={() => toggleCompany(name)}
                        className="w-3.5 h-3.5 rounded border-gray-300"
                      />
                      <span className="flex-1 text-gray-700 truncate">{name}</span>
                      <span className="text-gray-400">{count}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        {companyFilter.size > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {Array.from(companyFilter).map((name) => (
              <span key={name} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5 inline-flex items-center gap-1">
                {name}
                <button onClick={() => toggleCompany(name)} className="text-blue-400 hover:text-blue-700">×</button>
              </span>
            ))}
            <button onClick={clearCompanies} className="text-xs text-gray-500 hover:text-gray-700 underline">모두 지우기</button>
          </div>
        )}
        <div className="ml-auto text-xs text-gray-500">
          {companyFilter.size > 0 ? `${filteredMedications.length} / ${medications.length}개 표시` : `${medications.length}개`}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white mt-3">
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
              <SortTh label="제품명 / 제약사" k="productName" />
              <th className="px-4 py-3 text-left">성분명</th>
              {showCategoryB && <th className="px-4 py-3 text-center">분류B</th>}
              {showBioStatus && <th className="px-4 py-3 text-center">생동/생산</th>}
              {showOriginalDrug && <th className="px-4 py-3 text-center">오리지날</th>}
              <th className="px-4 py-3 text-left">보험코드 / 동일성분</th>
              {showNotes && <th className="px-4 py-3 text-left">특이사항</th>}
              <th className="px-4 py-3 text-center">재고</th>
              <SortTh label="약가" k="price" right />
              {showRate && (
                <>
                  <SortTh label="기본수수료" k="commissionRate" right />
                  <SortTh label="추가수수료" k="additionalRate" right />
                  <SortTh label="합계수수료" k="totalRate" right />
                  <SortTh label="정산금액" k="settlement" right />
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
            {sorted.map((med) => (
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
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">
                    {med.productName}
                    <SettlementBadge med={med} />
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{med.companyName}</p>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  <IngredientName name={med.ingredientName} />
                </td>
                {showCategoryB && <td className="px-4 py-3 text-center text-xs text-gray-500">{med.categoryB || "-"}</td>}
                {showBioStatus && <td className="px-4 py-3 text-center text-xs text-gray-500">{med.bioStatus || "-"}</td>}
                {showOriginalDrug && <td className="px-4 py-3 text-center text-xs text-gray-500">{med.originalDrug || "-"}</td>}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="text-xs font-mono text-gray-500">{med.insuranceCode || "-"}</span>
                    <button onClick={() => setIngredientModal({ name: med.ingredientName, categoryB: med.categoryB })}
                      className="text-xs text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded px-2 py-1 transition-colors">
                      <Search className="w-3 h-3 inline mr-1" />동일성분
                    </button>
                  </div>
                </td>
                {showNotes && <td className="px-4 py-3 text-xs text-gray-500 max-w-[120px] truncate">{med.notes || "-"}</td>}
                <td className="px-4 py-3 text-center text-xs text-gray-400">-</td>
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
            insuranceCode: true,
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
