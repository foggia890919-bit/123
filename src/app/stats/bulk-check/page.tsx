"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Upload, Trash2, FileSpreadsheet, AlertCircle, Loader2, Search, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/utils";
import RequireAuth from "@/components/RequireAuth";
import SameIngredientModal from "@/components/SameIngredientModal";
import type { MedicationItem } from "@/types";
import * as XLSX from "xlsx";

interface CheckRow {
  id: string;
  originalCode: string;
  medication: MedicationItem | null;     // 업로드 코드로 매칭된 원본
  selected: MedicationItem | null;       // 사용자가 선택한 대체품
  prescriptionQty: string;
  prescriptionAmount: string;
}

const CRITERIA_PAIRS = [
  {
    group: "commission", label: "수수료율", options: [
      { key: "commission_high", label: "높은순" },
      { key: "commission_low",  label: "낮은순" },
    ],
  },
  {
    group: "price", label: "약가", options: [
      { key: "price_low",  label: "낮은순" },
      { key: "price_high", label: "높은순" },
    ],
  },
  {
    group: "settlement", label: "수수료금액", options: [
      { key: "settlement",     label: "높은순" },
      { key: "settlement_low", label: "낮은순" },
    ],
  },
  {
    group: "stock", label: "재고", options: [
      { key: "stock_high", label: "많은순" },
      { key: "stock_low",  label: "적은순" },
    ],
  },
] as const;

type FilterMode = "all" | "settlement";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function stripCompanySuffix(name: string | null | undefined): string {
  if (!name) return "-";
  return (
    name
      .replace(/\(주\)/g, "").replace(/㈜/g, "").replace(/주식회사/g, "")
      .replace(/\(유\)/g, "").replace(/유한회사/g, "").replace(/\s+/g, " ").trim() || "-"
  );
}

function calcSettlement(med: MedicationItem | null, amount: string): number | null {
  if (!med) return null;
  const rate = (med.commissionRate ?? 0) + (med.additionalRate ?? 0);
  const amt = parseFloat(amount) || null;
  if (amt == null) return null;
  return Math.round(amt * rate / 100);
}

function totalRate(med: MedicationItem | null): number {
  if (!med) return 0;
  return (med.commissionRate ?? 0) + (med.additionalRate ?? 0);
}

export default function StatsExcelBulkCheckPage() {
  return (
    <RequireAuth>
      <Inner />
    </RequireAuth>
  );
}

