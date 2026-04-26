"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, FileSpreadsheet, FileDown, X, AlertCircle, Loader2, Search, Save, Building2, FileText, ChevronDown, ChevronUp } from "lucide-react";
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

interface UserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  approved: boolean;
}

interface ProposalItem {
  id: string;
  title: string;
  createdAt: string;
  _count?: { items: number };
  client?: { clientName: string } | null;
}

interface FilterRequestItem {
  id: string;
  companyName: string;
  status: string;
}

const CRITERIA_PAIRS = [
  { group: "stock", label: "재고", options: [
    { key: "stock_high", label: "많은순" },
    { key: "stock_low", label: "적은순" },
  ]},
  { group: "commission", label: "수수료", options: [
    { key: "commission_high", label: "높은순" },
    { key: "commission_low", label: "낮은순" },
  ]},
  { group: "price", label: "약가", options: [
    { key: "price_low", label: "낮은순" },
    { key: "price_high", label: "높은순" },
  ]},
] as const;

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
  const router = useRouter();
  const userId = session?.user?.id;
  const userRole = session?.user?.role;
  const isSalesRep = hasRole(userRole, "SALES_REP");

  const [title, setTitle] = useState("대체제안서");
  const [clientName, setClientName] = useState("");
  const [clients, setClients] = useState<UserClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [rows, setRows] = useState<SwapRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [lastSummary, setLastSummary] = useState<{ total: number; matched: number; unmatched: number } | null>(null);
  const [altModal, setAltModal] = useState<{ rowId: string; row: SwapRow } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newBizNumber, setNewBizNumber] = useState("");
  const [addClientError, setAddClientError] = useState("");
  const [addClientSaving, setAddClientSaving] = useState(false);
  const [autoSwitching, setAutoSwitching] = useState(false);
  const [criteriaSet, setCriteriaSet] = useState<Record<string, boolean>>({});
  const [autoSwitchResult, setAutoSwitchResult] = useState<{ applied: number; skipped: number } | null>(null);
  const [savedProposals, setSavedProposals] = useState<ProposalItem[]>([]);
  const [filterRequests, setFilterRequests] = useState<FilterRequestItem[]>([]);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  function refreshClients() {
    if (!userId) return;
    fetch(`/api/user-clients?userId=${userId}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setClients(d); })
      .catch(() => {});
  }

  async function handleAddClient() {
    if (!newClientName.trim() || !newBizNumber.trim()) {
      setAddClientError("거래처명과 사업자번호를 입력해주세요."); return;
    }
    setAddClientSaving(true); setAddClientError("");
    try {
      const res = await fetch("/api/user-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, clientName: newClientName.trim(), bizNumber: newBizNumber.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setAddClientError(data.error || "저장 실패"); return; }
      refreshClients();
      setSelectedClientId(data.id);
      setClientName(data.clientName);
      setAddClientOpen(false);
      setNewClientName(""); setNewBizNumber("");
    } catch { setAddClientError("저장 중 오류가 발생했어요."); }
    finally { setAddClientSaving(false); }
  }

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
    const eligibleRows = rows.filter((r) => r.original?.ingredientCode);
    if (eligibleRows.length === 0) return;
    setAutoSwitching(true);
    setAutoSwitchResult(null);
    try {
      const payload = {
        rows: eligibleRows.map((r) => ({
          id: r.id,
          ingredientCode: r.original!.ingredientCode,
          originalMedicationId: r.original!.id,
          originalProductName: r.original!.productName,
          ingredientName: r.original!.ingredientName,
        })),
        criteria: criteriaList,
        userId: userId ?? null,
      };
      const res = await fetch("/api/ai/auto-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return;
      const data = await res.json() as { results: { rowId: string; medication: (typeof rows[0]["alternative"]) }[] };
      const resultMap = new Map(data.results.map((r) => [r.rowId, r.medication]));
      const applied = data.results.filter((r) => r.medication != null).length;
      const skipped = eligibleRows.length - applied;
      setRows((prev) =>
        prev.map((r) => {
          const med = resultMap.get(r.id);
          return med ? { ...r, alternative: med } : r;
        })
      );
      setAutoSwitchResult({ applied, skipped });
    } finally {
      setAutoSwitching(false);
    }
  }

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/user-clients?userId=${userId}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setClients(d); })
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/proposals`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setSavedProposals(d); })
      .catch(() => {});
    fetch(`/api/filter-request`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setFilterRequests(d); })
      .catch(() => {});
  }, [userId]);

  const companySummary = useMemo(() => {
    const map = new Map<string, { count: number; products: Set<string> }>();
    for (const r of rows) {
      const name = r.alternative?.companyName;
      if (!name) continue;
      if (!map.has(name)) map.set(name, { count: 0, products: new Set() });
      const e = map.get(name)!;
      e.count++;
      if (r.alternative?.productName) e.products.add(r.alternative.productName);
    }
    const statusMap = new Map<string, string>();
    for (const fr of filterRequests) {
      if (!statusMap.has(fr.companyName)) statusMap.set(fr.companyName, fr.status);
    }
    return Array.from(map.entries())
      .map(([name, d]) => ({
        name,
        count: d.count,
        products: Array.from(d.products),
        status: statusMap.get(name) ?? null,
      }))
      .sort((a, b) => b.count - a.count);
  }, [rows, filterRequests]);

  function toggleCompanyExpand(name: string) {
    setExpandedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // 선택한 거래처명 자동으로 clientName 입력칸에 채워줌 (출력용)
  useEffect(() => {
    if (!selectedClientId) return;
    const c = clients.find((c) => c.id === selectedClientId);
    if (c) setClientName(c.clientName);
  }, [selectedClientId, clients]);

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
    if (!row.original) return;
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

  async function saveAsProposal() {
    if (!userId) return;
    if (rows.length === 0) return;
    setSaveError("");
    setSaving(true);
    try {
      const items = rows.map((r) => ({
        originalMedicationId: r.original?.id ?? null,
        // 대체품 미지정 시 원본 그대로 적용 (수수료율 유지)
        altMedicationId: r.alternative?.id ?? r.original?.id ?? null,
        originalCode: r.originalCode,
      }));
      const res = await fetch("/api/proposals/bulk-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "대체제안서",
          userId,
          clientId: selectedClientId || null,
          items,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSaveError(d?.error || "저장 실패");
        return;
      }
      const data = await res.json() as { id: string };
      setSaveModalOpen(false);
      // 저장된 제안서로 이동 → 필터링 가능
      router.push(`/proposals?id=${data.id}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
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
              <h1 className="text-xl font-bold text-gray-900">제안서(대량)</h1>
              <p className="text-xs text-gray-500 mt-1">
                거래처의 기존 품목 보험코드를 엑셀 A열에 넣어 업로드하고, 각 품목에 대해 대체할 품목을 선택해서 PDF·Excel로 출력하세요.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" onClick={() => setSaveModalOpen(true)} disabled={rows.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white">
                <Save className="w-4 h-4 mr-1" /> 제안서로 저장
              </Button>
              <Button variant="outline" size="sm" onClick={exportExcel} disabled={rows.length === 0}>
                <FileSpreadsheet className="w-4 h-4 mr-1" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={exportPDF} disabled={rows.length === 0 || exporting}>
                {exporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />} PDF
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">제목</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="대체제안서 제목" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">거래처 (제안서 저장용)</label>
              <div className="flex gap-2">
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="flex-1 h-9 px-3 border border-gray-300 rounded-md text-sm bg-white"
                >
                  <option value="">거래처 미지정</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.clientName}{!c.approved ? " (승인전)" : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => { setAddClientOpen(true); setAddClientError(""); }}
                  className="h-9 px-3 rounded-md border border-blue-300 text-blue-600 hover:bg-blue-50 text-sm font-medium whitespace-nowrap"
                  title="새 거래처 추가"
                >+ 추가</button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">거래처명 (PDF/Excel 표기)</label>
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

        {/* 자동 선택 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-500 mb-3">자동 대체 선택 기준 (여러 기준 조합 가능, 우선순위 순)</p>
            <div className="flex flex-col gap-2">
              {CRITERIA_PAIRS.map((pair) => (
                <div key={pair.group} className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-gray-500 w-12 shrink-0">{pair.label}</span>
                  {pair.options.map((opt) => {
                    const isActive = !!criteriaSet[opt.key];
                    return (
                      <label
                        key={opt.key}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border cursor-pointer select-none transition-colors text-xs ${
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
                        <span
                          className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                            isActive ? "border-blue-500 bg-blue-500" : "border-gray-300 bg-white"
                          }`}
                        >
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
              {autoSwitchResult && (
                <p className="text-xs text-gray-500">
                  <span className="text-emerald-700 font-medium">{autoSwitchResult.applied}건</span> 선택됨
                  {autoSwitchResult.skipped > 0 && <span className="text-gray-400"> · {autoSwitchResult.skipped}건 대체품 없음</span>}
                </p>
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

        {/* 제안서 목록 + 제약사 현황 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 제안서 목록 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-gray-500" />
                  제안서 목록 <span className="text-xs text-gray-400">({savedProposals.length})</span>
                </h3>
              </div>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {savedProposals.length === 0 ? (
                  <p className="text-xs text-gray-400 py-3 text-center">저장된 제안서가 없습니다.</p>
                ) : (
                  savedProposals.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => router.push(`/proposals?id=${p.id}`)}
                      className="w-full text-left p-2.5 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 transition-colors group"
                    >
                      <div className="flex items-start gap-2">
                        <FileText className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0 group-hover:text-blue-500" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 truncate">{p.title}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {p._count?.items ?? 0}개 품목 · {p.client?.clientName ?? "미지정"}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* 제약사 현황 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-gray-500" />
                  제약사 현황
                </h3>
                <span className="text-xs text-gray-400">{companySummary.length}개사</span>
              </div>
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {companySummary.length === 0 ? (
                  <p className="text-xs text-gray-400 py-3 text-center">대체 품목을 선택하면 제약사가 집계됩니다.</p>
                ) : (
                  companySummary.map((c) => {
                    const isExpanded = expandedCompanies.has(c.name);
                    const statusColor =
                      c.status === "REVIEWING" || c.status === "검토중"
                        ? "bg-amber-100 text-amber-700"
                        : c.status
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-500";
                    const statusLabel = c.status
                      ? (c.status === "REVIEWING" ? "검토중" : "요청됨")
                      : "미요청";
                    return (
                      <div key={c.name} className="rounded-lg border border-gray-200">
                        <button
                          onClick={() => toggleCompanyExpand(c.name)}
                          className="w-full flex items-center justify-between p-2 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-medium text-gray-900 truncate">{c.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-xs text-gray-500">{c.count}개</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                          </div>
                        </button>
                        <div className="px-2 pb-2 flex items-center gap-1 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor}`}>{statusLabel}</span>
                          {!c.status && (
                            <button
                              onClick={() => router.push(`/filter-request?company=${encodeURIComponent(c.name)}`)}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 hover:bg-rose-100"
                              title="필터링 요청"
                            >♡ 필터링 요청</button>
                          )}
                        </div>
                        {isExpanded && c.products.length > 0 && (
                          <ul className="px-2 pb-2 space-y-0.5 border-t border-gray-100 pt-1.5">
                            {c.products.map((prod) => (
                              <li key={prod} className="text-[11px] text-gray-600 truncate">· {prod}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
        </div>
      </div>

      {altModal && altModal.row.original && (
        <SameIngredientModal
          ingredientName={altModal.row.original.ingredientName}
          ingredientCode={altModal.row.original.ingredientCode ?? undefined}
          userId={userId}
          onClose={() => setAltModal(null)}
          selectContext={{
            originalProductName: altModal.row.original.productName,
            onSelect: (med) => assignAlternative(altModal.rowId, med),
          }}
        />
      )}

      {saveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-gray-900">제안서로 저장</h2>
                <p className="text-xs text-gray-500 mt-0.5">현재 {rows.length}개 품목을 제안서 목록에 저장합니다.</p>
              </div>
              <button onClick={() => setSaveModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">제안서 제목</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="대체제안서 제목" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">거래처</label>
                <div className="flex gap-2">
                  <select
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="flex-1 h-9 px-3 border border-gray-300 rounded-md text-sm bg-white"
                  >
                    <option value="">거래처 미지정</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.clientName}{!c.approved ? " (승인전)" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => { setAddClientOpen(true); setAddClientError(""); }}
                    className="h-9 px-3 rounded-md border border-blue-300 text-blue-600 hover:bg-blue-50 text-sm font-medium whitespace-nowrap"
                    title="새 거래처 추가"
                  >+ 추가</button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">거래처를 지정해야 저장 후 필터링 요청이 가능합니다.</p>
              </div>
              <div className="bg-gray-50 rounded-md p-3 text-xs text-gray-600 space-y-1">
                <div>총 품목: <strong className="text-gray-900">{stats.total}</strong>건</div>
                <div>매칭된 기존품목: <strong className="text-emerald-700">{stats.matched}</strong>건 · 대체 선택: <strong className="text-blue-700">{stats.withAlt}</strong>건</div>
                {stats.unmatched > 0 && <div className="text-orange-700">미매칭 {stats.unmatched}건은 보험코드만 기록됩니다.</div>}
              </div>
              {saveError && (
                <div className="flex items-start gap-2 bg-red-50 text-red-700 border border-red-200 rounded-md px-3 py-2 text-xs">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {saveError}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <Button variant="outline" size="sm" onClick={() => setSaveModalOpen(false)} disabled={saving}>
                취소
              </Button>
              <Button size="sm" onClick={saveAsProposal} disabled={saving || !title.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                저장하고 제안서로 이동
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 거래처 추가 모달 */}
      {addClientOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">새 거래처 추가</h2>
              <button onClick={() => setAddClientOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">거래처명 <span className="text-red-500">*</span></label>
                <Input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="예: 행복약국"
                  onKeyDown={(e) => e.key === "Enter" && handleAddClient()}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">사업자번호 <span className="text-red-500">*</span></label>
                <Input
                  value={newBizNumber}
                  onChange={(e) => setNewBizNumber(e.target.value)}
                  placeholder="예: 123-45-67890"
                  onKeyDown={(e) => e.key === "Enter" && handleAddClient()}
                />
              </div>
              {addClientError && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />{addClientError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-xl">
              <Button variant="outline" size="sm" onClick={() => setAddClientOpen(false)} disabled={addClientSaving}>취소</Button>
              <Button size="sm" onClick={handleAddClient} disabled={addClientSaving || !newClientName.trim() || !newBizNumber.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white">
                {addClientSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                추가
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
