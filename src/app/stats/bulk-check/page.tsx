"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Upload, Trash2, FileSpreadsheet, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/utils";
import RequireAuth from "@/components/RequireAuth";
import type { MedicationItem } from "@/types";
import * as XLSX from "xlsx";

interface CheckRow {
  id: string;
  originalCode: string;
  medication: MedicationItem | null;
  prescriptionQty: string;
  prescriptionAmount: string;
}

type SortKey = "none" | "commission_high" | "commission_low" | "price_low" | "price_high";
type FilterMode = "all" | "settlement";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function stripCompanySuffix(name: string | null | undefined): string {
  if (!name) return "-";
  return (
    name
      .replace(/\(주\)/g, "")
      .replace(/㈜/g, "")
      .replace(/주식회사/g, "")
      .replace(/\(유\)/g, "")
      .replace(/유한회사/g, "")
      .replace(/\s+/g, " ")
      .trim() || "-"
  );
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
    total: number;
    matched: number;
    unmatched: number;
    excelRows: number;
  } | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sortKey, setSortKey] = useState<SortKey>("none");
  const [approvedCompanies, setApprovedCompanies] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/filter-request/company-status?userId=${userId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d === "object") {
          const approved = new Set<string>(
            Object.entries(d as Record<string, string>)
              .filter(([, status]) => status === "APPROVED")
              .map(([company]) => company)
          );
          setApprovedCompanies(approved);
        }
      })
      .catch(() => {});
  }, [userId]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError("");
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix: (string | number)[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
      });

      const excelRows = matrix.length;

      const codes = matrix
        .map((r) => {
          const s = String(r?.[0] ?? "").trim();
          if (/^\d{1,8}$/.test(s)) return s.padStart(9, "0");
          return s;
        })
        .filter(Boolean)
        .filter(
          (c, i, arr) =>
            !(i === 0 && /^(보험코드|급여코드|코드|edi|edi code)$/i.test(arr[0]))
        );

      if (codes.length === 0) {
        setUploadError("엑셀 A열에 보험코드가 없어요.");
        return;
      }

      const res = await fetch("/api/medications/bulk-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes, userId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setUploadError((d as { error?: string })?.error || "조회 실패");
        return;
      }
      const data = (await res.json()) as {
        rows: { code: string; medication: MedicationItem | null }[];
      };

      const newRows: CheckRow[] = data.rows.map((r) => ({
        id: uid(),
        originalCode: r.code,
        medication: r.medication,
        prescriptionQty: "",
        prescriptionAmount: "",
      }));

      const matched = newRows.filter((r) => r.medication).length;
      setLastSummary({
        total: newRows.length,
        matched,
        unmatched: newRows.length - matched,
        excelRows,
      });
      setRows(newRows);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "업로드 오류");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function updateQty(id: string, val: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, prescriptionQty: val } : r)));
  }
  function updateAmount(id: string, val: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, prescriptionAmount: val } : r)));
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }
  function clearAll() {
    if (!confirm("모든 품목을 지울까요?")) return;
    setRows([]);
    setLastSummary(null);
  }

  const filteredRows = useMemo(() => {
    let result = [...rows];
    if (filterMode === "settlement") {
      result = result.filter(
        (r) => r.medication?.companyName && approvedCompanies.has(r.medication.companyName)
      );
    }
    if (sortKey === "commission_high") {
      result.sort((a, b) => {
        const ra = (a.medication?.commissionRate ?? 0) + (a.medication?.additionalRate ?? 0);
        const rb = (b.medication?.commissionRate ?? 0) + (b.medication?.additionalRate ?? 0);
        return rb - ra;
      });
    } else if (sortKey === "commission_low") {
      result.sort((a, b) => {
        const ra = (a.medication?.commissionRate ?? 0) + (a.medication?.additionalRate ?? 0);
        const rb = (b.medication?.commissionRate ?? 0) + (b.medication?.additionalRate ?? 0);
        return ra - rb;
      });
    } else if (sortKey === "price_low") {
      result.sort(
        (a, b) => (a.medication?.price ?? Infinity) - (b.medication?.price ?? Infinity)
      );
    } else if (sortKey === "price_high") {
      result.sort(
        (a, b) => (b.medication?.price ?? -Infinity) - (a.medication?.price ?? -Infinity)
      );
    }
    return result;
  }, [rows, filterMode, sortKey, approvedCompanies]);

  const totals = useMemo(() => {
    let totalSettlement = 0;
    let totalPrescriptionAmount = 0;
    for (const r of filteredRows) {
      if (!r.medication) continue;
      const totalRate =
        (r.medication.commissionRate ?? 0) + (r.medication.additionalRate ?? 0);
      const amt = parseFloat(r.prescriptionAmount) || 0;
      totalPrescriptionAmount += amt;
      totalSettlement += Math.round(amt * totalRate / 100);
    }
    return { totalSettlement, totalPrescriptionAmount };
  }, [filteredRows]);

  function exportExcel() {
    if (filteredRows.length === 0) return;
    const out = filteredRows.map((r, i) => {
      const m = r.medication;
      const base = m?.commissionRate ?? null;
      const extra = m?.additionalRate ?? null;
      const totalRate = base != null ? base + (extra ?? 0) : null;
      const qty = parseFloat(r.prescriptionQty) || null;
      const amt = parseFloat(r.prescriptionAmount) || null;
      const settlement =
        amt != null && totalRate != null ? Math.round(amt * totalRate / 100) : null;
      return {
        순번: i + 1,
        보험코드: r.originalCode,
        품목명: m?.productName ?? "(미매칭)",
        제약사: m?.companyName ?? "-",
        약가: m?.price ?? "-",
        "기본수수료(%)": base ?? "-",
        "추가수수료(%)": extra ?? "-",
        "합계수수료(%)": totalRate ?? "-",
        처방수량: qty ?? "-",
        처방금액: amt ?? "-",
        정산예상금액: settlement ?? "-",
      };
    });
    const ws = XLSX.utils.json_to_sheet(out);
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, ws, "통계수수료확인");
    const buf = XLSX.write(wb2, { bookType: "xlsx", type: "array", compression: true });
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `통계엑셀대량확인_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const matchedCount = filteredRows.filter((r) => r.medication).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-4">
        {/* 헤더 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-gray-900">통계엑셀대량확인</h1>
              <p className="text-xs text-gray-500 mt-1">
                통계 보험코드를 엑셀 A열에 넣어 업로드하면 수수료 정보가 매칭됩니다. 처방수량·처방금액을
                입력하면 정산 예상금액을 확인할 수 있습니다.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={exportExcel}
              disabled={filteredRows.length === 0}
            >
              <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel 다운로드
            </Button>
          </div>
        </div>

        {/* 업로드 + 필터/정렬 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 업로드 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">엑셀 업로드</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  A열에 보험코드만 넣어주세요. 첫 행이 헤더면 자동 스킵됩니다.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {rows.length > 0 && (
                  <Button variant="outline" size="sm" onClick={clearAll}>
                    <Trash2 className="w-4 h-4 mr-1" /> 전체 지우기
                  </Button>
                )}
                <label className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 cursor-pointer">
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  엑셀 선택 (.xlsx, .xls)
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleFile}
                    disabled={uploading}
                  />
                </label>
              </div>
            </div>
            {uploadError && (
              <div className="mt-3 flex items-start gap-2 bg-red-50 text-red-700 border border-red-200 rounded-md px-3 py-2 text-xs">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {uploadError}
              </div>
            )}
            {lastSummary && (
              <div className="mt-3 text-xs text-gray-600 flex gap-4 flex-wrap">
                <span>
                  엑셀 행 수{" "}
                  <strong className="text-gray-900">{lastSummary.excelRows}행</strong>
                </span>
                <span>
                  코드 <strong className="text-gray-900">{lastSummary.total}</strong>건
                </span>
                <span className="text-emerald-700">
                  매칭 <strong>{lastSummary.matched}</strong>건
                </span>
                {lastSummary.unmatched > 0 && (
                  <span className="text-orange-700">
                    미매칭 <strong>{lastSummary.unmatched}</strong>건
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 필터 + 정렬 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">보기 필터</p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setFilterMode("all")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    filterMode === "all"
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >
                  전체
                </button>
                <button
                  onClick={() => setFilterMode("settlement")}
                  disabled={approvedCompanies.size === 0}
                  title={
                    approvedCompanies.size === 0
                      ? "승인된 필터링 거래처가 없습니다"
                      : `정산 수령 중인 ${approvedCompanies.size}개사만 표시`
                  }
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    filterMode === "settlement"
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >
                  정산대상 ({approvedCompanies.size}개사)
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2">정렬</p>
              <div className="flex gap-2 flex-wrap">
                {(
                  [
                    { key: "none" as SortKey, label: "기본순" },
                    { key: "commission_high" as SortKey, label: "수수료 높은순" },
                    { key: "commission_low" as SortKey, label: "수수료 낮은순" },
                    { key: "price_low" as SortKey, label: "약가 낮은순" },
                    { key: "price_high" as SortKey, label: "약가 높은순" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSortKey(opt.key)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      sortKey === opt.key
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 합계 카드 */}
        {matchedCount > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">매칭 품목 수</p>
              <p className="text-xl font-bold text-gray-900">{matchedCount}건</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">처방금액 합계</p>
              <p className="text-xl font-bold text-gray-900">
                {totals.totalPrescriptionAmount > 0
                  ? totals.totalPrescriptionAmount.toLocaleString() + "원"
                  : "-"}
              </p>
            </div>
            <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4">
              <p className="text-xs text-emerald-700 mb-1">정산예상금액 합계</p>
              <p className="text-xl font-bold text-emerald-700">
                {totals.totalSettlement > 0
                  ? totals.totalSettlement.toLocaleString() + "원"
                  : "-"}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">표시 건수</p>
              <p className="text-xl font-bold text-gray-900">{filteredRows.length}건</p>
            </div>
          </div>
        )}

        {/* 표 */}
        {rows.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-16 text-center text-gray-400 text-sm">
            엑셀을 업로드하면 품목이 여기에 나타납니다.
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">
                품목 목록 ({filteredRows.length}건)
              </h2>
              <p className="text-xs text-gray-500">
                처방수량·처방금액을 입력하면 정산예상금액이 계산됩니다
              </p>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-center w-10">#</th>
                    <th className="px-3 py-2 text-left">보험코드</th>
                    <th className="px-3 py-2 text-left">품목명</th>
                    <th className="px-3 py-2 text-left">제약사</th>
                    <th className="px-3 py-2 text-right">약가</th>
                    <th className="px-2 py-2 text-right bg-emerald-50">기본수수료</th>
                    <th className="px-2 py-2 text-right bg-emerald-50">추가수수료</th>
                    <th className="px-2 py-2 text-right bg-emerald-50">합계수수료</th>
                    <th className="px-2 py-2 text-right bg-blue-50">처방수량</th>
                    <th className="px-2 py-2 text-right bg-blue-50">처방금액</th>
                    <th className="px-2 py-2 text-right bg-amber-50">정산예상금액</th>
                    <th className="px-3 py-2 text-center w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRows.map((r, i) => {
                    const m = r.medication;
                    const base = m?.commissionRate ?? null;
                    const extra = m?.additionalRate ?? null;
                    const totalRate = base != null ? base + (extra ?? 0) : null;
                    const prescAmt = parseFloat(r.prescriptionAmount) || null;
                    const settlement =
                      prescAmt != null && totalRate != null
                        ? Math.round(prescAmt * totalRate / 100)
                        : null;
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 text-center text-xs text-gray-500">
                          {i + 1}
                        </td>
                        <td className="px-3 py-2.5 text-xs font-mono text-gray-500">
                          {r.originalCode}
                        </td>
                        <td className="px-3 py-2.5 max-w-[200px]">
                          {m ? (
                            <span className="text-xs font-medium text-gray-900 leading-tight block">
                              {m.productName}
                            </span>
                          ) : (
                            <span className="text-xs text-red-600 font-medium">(미매칭)</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[110px] leading-tight">
                          {stripCompanySuffix(m?.companyName)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-700 whitespace-nowrap">
                          {formatPrice(m?.price ?? null)}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs text-gray-700 bg-emerald-50/30 whitespace-nowrap">
                          {base != null ? `${base}%` : "-"}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs text-gray-700 bg-emerald-50/30 whitespace-nowrap">
                          {extra != null ? `${extra}%` : "-"}
                        </td>
                        <td className="px-2 py-2.5 text-right text-xs font-semibold text-blue-700 bg-emerald-50/30 whitespace-nowrap">
                          {totalRate != null ? `${totalRate}%` : "-"}
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
                        <td className="px-2 py-2.5 text-right text-xs font-semibold text-emerald-700 bg-amber-50/30 whitespace-nowrap">
                          {settlement != null ? settlement.toLocaleString() + "원" : "-"}
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            onClick={() => removeRow(r.id)}
                            className="text-gray-400 hover:text-red-600 p-1"
                            title="행 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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
    </div>
  );
}
