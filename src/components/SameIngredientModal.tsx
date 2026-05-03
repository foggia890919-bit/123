"use client";

import { useState, useEffect, Fragment } from "react";
import { X, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown, Loader2, Plus, FileText, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { formatPrice } from "@/lib/utils";
import type { MedicationItem, IngredientMatchLevel } from "@/types";

interface Proposal { id: string; title: string; _count: { items: number } }

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
  sourceProductName?: string;
  userId?: string;
  proposals?: Proposal[];
  onProposalAdded?: (proposalId: string, added: number) => void;
  onClose: () => void;
  initialCols?: Partial<ColVis>;
  replaceContext?: ReplaceContext;
  selectContext?: SelectContext;
}

interface DropdownState {
  medId: string;
  x: number; y: number; above: boolean;
  newMode: boolean; newTitle: string; adding: string | null;
}

type SortKey = "productName" | "price" | "commissionRate" | "additionalRate" | "totalRate" | "settlement";
type SortDir = "asc" | "desc";

interface ColVis {
  categoryB: boolean; bioStatus: boolean; originalDrug: boolean;
  insuranceCode: boolean; notes: boolean;
}

function splitProductName(name: string): [string, string | null, string | null] {
  let rest = name.trim();
  let ingredient: string | null = null;
  const parenMatch = rest.match(/(\([^)]+\))\s*$/);
  if (parenMatch) {
    ingredient = parenMatch[1];
    rest = rest.slice(0, rest.lastIndexOf("(")).trim();
  }
  // Latin 단위 + 한국어 단위(밀리그람/마이크로그람/그람/밀리리터 등) 모두 매칭
  const UNIT = "(?:mg|mcg|μg|ug|g|ml|mL|IU|iu|%|mEq|밀리그[람램]|마이크로그[람램]|그[람램]|밀리리터|리터|유닛|단위)";
  const doseMatch = rest.match(new RegExp(`^(.+?)\\s*(\\d[\\d.,/]*\\s*${UNIT})`, "i"));
  if (doseMatch) return [doseMatch[1].trim(), doseMatch[2].trim(), ingredient];
  return [rest, null, ingredient];
}

// 한국어 단위 → Latin 정규화 후 소문자·공백 제거 (용량 비교용)
function normalizeDose(dose: string): string {
  return dose
    .replace(/밀리그[람램]/gi, "mg")
    .replace(/마이크로그[람램]/gi, "mcg")
    .replace(/그[람램]/gi, "g")
    .replace(/밀리리터/gi, "ml")
    .replace(/리터/gi, "l")
    .replace(/유닛|단위/gi, "iu")
    .toLowerCase()
    .replace(/\s/g, "");
}

