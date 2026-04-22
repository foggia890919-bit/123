"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Plus, Trash2, FileSpreadsheet, FileDown, FileText, X, Edit2, Check, Building2, Search, ChevronDown, ChevronUp, Filter, Loader2, UserPlus, Upload, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/utils";
import RequireAuth from "@/components/RequireAuth";
import { hasRole } from "@/lib/roles";
import ColumnToggles from "@/components/ColumnToggles";
import SameIngredientModal from "@/components/SameIngredientModal";
import type { ColumnVisibility } from "@/components/MedicationTable";
import * as XLSX from "xlsx";

interface Medication {
  id: string; productName: string; companyName: string; ingredientName: string;
  price: number | null; commissionRate: number | null; insuranceCode: string | null;
  categoryB: string | null; bioStatus: string | null; originalDrug: string | null; notes: string | null;
  isSettlement: boolean; settlementType?: string | null; additionalRate?: number | null;
}
interface ProposalItem {
  id: string;
  altMedication: Medication | null;
  originalMedication?: Medication | null;
  order: number;
  note?: string | null;
}
interface UserClient { id: string; clientName: string; bizNumber: string; approved: boolean; }
interface Proposal {
  id: string; title: string; clientId?: string | null;
  client?: UserClient | null;
  _count?: { items: number }; items?: ProposalItem[]; createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">거래가능</span>;
  if (status === "REVIEWING") return <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded">검토중</span>;
  if (status === "PENDING") return <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">요청됨</span>;
  if (status === "REJECTED") return <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">거부됨</span>;
  return null;
}

function ProposalsContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const userId = session?.user?.id || "";
  const isSalesRep = hasRole(session?.user?.role, "SALES_REP");
  const isBiz = hasRole(session?.user?.role, "BIZ");

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [userClients, setUserClients] = useState<UserClient[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editingClient, setEditingClient] = useState(false);
  const [editClientId, setEditClientId] = useState("");
  const [confirmClientId, setConfirmClientId] = useState<string | null>(null);
  const [companyStatuses, setCompanyStatuses] = useState<Record<string, string>>({});
  const [cols, setCols] = useState<ColumnVisibility>({ showRate: true, showInsuranceCode: true });
  const [ingredientModal, setIngredientModal] = useState<{
    name: string;
    categoryB?: string | null;
    replaceContext?: { proposalId: string; itemId: string; originalProductName: string };
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [requestingFilter, setRequestingFilter] = useState<Set<string>>(new Set());
  const [saveClientError, setSaveClientError] = useState("");
  // 거래처 신규 등록 모달
  const [regOpen, setRegOpen] = useState(false);
  const [regName, setRegName] = useState("");
  const [regBizNum, setRegBizNum] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState("");

  // 엑셀 대량등록
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<{ code: string; matched: boolean }[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ added: number; unmatched: string[] } | null>(null);

  // 컬럼 너비 (localStorage 저장)
  const DEFAULT_WIDTHS: Record<string, number> = {
    num: 40, productName: 200, ingredient: 140, sameIngredient: 100, company: 110,
    categoryB: 80, bioStatus: 80, originalDrug: 80, insuranceCode: 110, notes: 120,
    price: 80, baseRate: 90, additionalRate: 90, totalRate: 90, settlement: 110, actions: 44,
  };
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("proposal_col_widths");
      if (saved) setColWidths({ ...DEFAULT_WIDTHS, ...JSON.parse(saved) });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { localStorage.setItem("proposal_col_widths", JSON.stringify(colWidths)); } catch {}
  }, [colWidths]);

  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  function startResize(key: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startWidth: colWidths[key] ?? DEFAULT_WIDTHS[key] ?? 100 };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const { key: k, startX, startWidth } = resizingRef.current;
      const w = Math.max(40, startWidth + (ev.clientX - startX));
      setColWidths((prev) => ({ ...prev, [k]: w }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }
  function resetColWidths() { setColWidths(DEFAULT_WIDTHS); }

  const loadProposals = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/proposals?userId=${userId}`);
      const data = await res.json();
      const list: Proposal[] = Array.isArray(data) ? data : [];
      setProposals(list);

      const idParam = searchParams.get("id");
      if (idParam) {
        const found = list.find((p) => p.id === idParam);
        if (found) loadProposal(found);
      } else if (list.length > 0 && !selected) {
        loadProposal(list[0]);
      }
    } catch {
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }, [userId, searchParams]);

  async function loadProposal(p: Proposal) {
    const res = await fetch(`/api/proposals/${p.id}`);
    const data = await res.json();
    setSelected(data);
    setSidebarOpen(false);
    setExpandedCompanies(new Set());
  }

  useEffect(() => { if (userId) loadProposals(); }, [userId, loadProposals]);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/filter-request/company-status?userId=${userId}`)
      .then((r) => r.json())
      .then(setCompanyStatuses);
    fetch(`/api/user-clients?userId=${userId}`)
      .then((r) => r.json())
      .then((d) => setUserClients(Array.isArray(d) ? d : []));
  }, [userId]);

  const companySummary = useMemo(() => {
    if (!selected?.items) return [];
    const map = new Map<string, number>();
    for (const item of selected.items) {
      // 대체품이 선택됐으면 대체 제약사를, 아니면 원본(기존) 제약사를 기준으로 집계
      // 제안서(대량) 저장 직후처럼 altMedication 이 null 인 행도 원본 기준으로 노출
      const name = item.altMedication?.companyName ?? item.originalMedication?.companyName;
      if (name) map.set(name, (map.get(name) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [selected]);

  async function createProposal() {
    const title = newTitle.trim() || `새 제안서 ${new Date().toLocaleDateString("ko-KR")}`;
    setCreating(true);
    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, userId, clientId: newClientId || null }),
    });
    if (res.ok) {
      const p = await res.json();
      setNewTitle("");
      setNewClientId("");
      await loadProposals();
      loadProposal(p);
    }
    setCreating(false);
  }

  async function deleteProposal(id: string) {
    if (!confirm("제안서를 삭제할까요?")) return;
    await fetch(`/api/proposals/${id}`, { method: "DELETE" });
    if (selected?.id === id) setSelected(null);
    await loadProposals();
  }

  async function removeItem(itemId: string) {
    if (!selected) return;
    await fetch(`/api/proposals/${selected.id}/items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    loadProposal(selected);
  }

  async function saveTitle() {
    if (!selected || !editTitle.trim()) return;
    await fetch(`/api/proposals/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle.trim() }),
    });
    setEditingTitle(false);
    await loadProposals();
    setSelected((prev) => prev ? { ...prev, title: editTitle.trim() } : prev);
  }

  async function saveClient() {
    if (!selected) return;
    setSaveClientError("");
    const res = await fetch(`/api/proposals/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: confirmClientId || null }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setSaveClientError(d.error?.includes("column") ? "DB 마이그레이션이 필요합니다. 관리자에게 문의하세요." : "저장에 실패했습니다.");
      return;
    }
    setConfirmClientId(null);
    setEditingClient(false);
    const [detail] = await Promise.all([
      fetch(`/api/proposals/${selected.id}`).then((r) => r.json()),
      loadProposals(),
      fetch(`/api/filter-request/company-status?userId=${userId}`).then((r) => r.json()).then(setCompanyStatuses),
    ]);
    setSelected(detail);
  }

  async function registerClient() {
    if (!regName.trim() || !regBizNum.trim()) { setRegError("거래처명과 사업자번호를 입력해주세요."); return; }
    setRegLoading(true); setRegError("");
    const res = await fetch("/api/user-clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, clientName: regName.trim(), bizNumber: regBizNum.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { setRegError(data.error || "등록 실패"); setRegLoading(false); return; }
    const updated = await fetch(`/api/user-clients?userId=${userId}`).then((r) => r.json());
    setUserClients(Array.isArray(updated) ? updated : []);
    setEditClientId(data.id);
    setRegOpen(false); setRegName(""); setRegBizNum("");
    setRegLoading(false);
    if (!editingClient) { setEditingClient(true); }
  }

  function toggleCompanyExpand(name: string) {
    setExpandedCompanies((prev) => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }

  async function requestFilter(companyName: string) {
    if (!selected?.client) return; // 버튼 자체가 disabled라 여기 도달 안 함
    const existing = companyStatuses[companyName];
    if (existing === "PENDING" || existing === "REVIEWING") return;
    setRequestingFilter((prev) => new Set(prev).add(companyName));
    try {
      await fetch("/api/filter-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          userName: session?.user?.name || "",
          clientName: selected.client.clientName,
          bizNumber: selected.client.bizNumber,
          companies: [companyName],
        }),
      });
      const res = await fetch(`/api/filter-request/company-status?userId=${userId}`);
      setCompanyStatuses(await res.json());
    } finally {
      setRequestingFilter((prev) => { const n = new Set(prev); n.delete(companyName); return n; });
    }
  }

  function handleBulkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = new Uint8Array(ev.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      // A열(index 0) 값만 추출, 숫자/문자열 모두 허용
      const codes = rows
        .map((r) => String(r[0] ?? "").trim())
        .filter((v) => v.length > 0);
      // 보험코드 9자리면 matched 예상, 아니면 unmatched 예상 (실제 매칭은 서버에서)
      setBulkPreview(codes.map((code) => ({ code, matched: /^\d{9}$/.test(code) })));
      setBulkResult(null);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  async function submitBulk() {
    if (!selected || bulkPreview.length === 0) return;
    setBulkLoading(true);
    const codes = bulkPreview.map((p) => p.code);
    const res = await fetch(`/api/proposals/${selected.id}/items/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes }),
    });
    const result = await res.json();
    setBulkResult(result);
    setBulkLoading(false);
    await loadProposal(selected);
  }

  function sanitizeFilename(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "proposal";
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
    if (!selected?.items) return;
    const withRate = isSalesRep && cols.showRate;
    const rows = selected.items.map((item, i) => {
      const m = item.altMedication;
      const base = m?.commissionRate ?? null;
      const extra = m?.additionalRate ?? null;
      const total = base != null ? base + (extra ?? 0) : null;
      const settlement = m?.price != null && total != null ? Math.round(m.price * total / 100) : null;
      const row: Record<string, string | number> = {
        순번: i + 1, 품목명: m?.productName || "-", 성분명: m?.ingredientName || "-", 제약사: m?.companyName || "-",
      };
      if (cols.showCategoryB) row["분류B"] = m?.categoryB || "-";
      if (cols.showBioStatus) row["생동/생산"] = m?.bioStatus || "-";
      if (cols.showOriginalDrug) row["오리지날"] = m?.originalDrug || "-";
      if (cols.showInsuranceCode) row["보험코드"] = m?.insuranceCode || "-";
      if (cols.showNotes) row["특이사항"] = m?.notes || "-";
      row["약가"] = m?.price ?? "-";
      if (withRate) {
        row["기본수수료(%)"] = base ?? "-"; row["추가수수료(%)"] = extra ?? "-";
        row["합계수수료(%)"] = total ?? "-"; row["정산금액"] = settlement ?? "-";
      }
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "제안서");
    // ArrayBuffer → Blob 으로 다운로드 (writeFile 의 브라우저 파일명 인코딩 이슈 회피)
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const filename = sanitizeFilename(`${selected.title}_${new Date().toISOString().slice(0, 10)}`) + ".xlsx";
    downloadBlob(blob, filename);
  }

  async function exportPDF() {
    if (!selected?.items) return;
    const [{ jsPDF }, html2canvasMod] = await Promise.all([
      import("jspdf"),
      import("html2canvas"),
    ]);
    const html2canvas = html2canvasMod.default;

    const withRate = isSalesRep && cols.showRate;
    const esc = (s: unknown) =>
      String(s ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    const head = ["순번", "품목명", "성분명", "제약사"];
    if (cols.showCategoryB) head.push("분류B");
    if (cols.showBioStatus) head.push("생동/생산");
    if (cols.showOriginalDrug) head.push("오리지날");
    if (cols.showInsuranceCode) head.push("보험코드");
    if (cols.showNotes) head.push("특이사항");
    head.push("약가");
    if (withRate) head.push("기본수수료", "추가수수료", "합계수수료", "정산금액");

    const bodyRows = selected.items.map((item, i) => {
      const m = item.altMedication;
      const base = m?.commissionRate ?? null;
      const extra = m?.additionalRate ?? null;
      const total = base != null ? base + (extra ?? 0) : null;
      const settlement = m?.price != null && total != null ? Math.round(m.price * total / 100) : null;
      const row: (string | number)[] = [i + 1, m?.productName || "-", m?.ingredientName || "-", m?.companyName || "-"];
      if (cols.showCategoryB) row.push(m?.categoryB || "-");
      if (cols.showBioStatus) row.push(m?.bioStatus || "-");
      if (cols.showOriginalDrug) row.push(m?.originalDrug || "-");
      if (cols.showInsuranceCode) row.push(m?.insuranceCode || "-");
      if (cols.showNotes) row.push(m?.notes || "-");
      row.push(m?.price ? `${m.price.toLocaleString()}원` : "-");
      if (withRate) {
        row.push(
          base != null ? `${base}%` : "-",
          extra != null ? `${extra}%` : "-",
          total != null ? `${total}%` : "-",
          settlement != null ? `${settlement.toLocaleString()}원` : "-"
        );
      }
      return row;
    });

    // 한글 렌더링을 위해 HTML 로 만들고 html2canvas 로 이미지화 → jsPDF 에 삽입
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
      <h1 style="font-size:20px;margin:0 0 6px 0;font-weight:700;">${esc(selected.title)}</h1>
      <div style="font-size:11px;color:#6b7280;margin-bottom:14px;">작성일: ${esc(new Date().toLocaleDateString("ko-KR"))}</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr>${head.map((h) => `<th style="border:1px solid #d1d5db;padding:6px 8px;background:#2563eb;color:#ffffff;text-align:center;font-weight:600;">${esc(h)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${bodyRows
            .map(
              (r) =>
                `<tr>${r.map((c) => `<td style="border:1px solid #e5e7eb;padding:5px 8px;vertical-align:top;">${esc(c)}</td>`).join("")}</tr>`
            )
            .join("")}
        </tbody>
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
      const filename = sanitizeFilename(`${selected.title}_${new Date().toISOString().slice(0, 10)}`) + ".pdf";
      downloadBlob(blob, filename);
    } finally {
      document.body.removeChild(container);
    }
  }

  if (loading) return <div className="flex justify-center py-20 text-gray-400">불러오는 중...</div>;

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-5 md:h-[calc(100vh-120px)]">

      {/* ── 오른쪽 사이드바 (모바일: 상단) ── */}
      <div className="w-full md:w-72 md:shrink-0 flex flex-col gap-3 order-1 md:order-2 md:min-h-0">

        {/* 새 제안서 만들기 */}
        <div className="space-y-1.5 shrink-0">
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="새 제안서 이름..." className="h-9 text-sm"
            onKeyDown={(e) => e.key === "Enter" && createProposal()} />
          {/* 거래처 선택 드롭다운 */}
          <div className="flex gap-1">
            <select
              value={newClientId}
              onChange={(e) => setNewClientId(e.target.value)}
              className="flex-1 h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">거래처 미지정</option>
              {userClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clientName}{!c.approved ? " (승인전)" : ""}
                </option>
              ))}
            </select>
            {isBiz && (
              <button type="button" onClick={() => { setRegOpen(true); setRegError(""); }}
                title="새 거래처 등록"
                className="h-9 w-9 shrink-0 flex items-center justify-center border border-gray-300 rounded-md hover:bg-gray-50 text-gray-500 hover:text-blue-600">
                <UserPlus className="w-4 h-4" />
              </button>
            )}
          </div>
          <Button onClick={createProposal} disabled={creating} className="w-full h-9 text-sm">
            <Plus className="w-3.5 h-3.5 mr-1" />{creating ? "생성 중..." : "새 제안서 만들기"}
          </Button>
        </div>

        {/* 제안서 목록 */}
        <div className="md:flex-1 md:overflow-y-auto md:min-h-0">
          <button type="button" onClick={() => setSidebarOpen((v) => !v)}
            className="w-full flex items-center justify-between px-1 py-1 text-xs font-semibold text-gray-500 md:pointer-events-none">
            <span>제안서 목록 ({proposals.length})</span>
            <span className="md:hidden">{sidebarOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
          </button>
          <div className={`space-y-1 ${sidebarOpen ? "block" : "hidden md:block"}`}>
            {proposals.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">제안서가 없어요</p>
            ) : proposals.map((p) => (
              <div key={p.id} onClick={() => loadProposal(p)}
                className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors ${
                  selected?.id === p.id ? "bg-blue-50 border border-blue-200" : "bg-white border border-gray-200 hover:bg-gray-50"
                }`}>
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className={`w-4 h-4 shrink-0 ${selected?.id === p.id ? "text-blue-600" : "text-gray-400"}`} />
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${selected?.id === p.id ? "text-blue-700" : "text-gray-800"}`}>{p.title}</p>
                    <p className="text-xs text-gray-400">
                      {p._count?.items ?? 0}개 품목
                      {p.client && <span className="ml-1 text-gray-400">· {p.client.clientName}</span>}
                      {!p.client && <span className="ml-1 text-gray-300">· 미지정</span>}
                    </p>
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); deleteProposal(p.id); }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 p-1 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 제약사 현황 */}
        {selected && companySummary.length > 0 && (
          <div className="shrink-0 flex flex-col gap-2 md:max-h-[45%]">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-800">제약사 현황</h3>
              <span className="text-xs text-gray-400 ml-auto">{companySummary.length}개사</span>
            </div>
            {isBiz && !selected?.client && (
              <div className="flex items-center gap-1.5 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-xs text-orange-700">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                거래처를 지정해야 필터링 요청이 가능합니다
              </div>
            )}
            <div className="overflow-y-auto bg-white rounded-lg border border-gray-200 max-h-48 md:max-h-none md:flex-1 md:min-h-0">
              <div className="divide-y divide-gray-50">
                {companySummary.map(({ name, count }) => {
                  const status = companyStatuses[name] || "";
                  const isApproved = status === "APPROVED";
                  const isExpanded = expandedCompanies.has(name);
                  return (
                    <div key={name} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-medium text-gray-800 truncate flex-1">{name}</p>
                        <span className="text-xs text-gray-400 shrink-0 mr-1">{count}개</span>
                        {/* 거래처 접기/펼치기 */}
                        <button onClick={() => toggleCompanyExpand(name)}
                          className="text-gray-400 hover:text-gray-600 shrink-0">
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {status ? <StatusBadge status={status} /> : null}
                        {isBiz && (
                          <button
                            onClick={() => requestFilter(name)}
                            disabled={!selected?.client || requestingFilter.has(name) || status === "PENDING" || status === "REVIEWING"}
                            title={!selected?.client ? "거래처를 먼저 지정해야 필터링 요청이 가능합니다" : undefined}
                            className={`inline-flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                              isApproved
                                ? "text-gray-500 bg-gray-50 border border-gray-200 hover:bg-gray-100"
                                : "text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100"
                            }`}>
                            {requestingFilter.has(name)
                              ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              : <Filter className="w-2.5 h-2.5" />}
                            {status === "PENDING" ? "요청됨" : status === "REVIEWING" ? "검토중" : "필터링 요청"}
                          </button>
                        )}
                      </div>
                      {/* 거래처 상세 (펼쳤을 때) */}
                      {isExpanded && (
                        <div className="mt-1.5 text-[10px] bg-gray-50 border border-gray-100 rounded px-2 py-1.5 text-gray-600">
                          {selected.client ? (
                            <>
                              <p className="font-semibold text-gray-800">{selected.client.clientName}</p>
                              <p className="text-gray-400 font-mono">{selected.client.bizNumber}</p>
                              {!selected.client.approved && (
                                <p className="text-orange-500 mt-0.5">승인 대기중</p>
                              )}
                            </>
                          ) : (
                            <p className="text-gray-400">거래처 미지정</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 왼쪽: 선택된 제안서 내용 (모바일: 하단) ── */}
      <div className="flex-1 flex flex-col gap-3 min-w-0 order-2 md:order-1">
        {!selected ? (
          <div className="flex items-center justify-center py-16 text-gray-400 bg-white rounded-lg border border-gray-200">
            <div className="text-center">
              <FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">위에서 제안서를 선택하거나 새로 만들어요</p>
            </div>
          </div>
        ) : (
          <>
            {/* 제안서 헤더 */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {editingTitle ? (
                  <>
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                      className="h-9 text-base font-bold w-full max-w-xs"
                      onKeyDown={(e) => e.key === "Enter" && saveTitle()} autoFocus />
                    <button onClick={saveTitle} className="text-green-600 hover:text-green-700 shrink-0"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditingTitle(false)} className="text-gray-400 hover:text-gray-600 shrink-0"><X className="w-4 h-4" /></button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-lg font-bold text-gray-900 truncate">{selected.title}</h2>
                      {/* 거래처 인라인 편집 */}
                      {editingClient ? (
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <select
                            value={editClientId}
                            onChange={(e) => setEditClientId(e.target.value)}
                            className="h-7 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            autoFocus
                          >
                            <option value="">거래처 미지정</option>
                            {userClients.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.clientName} · {c.bizNumber}{!c.approved ? " (승인전)" : ""}
                              </option>
                            ))}
                          </select>
                          {isBiz && (
                            <button type="button" onClick={() => { setRegOpen(true); setRegError(""); }}
                              title="새 거래처 등록" className="h-7 w-7 flex items-center justify-center border border-gray-300 rounded hover:bg-gray-50 text-gray-500 hover:text-blue-600">
                              <UserPlus className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => setConfirmClientId(editClientId)} className="h-7 px-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded">완료</button>
                          <button onClick={() => setEditingClient(false)} className="text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditClientId(selected.clientId || ""); setEditingClient(true); }}
                          className="flex items-center gap-1 mt-0.5 group"
                        >
                          {selected.client ? (
                            <span className="text-xs text-gray-400 group-hover:text-blue-500">{selected.client.clientName} · {selected.client.bizNumber}</span>
                          ) : (
                            <span className="text-xs text-gray-300 group-hover:text-blue-400">거래처 미지정 (클릭해서 설정)</span>
                          )}
                          <Edit2 className="w-3 h-3 text-gray-300 group-hover:text-blue-400 opacity-0 group-hover:opacity-100" />
                        </button>
                      )}
                    </div>
                    <button onClick={() => { setEditTitle(selected.title); setEditingTitle(true); }}
                      className="text-gray-400 hover:text-gray-600 shrink-0"><Edit2 className="w-4 h-4" /></button>
                    <span className="text-sm text-gray-400 shrink-0">{selected.items?.length ?? 0}개</span>
                  </>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => { setBulkOpen(true); setBulkPreview([]); setBulkResult(null); }}>
                  <Upload className="w-3.5 h-3.5 mr-1" />엑셀 대량등록
                </Button>
                <Button variant="outline" size="sm" onClick={exportExcel} disabled={!selected.items?.length}>
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />엑셀
                </Button>
                <Button variant="outline" size="sm" onClick={exportPDF} disabled={!selected.items?.length}>
                  <FileDown className="w-3.5 h-3.5 mr-1" />PDF
                </Button>
              </div>
            </div>

            {!selected.items?.length ? (
              <div className="flex items-center justify-center py-16 text-gray-400 bg-white rounded-lg border border-gray-200">
                <p className="text-sm">검색 결과에서 품목을 추가해보세요</p>
              </div>
            ) : (
              <>
                <div className="flex justify-end gap-2 items-center">
                  <button onClick={resetColWidths}
                    title="컬럼 너비 초기화"
                    className="text-[11px] text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-300 rounded px-2 py-1">
                    너비 초기화
                  </button>
                  <ColumnToggles cols={cols} setCols={setCols} isSalesRep={isSalesRep} />
                </div>
                <div className="overflow-x-auto overflow-y-auto max-h-[60vh] md:flex-1 rounded-lg border border-gray-200 bg-white">
                  {(() => {
                    const activeCols: { k: string; label: string; align: "left" | "center" | "right" }[] = [
                      { k: "num", label: "#", align: "left" },
                      { k: "productName", label: "품목명", align: "left" },
                      { k: "ingredient", label: "성분명", align: "left" },
                      { k: "sameIngredient", label: "", align: "center" },
                      { k: "company", label: "제약사", align: "left" },
                      ...(cols.showCategoryB ? [{ k: "categoryB", label: "분류B", align: "center" as const }] : []),
                      ...(cols.showBioStatus ? [{ k: "bioStatus", label: "생동/생산", align: "center" as const }] : []),
                      ...(cols.showOriginalDrug ? [{ k: "originalDrug", label: "오리지날", align: "center" as const }] : []),
                      ...(cols.showInsuranceCode ? [{ k: "insuranceCode", label: "보험코드", align: "left" as const }] : []),
                      ...(cols.showNotes ? [{ k: "notes", label: "특이사항", align: "left" as const }] : []),
                      { k: "price", label: "약가", align: "right" },
                      ...(isSalesRep && cols.showRate ? [
                        { k: "baseRate", label: "기본수수료", align: "right" as const },
                        { k: "additionalRate", label: "추가수수료", align: "right" as const },
                        { k: "totalRate", label: "합계수수료", align: "right" as const },
                        { k: "settlement", label: "정산금액", align: "right" as const },
                      ] : []),
                      { k: "actions", label: "", align: "center" },
                    ];
                    const getW = (k: string) => colWidths[k] ?? DEFAULT_WIDTHS[k] ?? 100;
                    const totalWidth = activeCols.reduce((s, c) => s + getW(c.k), 0);
                    return (
                  <table className="text-sm table-fixed border-collapse" style={{ width: totalWidth }}>
                    <colgroup>
                      {activeCols.map((c) => <col key={c.k} style={{ width: getW(c.k) }} />)}
                    </colgroup>
                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                      <tr className="text-xs text-gray-500 font-semibold whitespace-nowrap">
                        {activeCols.map(({ k, label, align }) => (
                          <th key={k} className={`relative px-3 py-2.5 text-${align} select-none`}>
                            <span className="truncate block">{label}</span>
                            <div
                              onMouseDown={(e) => startResize(k, e)}
                              onClick={(e) => e.stopPropagation()}
                              role="separator"
                              aria-orientation="vertical"
                              className="absolute top-0 right-[-4px] h-full w-2 cursor-col-resize z-20 group flex items-center justify-center"
                              title="드래그로 너비 조절">
                              <div className="h-[60%] w-[2px] bg-gray-300 group-hover:bg-blue-500 group-active:bg-blue-600 transition-colors" />
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selected.items.map((item, i) => {
                        const m = item.altMedication;
                        const isUnmatched = !m && !!item.note;
                        const base = m?.commissionRate ?? null;
                        const extra = m?.additionalRate ?? null;
                        const total = base != null ? base + (extra ?? 0) : null;
                        const settlement = m?.price != null && total != null ? Math.round(m.price * total / 100) : null;
                        return (
                          <tr key={item.id} className={`hover:bg-gray-50 ${isUnmatched ? "bg-orange-50/40" : ""}`}>
                            <td className="px-3 py-2.5 text-gray-400 text-xs truncate">{i + 1}</td>
                            <td className="px-3 py-2.5 overflow-hidden" title={m?.productName || item.note || ""}>
                              {isUnmatched ? (
                                <p className="font-medium text-sm truncate flex items-center gap-1.5">
                                  <span className="text-[10px] bg-orange-100 text-orange-700 border border-orange-200 rounded px-1.5 py-0.5 font-semibold shrink-0">미인식</span>
                                  <span className="font-mono text-gray-500 text-xs truncate">{item.note}</span>
                                </p>
                              ) : (
                                <div className="space-y-0.5 min-w-0">
                                  {item.originalMedication && (
                                    <p className="text-xs text-gray-400 line-through truncate flex items-center gap-1">
                                      <span className="text-[10px] bg-gray-100 text-gray-500 border border-gray-200 rounded px-1 py-0.5 no-underline shrink-0">원본</span>
                                      <span className="truncate">{item.originalMedication.productName}</span>
                                    </p>
                                  )}
                                  <p className="font-medium text-gray-900 text-sm truncate flex items-center gap-1">
                                    {item.originalMedication && (
                                      <span className="text-[10px] bg-blue-100 text-blue-700 border border-blue-200 rounded px-1 py-0.5 font-semibold shrink-0">대체</span>
                                    )}
                                    <span className="truncate">{m?.productName || "-"}</span>
                                    {m?.isSettlement && (m.settlementType === "원외" || m.settlementType === "원내") && (
                                      <span className={`inline-block text-[10px] border px-1 py-0.5 rounded align-middle shrink-0 ${
                                        m.settlementType === "원외" ? "text-blue-700 bg-blue-50 border-blue-200" : "text-indigo-700 bg-indigo-50 border-indigo-200"
                                      }`}>{m.settlementType === "원외" ? "cso" : "원내가능"}</span>
                                    )}
                                  </p>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-500 truncate" title={m?.ingredientName || ""}>{m?.ingredientName || "-"}</td>
                            <td className="px-3 py-2.5 text-center">
                              {m && (
                                <button onClick={() => selected && setIngredientModal({
                                  name: m.ingredientName,
                                  categoryB: m.categoryB,
                                  replaceContext: { proposalId: selected.id, itemId: item.id, originalProductName: m.productName },
                                })}
                                  className="text-xs text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded px-2 py-1 whitespace-nowrap">
                                  <Search className="w-3 h-3 inline mr-0.5" />동일성분
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-600 truncate" title={m?.companyName || ""}>{m?.companyName || "-"}</td>
                            {cols.showCategoryB && <td className="px-3 py-2.5 text-center text-xs text-gray-500 truncate">{m?.categoryB || "-"}</td>}
                            {cols.showBioStatus && <td className="px-3 py-2.5 text-center text-xs text-gray-500 truncate">{m?.bioStatus || "-"}</td>}
                            {cols.showOriginalDrug && <td className="px-3 py-2.5 text-center text-xs text-gray-500 truncate">{m?.originalDrug || "-"}</td>}
                            {cols.showInsuranceCode && <td className="px-3 py-2.5 text-xs font-mono text-gray-500 truncate">{m?.insuranceCode || "-"}</td>}
                            {cols.showNotes && <td className="px-3 py-2.5 text-xs text-gray-500 truncate" title={m?.notes || ""}>{m?.notes || "-"}</td>}
                            <td className="px-3 py-2.5 text-right text-sm text-gray-700 truncate">{formatPrice(m?.price)}</td>
                            {isSalesRep && cols.showRate && (
                              <>
                                <td className="px-3 py-2.5 text-right text-sm text-blue-600 font-medium truncate">{base != null ? `${base}%` : "-"}</td>
                                <td className="px-3 py-2.5 text-right text-sm text-gray-500 truncate">{extra != null ? `${extra}%` : "-"}</td>
                                <td className="px-3 py-2.5 text-right text-sm font-semibold text-blue-700 truncate">{total != null ? `${total}%` : "-"}</td>
                                <td className="px-3 py-2.5 text-right text-sm font-semibold text-green-700 truncate">{settlement != null ? `${settlement.toLocaleString()}원` : "-"}</td>
                              </>
                            )}
                            <td className="px-3 py-2.5 text-center">
                              <button onClick={() => removeItem(item.id)} className="text-red-400 hover:text-red-600 p-1">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                    );
                  })()}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* 거래처 매핑 확인 모달 */}
      {confirmClientId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <h3 className="text-base font-bold text-gray-900">거래처 매핑</h3>
            <p className="text-sm text-gray-600">
              {confirmClientId
                ? <>이 제안서를 <span className="font-semibold text-gray-900">{userClients.find((c) => c.id === confirmClientId)?.clientName}</span> 거래처로 매핑할까요?</>
                : "거래처 연결을 해제할까요?"}
            </p>
            {saveClientError && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{saveClientError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setConfirmClientId(null); setSaveClientError(""); }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                아니오
              </button>
              <button onClick={saveClient}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
                예
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 거래처 신규 등록 모달 */}
      {regOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">새 거래처 등록</h3>
              <button onClick={() => setRegOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">거래처명 *</label>
                <Input value={regName} onChange={(e) => setRegName(e.target.value)}
                  placeholder="거래처 상호명" className="h-9 mt-1" autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">사업자번호 *</label>
                <Input value={regBizNum}
                  onChange={(e) => {
                    const d = e.target.value.replace(/\D/g, "");
                    setRegBizNum(d.length <= 3 ? d : d.length <= 5 ? `${d.slice(0,3)}-${d.slice(3)}` : `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5,10)}`);
                  }}
                  placeholder="000-00-00000" maxLength={12} className="h-9 mt-1" />
              </div>
            </div>
            {regError && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{regError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRegOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                취소
              </button>
              <button onClick={registerClient} disabled={regLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                {regLoading ? "등록 중..." : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      {ingredientModal && (
        <SameIngredientModal
          ingredientName={ingredientModal.name}
          categoryBCode={ingredientModal.categoryB ?? undefined}
          userId={userId}
          replaceContext={ingredientModal.replaceContext
            ? { ...ingredientModal.replaceContext, onDone: () => { if (selected) loadProposal(selected); } }
            : undefined}
          onClose={() => { setIngredientModal(null); if (selected) loadProposal(selected); }}
          initialCols={{
            categoryB: cols.showCategoryB, bioStatus: cols.showBioStatus,
            originalDrug: cols.showOriginalDrug, insuranceCode: cols.showInsuranceCode, notes: cols.showNotes,
          }}
        />
      )}

      {/* ── 엑셀 대량등록 모달 ── */}
      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900 text-base">엑셀 대량등록</h3>
              <button onClick={() => setBulkOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
              {/* 파일 선택 */}
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  엑셀 파일의 <span className="font-bold text-blue-600">A열</span>에 보험코드를 넣어주세요.<br/>
                  <span className="text-xs text-gray-400">보험코드(9자리)는 자동 매칭, 그 외는 미인식으로 표시됩니다.</span>
                </p>
                <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-blue-300 rounded-xl p-5 cursor-pointer hover:bg-blue-50 transition-all">
                  <Upload className="w-5 h-5 text-blue-400" />
                  <span className="text-sm text-blue-600 font-medium">파일 선택 (.xlsx, .xls)</span>
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleBulkFile} />
                </label>
              </div>

              {/* 미리보기 */}
              {bulkPreview.length > 0 && !bulkResult && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-600">인식된 코드 ({bulkPreview.length}개)</p>
                    <div className="flex gap-2 text-xs">
                      <span className="text-blue-600">{bulkPreview.filter(p => p.matched).length}개 매칭 예상</span>
                      <span className="text-orange-500">{bulkPreview.filter(p => !p.matched).length}개 미인식 예상</span>
                    </div>
                  </div>
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                    {bulkPreview.map((p, i) => (
                      <div key={i} className={`flex items-center justify-between px-3 py-2 text-xs border-b border-gray-100 last:border-0 ${p.matched ? "bg-white" : "bg-orange-50"}`}>
                        <span className="font-mono text-gray-700">{p.code}</span>
                        {p.matched
                          ? <span className="text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">보험코드</span>
                          : <span className="text-orange-600 bg-orange-100 border border-orange-200 px-1.5 py-0.5 rounded flex items-center gap-1"><AlertCircle className="w-3 h-3" />미인식</span>
                        }
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 결과 */}
              {bulkResult && (
                <div className="space-y-3">
                  <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                    <p className="text-green-700 font-bold text-lg">{bulkResult.added}개 추가 완료</p>
                    {bulkResult.unmatched.length > 0 && (
                      <p className="text-xs text-orange-600 mt-1">{bulkResult.unmatched.length}개는 보험코드 미인식 (제안서에 표시됨)</p>
                    )}
                  </div>
                  {bulkResult.unmatched.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">미인식 코드 (제안서에 표기됨)</p>
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 max-h-32 overflow-y-auto">
                        {bulkResult.unmatched.map((code, i) => (
                          <span key={i} className="inline-block font-mono text-xs text-orange-700 mr-2 mb-1">{code}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => setBulkOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                {bulkResult ? "닫기" : "취소"}
              </button>
              {bulkPreview.length > 0 && !bulkResult && (
                <button onClick={submitBulk} disabled={bulkLoading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-2">
                  {bulkLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {bulkLoading ? "등록 중..." : `${bulkPreview.length}개 제안서에 추가`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProposalsPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div className="flex justify-center py-20 text-gray-400">불러오는 중...</div>}>
        <ProposalsContent />
      </Suspense>
    </RequireAuth>
  );
}