function Inner() {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const [rows, setRows] = useState<CheckRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [lastSummary, setLastSummary] = useState<{
    total: number; matched: number; unmatched: number; excelRows: number;
  } | null>(null);

  // 기준 선택 + 자동 적용
  const [criteriaSet, setCriteriaSet] = useState<Record<string, boolean>>({});
  const [autoSwitching, setAutoSwitching] = useState(false);
  const [autoResult, setAutoResult] = useState<{ applied: number; skipped: number } | null>(null);

  // 행별 수동 선택 모달
  const [altModal, setAltModal] = useState<{ rowId: string; row: CheckRow } | null>(null);

  // 필터
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [approvedCompanies, setApprovedCompanies] = useState<Set<string>>(new Set());

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/filter-request/company-status?userId=${userId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d === "object") {
          setApprovedCompanies(
            new Set(
              Object.entries(d as Record<string, string>)
                .filter(([, s]) => s === "APPROVED")
                .map(([c]) => c)
            )
          );
        }
      })
      .catch(() => {});
  }, [userId]);

  function toggleCriteria(group: string, key: string) {
    setCriteriaSet((prev) => {
      const pair = CRITERIA_PAIRS.find((p) => p.group === group);
      const next = { ...prev };
      if (pair) for (const opt of pair.options) delete next[opt.key];
      if (!prev[key]) next[key] = true;
      return next;
    });
  }

  async function handleAutoSwitch() {
    const criteriaList = Object.entries(criteriaSet).filter(([, v]) => v).map(([k]) => k);
    if (criteriaList.length === 0) return;
    const eligible = rows.filter((r) => r.medication?.ingredientCode);
    if (eligible.length === 0) return;

    setAutoSwitching(true);
    setAutoResult(null);
    try {
      const res = await fetch("/api/ai/auto-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: eligible.map((r) => ({
            id: r.id,
            ingredientCode: r.medication!.ingredientCode,
            originalMedicationId: r.medication!.id,
            originalProductName: r.medication!.productName,
            ingredientName: r.medication!.ingredientName,
          })),
          criteria: criteriaList,
          userId: userId ?? null,
        }),
      });
      if (!res.ok) return;
      const data = await res.json() as { results: { rowId: string; medication: MedicationItem | null }[] };
      const map = new Map(data.results.map((r) => [r.rowId, r.medication]));
      const applied = data.results.filter((r) => r.medication != null).length;
      setRows((prev) =>
        prev.map((r) => {
          const med = map.get(r.id);
          return med !== undefined ? { ...r, selected: med } : r;
        })
      );
      setAutoResult({ applied, skipped: eligible.length - applied });
    } finally {
      setAutoSwitching(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix: (string | number)[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      const excelRows = matrix.length;

      const isHeader = (row: (string | number)[]) =>
        /^(보험코드|급여코드|코드|edi|edi code)$/i.test(String(row?.[0] ?? "").trim());

      const parsed = matrix
        .filter((r, i) => !(i === 0 && isHeader(r)))
        .map((r) => {
          const rawCode = String(r?.[0] ?? "").trim();
          if (!rawCode) return null;
          const code = /^\d{1,8}$/.test(rawCode) ? rawCode.padStart(9, "0") : rawCode;
          return { code, qty: String(r?.[1] ?? "").trim(), amount: String(r?.[2] ?? "").trim() };
        })
        .filter((x): x is { code: string; qty: string; amount: string } => x !== null);

      if (parsed.length === 0) {
        setUploadError("엑셀 A열에 보험코드가 없어요.");
        return;
      }

      const res = await fetch("/api/medications/bulk-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: parsed.map((p) => p.code), userId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setUploadError((d as { error?: string })?.error || "조회 실패");
        return;
      }
      const data = await res.json() as { rows: { code: string; medication: MedicationItem | null }[] };

      const newRows: CheckRow[] = data.rows.map((r, i) => ({
        id: uid(),
        originalCode: r.code,
        medication: r.medication,
        selected: null,
        prescriptionQty: parsed[i]?.qty ?? "",
        prescriptionAmount: parsed[i]?.amount ?? "",
      }));

      const matched = newRows.filter((r) => r.medication).length;
      setLastSummary({ total: newRows.length, matched, unmatched: newRows.length - matched, excelRows });
      setRows(newRows);
      setAutoResult(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "업로드 오류");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function updateQty(id: string, val: string) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, prescriptionQty: val } : r));
  }
  function updateAmount(id: string, val: string) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, prescriptionAmount: val } : r));
  }
  function clearSelected(id: string) {
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, selected: null } : r));
  }
  function assignSelected(rowId: string, med: MedicationItem) {
    setRows((rs) => rs.map((r) => r.id === rowId ? { ...r, selected: med } : r));
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }
  function clearAll() {
    if (!confirm("모든 품목을 지울까요?")) return;
    setRows([]);
    setLastSummary(null);
    setAutoResult(null);
  }

  const displayRows = useMemo(() => {
    if (filterMode === "all") return rows;
    return rows.filter((r) => r.medication?.companyName && approvedCompanies.has(r.medication.companyName));
  }, [rows, filterMode, approvedCompanies]);

  const totals = useMemo(() => {
    let currentSettlement = 0;
    let selectedSettlement = 0;
    let totalPrescAmt = 0;
    for (const r of displayRows) {
      const amt = parseFloat(r.prescriptionAmount) || 0;
      totalPrescAmt += amt;
      currentSettlement += calcSettlement(r.medication, r.prescriptionAmount) ?? 0;
      selectedSettlement += calcSettlement(r.selected ?? r.medication, r.prescriptionAmount) ?? 0;
    }
    return {
      totalPrescAmt,
      currentSettlement,
      selectedSettlement,
      gain: selectedSettlement - currentSettlement,
    };
  }, [displayRows]);

  function exportExcel() {
    if (displayRows.length === 0) return;
    const out = displayRows.map((r, i) => {
      const m = r.medication;
      const s = r.selected;
      const origSettlement = calcSettlement(m, r.prescriptionAmount);
      const selSettlement = calcSettlement(s ?? m, r.prescriptionAmount);
      const gain = selSettlement != null && origSettlement != null ? selSettlement - origSettlement : null;
      return {
        순번: i + 1,
        보험코드: r.originalCode,
        "원본 품목명": m?.productName ?? "(미매칭)",
        "원본 제약사": m?.companyName ?? "-",
        "원본 약가": m?.price ?? "-",
        "원본 합계수수료(%)": m ? totalRate(m) : "-",
        처방수량: parseFloat(r.prescriptionQty) || "-",
        처방금액: parseFloat(r.prescriptionAmount) || "-",
        원본정산예상: origSettlement ?? "-",
        "선택 품목명": s?.productName ?? "-",
        "선택 제약사": s?.companyName ?? "-",
        "선택 약가": s?.price ?? "-",
        "선택 합계수수료(%)": s ? totalRate(s) : "-",
        선택정산예상: selSettlement ?? "-",
        차액: gain ?? "-",
      };
    });
    const ws = XLSX.utils.json_to_sheet(out);
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, ws, "통계수수료확인");
    const buf = XLSX.write(wb2, { bookType: "xlsx", type: "array", compression: true });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `통계엑셀대량확인_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const statsCount = useMemo(() => ({
    total: displayRows.length,
    selected: displayRows.filter((r) => r.selected).length,
  }), [displayRows]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-4">

        {/* 헤더 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-gray-900">통계엑셀대량확인</h1>
              <p className="text-xs text-gray-500 mt-1">
                A열: 보험코드 · B열: 처방수량 · C열: 처방금액 업로드 → 기준을 설정하고 자동 선택하거나
                행별로 직접 품목을 선택해 정산 비교를 확인하세요.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={displayRows.length === 0}>
              <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel 다운로드
            </Button>
          </div>
        </div>

        {/* 업로드 + 자동선택 + 필터 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* 업로드 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">엑셀 업로드</h2>
                <p className="text-xs text-gray-500 mt-0.5">A열: 보험코드 · B열: 처방수량 · C열: 처방금액</p>
              </div>
              <div className="flex items-center gap-2">
                {rows.length > 0 && (
                  <Button variant="outline" size="sm" onClick={clearAll}>
                    <Trash2 className="w-4 h-4 mr-1" /> 지우기
                  </Button>
                )}
                <label className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 cursor-pointer">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  엑셀 선택
                  <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} disabled={uploading} />
                </label>
              </div>
            </div>
            {uploadError && (
              <div className="mt-3 flex items-start gap-2 bg-red-50 text-red-700 border border-red-200 rounded-md px-3 py-2 text-xs">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {uploadError}
              </div>
            )}
            {lastSummary && (
              <div className="mt-3 text-xs text-gray-600 flex gap-3 flex-wrap">
                <span>엑셀 <strong className="text-gray-900">{lastSummary.excelRows}행</strong></span>
                <span>코드 <strong className="text-gray-900">{lastSummary.total}</strong>건</span>
                <span className="text-emerald-700">매칭 <strong>{lastSummary.matched}</strong>건</span>
                {lastSummary.unmatched > 0 && <span className="text-orange-700">미매칭 <strong>{lastSummary.unmatched}</strong>건</span>}
              </div>
            )}
          </div>

          {/* 자동 선택 기준 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-500 mb-3">
              자동 선택 기준 <span className="font-normal text-gray-400">(여러 기준 조합 가능, 우선순위 순)</span>
            </p>
            <div className="flex flex-col gap-2">
              {CRITERIA_PAIRS.map((pair) => (
                <div key={pair.group} className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-gray-500 w-14 shrink-0">{pair.label}</span>
                  {pair.options.map((opt) => {
                    const isActive = !!criteriaSet[opt.key];
                    return (
                      <label
                        key={opt.key}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border cursor-pointer select-none text-xs transition-colors ${
                          isActive
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300"
                        } ${autoSwitching ? "pointer-events-none opacity-60" : ""}`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={isActive}
                          onChange={() => toggleCriteria(pair.group, opt.key)}
                          disabled={autoSwitching}
                        />
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                          isActive ? "border-blue-500 bg-blue-500" : "border-gray-300 bg-white"
                        }`}>
                          {isActive && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                        </span>
                        <span className="font-medium">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100 flex-wrap">
              <button
                onClick={handleAutoSwitch}
                disabled={Object.keys(criteriaSet).length === 0 || autoSwitching || rows.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {autoSwitching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                자동 선택 실행
              </button>
              {autoResult && (
                <p className="text-xs text-gray-500">
                  <span className="text-emerald-700 font-medium">{autoResult.applied}건</span> 선택됨
                  {autoResult.skipped > 0 && <span className="text-gray-400"> · {autoResult.skipped}건 대체품 없음</span>}
                </p>
              )}
            </div>
          </div>

          {/* 필터 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">보기 필터</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setFilterMode("all")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    filterMode === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >전체</button>
                <button
                  onClick={() => setFilterMode("settlement")}
                  disabled={approvedCompanies.size === 0}
                  title={approvedCompanies.size === 0 ? "승인된 필터링 거래처가 없습니다" : undefined}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    filterMode === "settlement" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >정산대상 ({approvedCompanies.size}개사)</button>
              </div>
            </div>
            {/* 합계 */}
            {statsCount.total > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">처방금액</span>
                  <span className="font-medium text-gray-900">{totals.totalPrescAmt > 0 ? totals.totalPrescAmt.toLocaleString() + "원" : "-"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">원본 정산예상</span>
                  <span className="font-medium text-gray-900">{totals.currentSettlement > 0 ? totals.currentSettlement.toLocaleString() + "원" : "-"}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-emerald-700 font-semibold">선택 정산예상</span>
                  <span className="font-bold text-emerald-700">{totals.selectedSettlement > 0 ? totals.selectedSettlement.toLocaleString() + "원" : "-"}</span>
                </div>
                {totals.gain > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-amber-700 font-semibold">차액 (추가 수익)</span>
                    <span className="font-bold text-amber-700">+{totals.gain.toLocaleString()}원</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-gray-400">
                  <span>선택 완료</span>
                  <span>{statsCount.selected} / {statsCount.total}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 표 */}
        {rows.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-16 text-center text-gray-400 text-sm">
            엑셀을 업로드하면 품목이 여기에 나타납니다.
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">
                품목 목록 ({displayRows.length}건)
              </h2>
              <p className="text-xs text-gray-500">
                선택 <strong className="text-emerald-700">{statsCount.selected}</strong> / {statsCount.total}
              </p>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-center w-10">#</th>
                    <th className="px-3 py-2 text-left">보험코드</th>
                    <th className="px-3 py-2 text-left">원본 품목</th>
                    <th className="px-3 py-2 text-left">원본 제약사</th>
                    <th className="px-3 py-2 text-right">약가</th>
                    <th className="px-2 py-2 text-right bg-emerald-50">기본%</th>
                    <th className="px-2 py-2 text-right bg-emerald-50">추가%</th>
                    <th className="px-2 py-2 text-right bg-emerald-50">합계%</th>
                    <th className="px-2 py-2 text-right bg-blue-50">처방수량</th>
                    <th className="px-2 py-2 text-right bg-blue-50">처방금액</th>
                    <th className="px-2 py-2 text-right bg-blue-50">원본정산</th>
                    <th className="px-2 py-2 text-left bg-amber-50">선택 품목</th>
                    <th className="px-2 py-2 text-right bg-amber-50">선택%</th>
                    <th className="px-2 py-2 text-right bg-amber-50">선택정산</th>
                    <th className="px-2 py-2 text-right bg-amber-50">차액</th>
                    <th className="px-3 py-2 text-center w-28">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {displayRows.map((r, i) => {
                    const m = r.medication;
                    const s = r.selected;
                    const base = m?.commissionRate ?? null;
                    const extra = m?.additionalRate ?? null;
                    const origRate = base != null ? base + (extra ?? 0) : null;
                    const origSettlement = calcSettlement(m, r.prescriptionAmount);
                    const selSettlement = calcSettlement(s, r.prescriptionAmount);
                    const gain = selSettlement != null && origSettlement != null
                      ? selSettlement - origSettlement : null;

                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 text-center text-xs text-gray-500">{i + 1}</td>
                        <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{r.originalCode}</td>
                        <td className="px-3 py-2.5 max-w-[160px]">
                          {m ? (
                            <span className="text-xs font-medium text-gray-900 leading-tight block truncate">{m.productName}</span>
                          ) : (
                            <span className="text-xs text-red-600 font-medium">(미매칭)</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[90px] truncate">{stripCompanySuffix(m?.companyName)}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-700 whitespace-nowrap">{formatPrice(m?.price ?? null)}</td>
                        <td className="px-2 py-2.5 text-right text-xs text-gray-700 bg-emerald-50/30 whitespace-nowrap">
                          {base != null ? `${base}%` : "-"}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs text-gray-700 bg-emerald-50/30 whitespace-nowrap">
                          {extra != null ? `${extra}%` : "-"}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs font-semibold text-blue-700 bg-emerald-50/30 whitespace-nowrap">
                          {origRate != null ? `${origRate}%` : "-"}
                        </td>
                        <td className="px-2 py-2.5 bg-blue-50/30">
                          <input
                            type="number"
                            value={r.prescriptionQty}
                            onChange={(e) => updateQty(r.id, e.target.value)}
                            placeholder="-"
                            className="w-20 text-xs text-right px-2 py-1 border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                          />
                        </td>
                        <td className="px-2 py-2.5 bg-blue-50/30">
                          <input
                            type="number"
                            value={r.prescriptionAmount}
                            onChange={(e) => updateAmount(r.id, e.target.value)}
                            placeholder="-"
                            className="w-28 text-xs text-right px-2 py-1 border border-gray-200 rounded focus:outline-none focus:border-blue-400"
                          />
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs font-semibold text-emerald-700 bg-blue-50/30 whitespace-nowrap">
                          {origSettlement != null ? origSettlement.toLocaleString() + "원" : "-"}
                        </td>
                        {/* 선택 품목 컬럼 */}
                        <td className="px-2 py-2.5 max-w-[150px] bg-amber-50/30">
                          {s ? (
                            <span className="text-xs font-medium text-amber-900 leading-tight block truncate">{s.productName}</span>
                          ) : (
                            <span className="text-xs text-gray-400">미선택</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs font-semibold text-amber-700 bg-amber-50/30 whitespace-nowrap">
                          {s ? `${totalRate(s)}%` : "-"}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs font-semibold text-amber-700 bg-amber-50/30 whitespace-nowrap">
                          {selSettlement != null ? selSettlement.toLocaleString() + "원" : "-"}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs font-bold bg-amber-50/30 whitespace-nowrap">
                          {gain != null && gain > 0 ? (
                            <span className="text-amber-700">+{gain.toLocaleString()}원</span>
                          ) : gain != null && gain < 0 ? (
                            <span className="text-red-600">{gain.toLocaleString()}원</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1 justify-center">
                            {m ? (
                              <button
                                onClick={() => setAltModal({ rowId: r.id, row: r })}
                                className="text-xs text-white bg-emerald-600 hover:bg-emerald-700 rounded px-2 py-1 flex items-center gap-1 whitespace-nowrap"
                              >
                                <Search className="w-3 h-3" /> {s ? "변경" : "선택"}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-300 px-2">검색불가</span>
                            )}
                            {s && (
                              <button onClick={() => clearSelected(r.id)} className="text-gray-400 hover:text-red-600 p-1" title="선택 해제">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button onClick={() => removeRow(r.id)} className="text-gray-400 hover:text-red-600 p-1" title="행 삭제">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 행별 수동 선택 모달 */}
      {altModal && altModal.row.medication && (
        <SameIngredientModal
          ingredientName={altModal.row.medication.ingredientName}
          ingredientCode={altModal.row.medication.ingredientCode ?? undefined}
          userId={userId}
          onClose={() => setAltModal(null)}
          selectContext={{
            originalProductName: altModal.row.medication.productName,
            onSelect: (med) => {
              assignSelected(altModal.rowId, med);
              setAltModal(null);
            },
          }}
        />
      )}
    </div>
  );
}
