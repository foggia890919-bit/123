"use client";

import { useState, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Upload, Trash2, FileSpreadsheet, FileDown, X, RefreshCw, AlertCircle, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/utils";
import RequireAuth from "@/components/RequireAuth";
import { hasRole } from "@/lib/roles";
import SameIngredientModal from "@/components/SameIngredientModal";
import type { MedicationItem } from "@/types";
import * as XLSX from "xlsx";

interface SwapRow {
  id: string;
  originalCode: string;
  original: MedicationItem | null; // 엑셀 코드로 매칭된 기존품목
  alternative: MedicationItem | null; // 사용자가 선택한 대체품
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function BulkRegisterPage() {
  return (
    <RequireAuth>
      <BulkRegisterInner />
    </RequireAuth>
  );
}

function BulkRegisterInner() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const userRole = session?.user?.role;
  const isSalesRep = hasRole(userRole, "SALES_REP");

  const [title, setTitle] = useState("대체제안서");
  const [clientName, setClientName] = useState("");
  const [rows, setRows] = useState<SwapRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [lastSummary, setLastSummary] = useState<{ total: number; matched: number; unmatched: number } | null>(null);
  const [altModal, setAltModal] = useState<{ rowId: string; row: SwapRow } | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      // A열(index 0) 만 사용, 빈 값·숫자 아닌 것 필터 완화 (문자코드도 허용)
      const codes = matrix
        .map((r) => String(r?.[0] ?? "").trim())
        .filter(Boolean)
        // 헤더 행 추정: "보험코드", "코드" 등 문자열만 있는 첫 행 스킵
        .filter((c, i, arr) => !(i === 0 && /^(보험코드|급여코드|코드|edi|edi code)$/i.test(arr[0])));

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
        setUploadError(d?.error || "조회 실패");
        return;
      }
      const data = await res.json() as { rows: { code: string; medication: MedicationItem | null }[] };

      const newRows: SwapRow[] = data.rows.map((r) => ({
        id: uid(),
        originalCode: r.code,
        original: r.medication,
        alternative: null,
      }));

      const matched = newRows.filter((r) => r.original).length;
      setLastSummary({
        total: newRows.length,
        matched,
        unmatched: newRows.length - matched,
      });
      // 기존 행 초기화하고 교체 (누적이 아니라 업로드 단위 관리)
      setRows(newRows);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "업로드 오류");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  function clearAll() {
    if (!confirm("모든 품목을 지울까요?")) return;
    setRows([]);
    setLastSummary(null);
  }

  function openAltModal(row: SwapRow) {
    if (!row.original?.categoryB) {
      alert("이 품목은 주성분코드(분류B)가 없어 동일성분 검색이 불가해요.");
      return;
    }
    setAltModal({ rowId: row.id, row });
  }

  function assignAlternative(rowId: string, med: MedicationItem) {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, alternative: med } : r)));
  }

  function clearAlternative(rowId: string) {
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, alternative: null } : r)));
  }

  const stats = useMemo(() => {
    const total = rows.length;
    const matched = rows.filter((r) => r.original).length;
    const withAlt = rows.filter((r) => r.alternative).length;
    return { total, matched, unmatched: total - matched, withAlt };
  }, [rows]);

  const showRate = isSalesRep;

  function sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "bulk-proposal";
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportExcel() {
    if (rows.length === 0) return;
    const out: Record<string, string | number>[] = rows.map((r, i) => {
      const o = r.original;
      const a = r.alternative;
      const rec: Record<string, string | number> = {
        순번: i + 1,
        "기존 보험코드": r.originalCode,
        "기존 품목명": o?.productName ?? "(미매칭)",
        "기존 제약사": o?.companyName ?? "-",
        "기존 성분명": o?.ingredientName ?? "-",
        "기존 약가": o?.price ?? "-",
        "대체 품목명": a?.productName ?? "(미선택)",
        "대체 제약사": a?.companyName ?? "-",
        "대체 보험코드": a?.insuranceCode ?? "-",
        "대체 약가": a?.price ?? "-",
      };
      if (showRate) {
        const base = a?.commissionRate ?? null;
        const extra = a?.additionalRate ?? null;
        const total = base != null ? base + (extra ?? 0) : null;
        const settlement = a?.price != null && total != null ? Math.round(a.price * total / 100) : null;
        rec["기본수수료(%)"] = base ?? "-";
        rec["추가수수료(%)"] = extra ?? "-";
        rec["합계수수료(%)"] = total ?? "-";
        rec["정산금액"] = settlement ?? "-";
      }
      return rec;
    });

    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "대체제안");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const filename = sanitizeFilename(`${title}_${clientName ? clientName + "_" : ""}${new Date().toISOString().slice(0, 10)}`) + ".xlsx";
    downloadBlob(blob, filename);
  }

  async function exportPDF() {
    if (rows.length === 0) return;
    setExporting(true);
    try {
      const [{ jsPDF }, html2canvasMod] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);
      const html2canvas = html2canvasMod.default;

      const esc = (s: unknown) =>
        String(s ?? "")
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

      const todayStr = new Date().toLocaleDateString("ko-KR");
      const rateHeaderCells = showRate
        ? `<th style="border:1px solid #d1d5db;padding:6px 8px;background:#10b981;color:#fff;">기본수수료</th>
           <th style="border:1px solid #d1d5db;padding:6px 8px;background:#10b981;color:#fff;">추가수수료</th>
           <th style="border:1px solid #d1d5db;padding:6px 8px;background:#10b981;color:#fff;">합계수수료</th>
           <th style="border:1px solid #d1d5db;padding:6px 8px;background:#10b981;color:#fff;">정산금액</th>`
        : "";

      const bodyHtml = rows
        .map((r, i) => {
          const o = r.original;
          const a = r.alternative;
          const base = a?.commissionRate ?? null;
          const extra = a?.additionalRate ?? null;
          const total = base != null ? base + (extra ?? 0) : null;
          const settlement = a?.price != null && total != null ? Math.round(a.price * total / 100) : null;

          const rateCells = showRate
            ? `<td style="border:1px solid #e5e7eb;padding:5px 8px;text-align:right;">${esc(base != null ? base + "%" : "-")}</td>
               <td style="border:1px solid #e5e7eb;padding:5px 8px;text-align:right;">${esc(extra != null ? extra + "%" : "-")}</td>
               <td style="border:1px solid #e5e7eb;padding:5px 8px;text-align:right;font-weight:600;">${esc(total != null ? total + "%" : "-")}</td>
               <td style="border:1px solid #e5e7eb;padding:5px 8px;text-align:right;color:#047857;">${esc(settlement != null ? settlement.toLocaleString() + "원" : "-")}</td>`
            : "";

          return `<tr>
            <td style="border:1px solid #e5e7eb;padding:5px 8px;text-align:center;">${i + 1}</td>
            <td style="border:1px solid #e5e7eb;padding:5px 8px;${!o ? "color:#dc2626;" : ""}">${esc(o?.productName ?? "(미매칭)")}</td>
            <td style="border:1px solid #e5e7eb;padding:5px 8px;">${esc(o?.companyName ?? "-")}</td>
            <td style="border:1px solid #e5e7eb;padding:5px 8px;font-family:monospace;font-size:10px;">${esc(r.originalCode)}</td>
            <td style="border:1px solid #e5e7eb;padding:5px 8px;text-align:right;">${esc(o?.price ? o.price.toLocaleString() + "원" : "-")}</td>
            <td style="border:1px solid #e5e7eb;padding:5px 8px;text-align:center;color:#6b7280;font-weight:700;">→</td>
            <td style="border:1px solid #e5e7eb;padding:5px 8px;background:#ecfdf5;${!a ? "color:#9ca3af;" : ""}">${esc(a?.productName ?? "(미선택)")}</td>
            <td style="border:1px solid #e5e7eb;padding:5px 8px;background:#ecfdf5;">${esc(a?.companyName ?? "-")}</td>
            <td style="border:1px solid #e5e7eb;padding:5px 8px;font-family:monospace;font-size:10px;background:#ecfdf5;">${esc(a?.insuranceCode ?? "-")}</td>
            <td style="border:1px solid #e5e7eb;padding:5px 8px;text-align:right;background:#ecfdf5;">${esc(a?.price ? a.price.toLocaleString() + "원" : "-")}</td>
            ${rateCells}
          </tr>`;
        })
        .join("");

      const container = document.createElement("div");
      container.style.cssText = [
        "position:absolute",
        "left:-10000px",
        "top:0",
        "width:1400px",
        "background:#ffffff",
        "padding:24px",
        "font-family:'Pretendard','Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif",
        "color:#111827",
      ].join(";");
      container.innerHTML = `
        <h1 style="font-size:22px;margin:0 0 4px 0;font-weight:700;">${esc(title)}</h1>
        <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">
          ${clientName ? `거래처: <strong style="color:#111827;">${esc(clientName)}</strong> · ` : ""}작성일: ${esc(todayStr)}
        </div>
        <div style="font-size:11px;color:#6b7280;margin-bottom:14px;">총 ${rows.length}건 · 매칭 ${stats.matched}건 · 대체 선택 ${stats.withAlt}건</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr>
              <th style="border:1px solid #d1d5db;padding:6px 8px;background:#6b7280;color:#fff;width:36px;">순번</th>
              <th style="border:1px solid #d1d5db;padding:6px 8px;background:#6b7280;color:#fff;">기존 품목</th>
              <th style="border:1px solid #d1d5db;padding:6px 8px;background:#6b7280;color:#fff;">기존 제약사</th>
              <th style="border:1px solid #d1d5db;padding:6px 8px;background:#6b7280;color:#fff;">보험코드</th>
              <th style="border:1px solid #d1d5db;padding:6px 8px;background:#6b7280;color:#fff;">약가</th>
              <th style="border:1px solid #d1d5db;padding:6px 8px;background:#6b7280;color:#fff;width:28px;"></th>
              <th style="border:1px solid #d1d5db;padding:6px 8px;background:#2563eb;color:#fff;">대체 품목</th>
              <th style="border:1px solid #d1d5db;padding:6px 8px;background:#2563eb;color:#fff;">대체 제약사</th>
              <th style="border:1px solid #d1d5db;padding:6px 8px;background:#2563eb;color:#fff;">보험코드</th>
              <th style="border:1px solid #d1d5db;padding:6px 8px;background:#2563eb;color:#fff;">약가</th>
              ${rateHeaderCells}
            </tr>
          </thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      `;
      document.body.appendChild(container);

      try {
        const canvas = await html2canvas(container, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
        });
        const imgData = canvas.toDataURL("image/png");
        const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 10;
        const imgWidth = pageWidth - margin * 2;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        let heightLeft = imgHeight;
        let position = margin;
        doc.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
        heightLeft -= pageHeight - margin * 2;

        while (heightLeft > 0) {
          position = heightLeft - imgHeight + margin;
          doc.addPage();
          doc.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
          heightLeft -= pageHeight - margin * 2;
        }

        const blob = doc.output("blob");
        const filename = sanitizeFilename(`${title}_${clientName ? clientName + "_" : ""}${new Date().toISOString().slice(0, 10)}`) + ".pdf";
        downloadBlob(blob, filename);
      } finally {
        document.body.removeChild(container);
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* 헤더 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-gray-900">엑셀 대량등록 (대체 제안)</h1>
              <p className="text-xs text-gray-500 mt-1">
                거래처의 기존 품목 보험코드를 A열에 넣은 엑셀을 업로드하고, 각 품목에 대해 대체할 품목을 선택해서 PDF·Excel로 출력하세요.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportExcel} disabled={rows.length === 0}>
                <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={exportPDF} disabled={rows.length === 0 || exporting}>
                {exporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />} PDF
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">제목</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="대체제안서 제목" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">거래처명 (선택)</label>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="예: 행복약국" />
            </div>
          </div>
        </div>

        {/* 업로드 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">엑셀 업로드</h2>
              <p className="text-xs text-gray-500 mt-0.5">A열에 보험코드만 넣어주세요. 첫 행이 "보험코드" 등 헤더면 자동 스킵됩니다.</p>
            </div>
            <div className="flex items-center gap-2">
              {rows.length > 0 && (
                <Button variant="outline" size="sm" onClick={clearAll}>
                  <Trash2 className="w-4 h-4 mr-1" /> 전체 지우기
                </Button>
              )}
              <label className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 cursor-pointer">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                엑셀 선택 (.xlsx, .xls)
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
            <div className="mt-3 text-xs text-gray-600 flex gap-4 flex-wrap">
              <span>총 <strong className="text-gray-900">{lastSummary.total}</strong>건</span>
              <span className="text-emerald-700">매칭 <strong>{lastSummary.matched}</strong>건</span>
              {lastSummary.unmatched > 0 && <span className="text-orange-700">미매칭 <strong>{lastSummary.unmatched}</strong>건</span>}
            </div>
          )}
        </div>

        {/* 표 */}
        {rows.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-16 text-center text-gray-400 text-sm">
            엑셀을 업로드하면 품목이 여기에 나타납니다.
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">품목 목록 ({stats.total}건)</h2>
              <div className="text-xs text-gray-500">
                대체 선택 <strong className="text-emerald-700">{stats.withAlt}</strong> / {stats.total}
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-center w-10">#</th>
                    <th className="px-3 py-2 text-left">기존 품목</th>
                    <th className="px-3 py-2 text-left">기존 제약사</th>
                    <th className="px-3 py-2 text-left">보험코드</th>
                    <th className="px-3 py-2 text-right">약가</th>
                    <th className="px-3 py-2 text-center w-8"></th>
                    <th className="px-3 py-2 text-left bg-blue-50">대체 품목</th>
                    <th className="px-3 py-2 text-left bg-blue-50">대체 제약사</th>
                    <th className="px-3 py-2 text-right bg-blue-50">약가</th>
                    {showRate && <th className="px-3 py-2 text-right bg-emerald-50">합계수수료</th>}
                    <th className="px-3 py-2 text-center w-36">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r, i) => {
                    const o = r.original;
                    const a = r.alternative;
                    const base = a?.commissionRate ?? null;
                    const extra = a?.additionalRate ?? null;
                    const totalRate = base != null ? base + (extra ?? 0) : null;
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2.5 text-center text-xs text-gray-500">{i + 1}</td>
                        <td className="px-3 py-2.5">
                          {o ? (
                            <span className="text-xs font-medium text-gray-900">{o.productName}</span>
                          ) : (
                            <span className="text-xs text-red-600 font-medium">미매칭</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{o?.companyName ?? "-"}</td>
                        <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{r.originalCode}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-700 whitespace-nowrap">{formatPrice(o?.price ?? null)}</td>
                        <td className="px-3 py-2.5 text-center text-gray-400">→</td>
                        <td className="px-3 py-2.5 bg-blue-50/30">
                          {a ? (
                            <span className="text-xs font-medium text-gray-900">{a.productName}</span>
                          ) : (
                            <span className="text-xs text-gray-400">미선택</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap bg-blue-50/30">{a?.companyName ?? "-"}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-700 whitespace-nowrap bg-blue-50/30">{formatPrice(a?.price ?? null)}</td>
                        {showRate && (
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-blue-700 bg-emerald-50/30 whitespace-nowrap">
                            {totalRate != null ? `${totalRate}%` : "-"}
                          </td>
                        )}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1 justify-center">
                            {o ? (
                              <button
                                onClick={() => openAltModal(r)}
                                className="text-xs text-white bg-emerald-600 hover:bg-emerald-700 rounded px-2 py-1 flex items-center gap-1 whitespace-nowrap"
                                title="동일성분 대체품 선택"
                              >
                                <Search className="w-3 h-3" /> {a ? "변경" : "대체 선택"}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-300 px-2">검색불가</span>
                            )}
                            {a && (
                              <button
                                onClick={() => clearAlternative(r.id)}
                                className="text-xs text-gray-500 hover:text-red-600 p-1"
                                title="대체 해제"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => removeRow(r.id)}
                              className="text-xs text-gray-400 hover:text-red-600 p-1"
                              title="행 삭제"
                            >
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

      {altModal && altModal.row.original && (
        <SameIngredientModal
          ingredientName={altModal.row.original.ingredientName}
          categoryBCode={altModal.row.original.categoryB ?? undefined}
          userId={userId}
          onClose={() => setAltModal(null)}
          selectContext={{
            originalProductName: altModal.row.original.productName,
            onSelect: (med) => assignAlternative(altModal.rowId, med),
          }}
        />
      )}
    </div>
  );
}