export default function SameIngredientModal({ ingredientName, ingredientCode, sourceProductName, userId, proposals: externalProposals, onProposalAdded, onClose, initialCols, replaceContext, selectContext }: Props) {
  const [medications, setMedications] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [replacingId, setReplacingId] = useState<string>("");
  const [replaceError, setReplaceError] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<ColVis>({
    categoryB: initialCols?.categoryB ?? false,
    bioStatus: initialCols?.bioStatus ?? false,
    originalDrug: initialCols?.originalDrug ?? false,
    insuranceCode: initialCols?.insuranceCode ?? false,
    notes: initialCols?.notes ?? false,
  });
  const [dropdown, setDropdown] = useState<DropdownState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [localProposals, setLocalProposals] = useState<Proposal[]>(externalProposals ?? []);
  // 기본 = exact(용량까지 정확 일치)만 표시. 토글로 하위 단계 노출.
  const [showOtherDose, setShowOtherDose] = useState(false);
  const [showOtherForm, setShowOtherForm] = useState(false);

  useEffect(() => { setLocalProposals(externalProposals ?? []); }, [externalProposals]);

  const hasDetailPanel = cols.bioStatus || cols.originalDrug || cols.insuranceCode || cols.categoryB || cols.notes;

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

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
    // ingredientCode 있으면 ATC 주성분코드 기반 검색만 수행 (name_match 제외)
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

  function openDropdown(e: React.MouseEvent, medId: string) {
    if (!userId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = rect.bottom > window.innerHeight * 0.65;
    const x = Math.min(rect.left, window.innerWidth - 232);
    const y = above ? rect.top - 4 : rect.bottom + 4;
    setDropdown({ medId, x, y, above, newMode: false, newTitle: "", adding: null });
  }

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(null), 2000);
  }

  async function quickAdd(proposalId: string, medId: string) {
    setDropdown((d) => d ? { ...d, adding: proposalId } : null);
    const res = await fetch(`/api/proposals/${proposalId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ medicationId: medId }),
    });
    const added = res.ok ? 1 : 0;
    setDropdown(null);
    showToast(added === 0 ? "이미 추가된 품목이에요" : "제안서에 추가됐어요 ✓");
    setLocalProposals((prev) => prev.map((p) => p.id === proposalId ? { ...p, _count: { items: p._count.items + added } } : p));
    onProposalAdded?.(proposalId, added);
  }

  async function createAndQuickAdd(medId: string, title: string) {
    if (!title.trim() || !userId) return;
    setDropdown((d) => d ? { ...d, adding: "new" } : null);
    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), userId }),
    });
    if (res.ok) {
      const p: Proposal = await res.json();
      setLocalProposals((prev) => [...prev, { ...p, _count: { items: 0 } }]);
      await quickAdd(p.id, medId);
    } else {
      setDropdown(null);
    }
  }

  // matchLevel 섹션 순서: exact → same_form → same_ingredient → name_match → null(코드 없음)
  const matchOrder: Record<string, number> = { exact: 0, same_form: 1, same_ingredient: 2, name_match: 3 };

  // HIRA 주성분코드가 강도(dose)를 구분하지 않는 경우(같은 코드 → 250mg·500mg 모두 "exact"),
  // sourceProductName에서 용량을 파싱해 강도가 다른 결과를 "same_form"으로 재분류.
  const [, sourceDose] = sourceProductName ? splitProductName(sourceProductName) : ["", null, null];
  const medicationsForDisplay = sourceDose
    ? medications.map((med) => {
        if (med.matchLevel !== "exact") return med;
        const [, medDose] = splitProductName(med.productName);
        const normSource = normalizeDose(sourceDose);
        const normMed = medDose ? normalizeDose(medDose) : "";
        if (normMed && normSource && normMed !== normSource) {
          return { ...med, matchLevel: "same_form" as const };
        }
        return med;
      })
    : medications;

  const sorted = [...medicationsForDisplay].sort((a, b) => {
    // ingredientCode 기반 검색이면 matchLevel 우선 정렬
    const hasMatch = medicationsForDisplay.some((m) => m.matchLevel != null);
    if (hasMatch && !sortKey) {
      const la = matchOrder[a.matchLevel ?? ""] ?? 3;
      const lb = matchOrder[b.matchLevel ?? ""] ?? 3;
      if (la !== lb) return la - lb;
      return (a.price ?? 999999999) - (b.price ?? 999999999);
    }
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

  // ingredientCode 기반 검색이면 matchLevel 필터 적용.
  // showOtherDose=false이면 same_form 제외, showOtherForm=false이면 same_ingredient/name_match 제외.
  const hasIngredientCodeSearch = medicationsForDisplay.some((m) => m.matchLevel != null);
  const visibleSorted = hasIngredientCodeSearch
    ? sorted.filter((m) => {
        if (m.matchLevel === "exact") return true;
        if (m.matchLevel === "same_form") return showOtherDose;
        if (m.matchLevel === "same_ingredient" || m.matchLevel === "name_match") return showOtherForm;
        return true;
      })
    : sorted;

  const hasMatchLevel = visibleSorted.some((m) => m.matchLevel != null);

  const MATCH_SECTION_LABELS: Record<IngredientMatchLevel, { label: string; color: string }> = {
    exact:           { label: "정확히 일치 (동일 성분·제형·용량)", color: "bg-blue-50 text-blue-800 border-blue-200" },
    same_form:       { label: "동일 성분 + 동일 제형, 용량만 다름", color: "bg-amber-50 text-amber-800 border-amber-200" },
    same_ingredient: { label: "동일 성분 (제형·용량 다름)", color: "bg-gray-50 text-gray-600 border-gray-200" },
    name_match:      { label: "성분명 일치 (주성분코드 미매핑)", color: "bg-slate-50 text-slate-500 border-slate-200" },
  };

  const MATCH_LABEL: Record<string, string> = {
    exact: "정확일치", same_form: "동일제형(용량다름)", same_ingredient: "동일성분(제형다름)", name_match: "성분명일치",
  };

  function downloadExcel() {
    const rows = visibleSorted.map((m) => ({
      "제품명": m.productName,
      "성분명": m.ingredientName,
      "주성분코드": m.ingredientCode ?? "",
      "제조사": m.companyName,
      "약가(원)": m.price ?? "",
      "보험코드": m.insuranceCode ?? "",
      "생동/생산": m.bioStatus ?? "",
      "오리지날": m.originalDrug ?? "",
      "수수료율(%)": m.commissionRate != null ? m.commissionRate * 100 : "",
      "추가수수료(%)": m.additionalRate != null ? m.additionalRate * 100 : "",
      "매칭수준": m.matchLevel ? (MATCH_LABEL[m.matchLevel] ?? m.matchLevel) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "동일성분");
    const safe = ingredientName.replace(/[/\\?*[\]]/g, "_").slice(0, 30);
    XLSX.writeFile(wb, `동일성분_${safe}.xlsx`);
  }

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

  const hasRate = visibleSorted.some((m) => m.commissionRate != null);
  const totalCols = 1 + (hasDetailPanel ? 1 : 0) + 1 + (hasRate ? 4 : 0) + 1;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div>
              <h2 className="font-bold text-gray-900 text-sm">동일성분 검색</h2>
              <p className="text-xs text-gray-500 mt-0.5 break-all">
                {ingredientCode ? `주성분코드: ${ingredientCode}` : ingredientName} · {visibleSorted.length}개 표시 (전체 {total}개)
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={downloadExcel}
                disabled={visibleSorted.length === 0}
                title="엑셀로 내려받기"
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-3.5 h-3.5" />
                엑셀
              </button>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
            </div>
          </div>

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

          <div className="px-4 py-2 border-b bg-gray-50 flex flex-wrap gap-3 text-xs shrink-0 items-center">
            <span className="text-gray-400">펼쳐보기 항목:</span>
            {([
              ["bioStatus", "생동/생산"],
              ["originalDrug", "오리지날"],
              ["insuranceCode", "보험코드"],
              ["categoryB", "ATC코드"],
              ["notes", "특이사항"],
            ] as [keyof ColVis, string][]).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer text-gray-600 select-none">
                <input type="checkbox" checked={cols[key]} onChange={(e) => setCols((c) => ({ ...c, [key]: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded" />
                {label}
              </label>
            ))}
            <div className="flex gap-1 ml-1">
              <button type="button"
                onClick={() => setCols({ bioStatus: true, originalDrug: true, insuranceCode: true, categoryB: true, notes: true })}
                className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">전체선택</button>
              <button type="button"
                onClick={() => setCols({ bioStatus: false, originalDrug: false, insuranceCode: false, categoryB: false, notes: false })}
                className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">전체해제</button>
            </div>
          </div>

          {/* 용량/제형 범위 토글 — ingredientCode 기반 검색에서만 표시 */}
          {hasIngredientCodeSearch && (
            <div className="px-4 py-2 border-b bg-blue-50 flex flex-wrap gap-2 text-xs shrink-0 items-center">
              <span className="text-blue-700 font-medium">표시 범위:</span>
              <button
                type="button"
                onClick={() => setShowOtherDose((v) => !v)}
                className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                  showOtherDose
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-white text-amber-700 border-amber-300 hover:bg-amber-50"
                }`}
              >
                {showOtherDose ? "다른 용량 숨기기" : "다른 용량 보기"}
                {!showOtherDose && (
                  <span className="ml-1 opacity-60">
                    ({sorted.filter((m) => m.matchLevel === "same_form").length})
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowOtherForm((v) => !v)}
                className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                  showOtherForm
                    ? "bg-gray-500 text-white border-gray-500"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {showOtherForm ? "다른 제형도 숨기기" : "다른 제형도 보기"}
                {!showOtherForm && (
                  <span className="ml-1 opacity-60">
                    ({sorted.filter((m) => m.matchLevel === "same_ingredient" || m.matchLevel === "name_match").length})
                  </span>
                )}
              </button>
              <span className="text-blue-500 ml-1">
                정확 일치 {sorted.filter((m) => m.matchLevel === "exact").length}개 표시 중
              </span>
            </div>
          )}

          <div className="overflow-auto flex-1">
            {!ingredientCode && !ingredientName ? (
              <div className="flex justify-center py-16 text-gray-400 text-sm">검색 정보가 없습니다.</div>
            ) : loading ? (
              <div className="flex justify-center py-16 text-gray-400 text-sm">검색 중...</div>
            ) : visibleSorted.length === 0 ? (
              <div className="flex justify-center py-16 text-gray-400 text-sm">결과가 없어요.</div>
            ) : (
              <table className="text-xs" style={{ minWidth: "max-content", width: "100%" }}>
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold">
                  <tr>
                    <SortTh label="제품명 / 제약사" k="productName" />
                    {hasDetailPanel && <th className="px-1 py-2 w-6" />}
                    <SortTh label="약가" k="price" right />
                    {hasRate && (
                      <>
                        <SortTh label="기본수수료" k="commissionRate" right />
                        <SortTh label="추가수수료" k="additionalRate" right />
                        <SortTh label="합계" k="totalRate" right />
                        <SortTh label="정산금액" k="settlement" right />
                      </>
                    )}
                    <th className="px-2 py-2.5 text-center whitespace-nowrap text-xs">제안서</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleSorted.map((med, idx) => {
                    const base = med.commissionRate ?? null;
                    const extra = med.additionalRate ?? null;
                    const totalRate = base != null ? base + (extra ?? 0) : null;
                    const settlement = med.price != null && totalRate != null ? Math.round(med.price * totalRate / 100) : null;
                    const isExpanded = expandedRows.has(med.id);
                    const [nameBase, dose, ingredient] = splitProductName(med.productName);

                    // matchLevel 섹션 헤더: 이전 행과 matchLevel이 달라질 때만 표시
                    const prevLevel = idx > 0 ? visibleSorted[idx - 1].matchLevel : undefined;
                    const showSectionHeader =
                      hasMatchLevel &&
                      med.matchLevel != null &&
                      med.matchLevel !== prevLevel;

                    return (
                      <Fragment key={med.id}>
                        {showSectionHeader && (
                          <tr>
                            <td colSpan={totalCols} className="px-0 pt-1 pb-0">
                              <div className={`px-3 py-1.5 text-[11px] font-semibold border-y ${MATCH_SECTION_LABELS[med.matchLevel!].color}`}>
                                {MATCH_SECTION_LABELS[med.matchLevel!].label}
                                <span className="ml-2 font-normal opacity-70">
                                  ({visibleSorted.filter((m) => m.matchLevel === med.matchLevel).length}개)
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                        <tr className="hover:bg-gray-50">
                          <td className="px-2 py-2 min-w-[160px] max-w-[240px]">
                            <p className="font-medium text-gray-900 leading-tight">
                              {nameBase}
                              {med.isSettlement && (
                                <span className={`inline-block text-[9px] border px-1 py-0.5 rounded ml-1 align-middle ${
                                  med.settlementType === "원외" ? "text-blue-700 bg-blue-50 border-blue-200" :
                                  "text-indigo-700 bg-indigo-50 border-indigo-200"
                                }`}>
                                  {med.settlementType === "원외" ? "cso" : "원내"}
                                </span>
                              )}
                              {dose && <span className="block text-[11px] font-normal text-gray-400 mt-0.5">{dose}</span>}
                              {ingredient && <span className="block text-[10px] font-normal text-gray-400 mt-0.5">{ingredient}</span>}
                              <span className="block text-[11px] font-normal text-gray-500 mt-0.5">{med.companyName}</span>
                            </p>
                          </td>

                          {hasDetailPanel && (
                            <td className="px-1 py-2 text-gray-400">
                              <button type="button" onClick={() => toggleRow(med.id)} className="hover:text-gray-600">
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          )}

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
                                className="text-white bg-emerald-600 hover:bg-emerald-700 rounded px-2 py-1 whitespace-nowrap text-xs">
                                선택
                              </button>
                            ) : userId ? (
                              <div className="flex items-center gap-1 justify-center">
                                {replaceContext && (
                                  <button onClick={() => replaceItem(med)} disabled={!!replacingId}
                                    className="text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded px-2 py-1 flex items-center gap-1 whitespace-nowrap text-xs">
                                    {replacingId === med.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                    대체
                                  </button>
                                )}
                                <button onClick={(e) => openDropdown(e, med.id)}
                                  className="text-white bg-green-600 hover:bg-green-700 rounded px-2 py-1 whitespace-nowrap text-xs">
                                  추가
                                </button>
                              </div>
                            ) : <span className="text-gray-300 whitespace-nowrap text-xs">로그인 필요</span>}
                          </td>
                        </tr>

                        {isExpanded && hasDetailPanel && (
                          <tr className="bg-gray-50/60">
                            <td colSpan={totalCols} className="px-3 pb-2.5 pt-1">
                              <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                                {cols.bioStatus && (
                                  <div>
                                    <p className="text-gray-400 mb-0.5">생동/생산</p>
                                    <p className="text-gray-700">{med.bioStatus || "-"}</p>
                                  </div>
                                )}
                                {cols.originalDrug && (
                                  <div>
                                    <p className="text-gray-400 mb-0.5">오리지날/대조약</p>
                                    <p className="text-gray-700">{med.originalDrug || "-"}</p>
                                  </div>
                                )}
                                {cols.insuranceCode && (
                                  <div>
                                    <p className="text-gray-400 mb-0.5">보험코드</p>
                                    <p className="font-mono text-gray-700">{med.insuranceCode || "-"}</p>
                                  </div>
                                )}
                                {cols.categoryB && (
                                  <div>
                                    <p className="text-gray-400 mb-0.5">ATC코드</p>
                                    <p className="font-mono text-gray-700">{med.ingredientCode || "-"}</p>
                                  </div>
                                )}
                                {cols.notes && (
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
            )}
          </div>
        </div>
      </div>

      {/* 제안서 드롭다운 — modal(z-50) 위에 표시 */}
      {dropdown && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setDropdown(null)} />
          <div className="fixed z-[70] bg-white rounded-xl shadow-xl border border-gray-200 w-56 overflow-hidden"
            style={dropdown.above
              ? { left: dropdown.x, bottom: window.innerHeight - dropdown.y + 4 }
              : { left: dropdown.x, top: dropdown.y }
            }>
            {!dropdown.newMode ? (
              <div className="py-1">
                <button type="button"
                  onClick={() => setDropdown((d) => d ? { ...d, newMode: true } : null)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 font-medium">
                  <Plus className="w-3.5 h-3.5" /> 새 제안서 만들기
                </button>
                {localProposals.length > 0 && <div className="border-t border-gray-100 my-0.5" />}
                <div className="max-h-52 overflow-y-auto">
                  {localProposals.map((p) => (
                    <button key={p.id} type="button" disabled={!!dropdown.adding}
                      onClick={() => quickAdd(p.id, dropdown.medId)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      <span className="flex items-center gap-1.5 truncate">
                        <FileText className="w-3 h-3 text-gray-400 shrink-0" />
                        <span className="truncate">{p.title}</span>
                      </span>
                      <span className="text-gray-400 ml-2 shrink-0">
                        {dropdown.adding === p.id ? "추가 중..." : `${p._count.items}개`}
                      </span>
                    </button>
                  ))}
                  {localProposals.length === 0 && <p className="text-xs text-gray-400 text-center py-3">제안서가 없어요</p>}
                </div>
              </div>
            ) : (
              <div className="p-3 space-y-2">
                <input autoFocus value={dropdown.newTitle}
                  onChange={(e) => setDropdown((d) => d ? { ...d, newTitle: e.target.value } : null)}
                  onKeyDown={(e) => e.key === "Enter" && dropdown && createAndQuickAdd(dropdown.medId, dropdown.newTitle)}
                  placeholder="제안서 이름"
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                <div className="flex gap-1">
                  <button type="button" onClick={() => setDropdown((d) => d ? { ...d, newMode: false } : null)}
                    className="flex-1 text-xs py-1.5 border border-gray-200 rounded text-gray-600 hover:bg-gray-50">취소</button>
                  <button type="button" onClick={() => dropdown && createAndQuickAdd(dropdown.medId, dropdown.newTitle)}
                    disabled={!dropdown.newTitle.trim() || !!dropdown.adding}
                    className="flex-1 text-xs py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                    {dropdown.adding ? "생성 중..." : "만들고 추가"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-gray-800 text-white text-xs px-4 py-2 rounded-full shadow-lg pointer-events-none whitespace-nowrap">
          {toast}
        </div>
      )}
    </>
  );
}
