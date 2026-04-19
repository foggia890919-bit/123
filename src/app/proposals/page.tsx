"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Plus, Trash2, FileSpreadsheet, FileDown, FileText, X, Edit2, Check, Building2, Search, ChevronDown, ChevronUp, Filter, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/utils";
import RequireAuth from "@/components/RequireAuth";
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
interface ProposalItem { id: string; altMedication: Medication | null; order: number; }
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
  const isSalesRep = session?.user?.role === "SALES_REP";

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [userClients, setUserClients] = useState<UserClient[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [companyStatuses, setCompanyStatuses] = useState<Record<string, string>>({});
  const [cols, setCols] = useState<ColumnVisibility>({ showRate: true, showInsuranceCode: true });
  const [ingredientModal, setIngredientModal] = useState<{ name: string; categoryB?: string | null } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [requestingFilter, setRequestingFilter] = useState<Set<string>>(new Set());

  const loadProposals = useCallback(async () => {
    if (!userId) return;
    const res = await fetch(`/api/proposals?userId=${userId}`);
    const data = await res.json();
    const list: Proposal[] = Array.isArray(data) ? data : [];
    setProposals(list);
    setLoading(false);

    const idParam = searchParams.get("id");
    if (idParam) {
      const found = list.find((p) => p.id === idParam);
      if (found) loadProposal(found);
    } else if (list.length > 0 && !selected) {
      loadProposal(list[0]);
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
      const name = item.altMedication?.companyName;
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

  function toggleCompanyExpand(name: string) {
    setExpandedCompanies((prev) => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }

  async function requestFilter(companyName: string) {
    if (!selected?.client) {
      alert("거래처가 연결된 제안서에서만 바로 요청할 수 있습니다.\n제안서에 거래처를 먼저 지정해주세요.");
      return;
    }
    const existing = companyStatuses[companyName];
    if (existing === "PENDING" || existing === "REVIEWING" || existing === "APPROVED") return;
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
    XLSX.writeFile(wb, `${selected.title}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function exportPDF() {
    if (!selected?.items) return;
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(selected.title, 14, 15);
    doc.setFontSize(9);
    doc.text(`작성일: ${new Date().toLocaleDateString("ko-KR")}`, 14, 22);
    const withRate = isSalesRep && cols.showRate;
    const head = ["순번", "품목명", "성분명", "제약사"];
    if (cols.showCategoryB) head.push("분류B");
    if (cols.showBioStatus) head.push("생동/생산");
    if (cols.showOriginalDrug) head.push("오리지날");
    if (cols.showInsuranceCode) head.push("보험코드");
    if (cols.showNotes) head.push("특이사항");
    head.push("약가");
    if (withRate) head.push("기본수수료", "추가수수료", "합계수수료", "정산금액");
    const body = selected.items.map((item, i) => {
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
        row.push(base != null ? `${base}%` : "-", extra != null ? `${extra}%` : "-",
          total != null ? `${total}%` : "-", settlement != null ? `${settlement.toLocaleString()}원` : "-");
      }
      return row;
    });
    autoTable(doc, { startY: 28, head: [head], body, styles: { fontSize: 8 }, headStyles: { fillColor: [37, 99, 235] } });
    doc.save(`${selected.title}_${new Date().toISOString().slice(0, 10)}.pdf`);
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
          <select
            value={newClientId}
            onChange={(e) => setNewClientId(e.target.value)}
            className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="">거래처 미지정</option>
            {userClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.clientName}{!c.approved ? " (승인전)" : ""}
              </option>
            ))}
          </select>
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
                        {!isApproved && (
                          <button
                            onClick={() => requestFilter(name)}
                            disabled={requestingFilter.has(name) || status === "PENDING" || status === "REVIEWING"}
                            className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-100 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed">
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
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold text-gray-900 truncate">{selected.title}</h2>
                      {selected.client ? (
                        <p className="text-xs text-gray-400">{selected.client.clientName} · {selected.client.bizNumber}</p>
                      ) : (
                        <p className="text-xs text-gray-300">거래처 미지정</p>
                      )}
                    </div>
                    <button onClick={() => { setEditTitle(selected.title); setEditingTitle(true); }}
                      className="text-gray-400 hover:text-gray-600 shrink-0"><Edit2 className="w-4 h-4" /></button>
                    <span className="text-sm text-gray-400 shrink-0">{selected.items?.length ?? 0}개</span>
                  </>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
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
                <div className="flex justify-end">
                  <ColumnToggles cols={cols} setCols={setCols} isSalesRep={isSalesRep} />
                </div>
                <div className="overflow-x-auto overflow-y-auto max-h-[60vh] md:flex-1 rounded-lg border border-gray-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                      <tr className="text-xs text-gray-500 font-semibold whitespace-nowrap">
                        <th className="px-3 py-2.5 text-left w-8">#</th>
                        <th className="px-3 py-2.5 text-left min-w-[120px]">품목명</th>
                        <th className="px-3 py-2.5 text-left min-w-[100px]">성분명</th>
                        <th className="px-3 py-2.5 text-center w-24"></th>
                        <th className="px-3 py-2.5 text-left min-w-[90px]">제약사</th>
                        {cols.showCategoryB && <th className="px-3 py-2.5 text-center">분류B</th>}
                        {cols.showBioStatus && <th className="px-3 py-2.5 text-center">생동/생산</th>}
                        {cols.showOriginalDrug && <th className="px-3 py-2.5 text-center">오리지날</th>}
                        {cols.showInsuranceCode && <th className="px-3 py-2.5 text-left">보험코드</th>}
                        {cols.showNotes && <th className="px-3 py-2.5 text-left">특이사항</th>}
                        <th className="px-3 py-2.5 text-right">약가</th>
                        {isSalesRep && cols.showRate && (
                          <>
                            <th className="px-3 py-2.5 text-right">기본수수료</th>
                            <th className="px-3 py-2.5 text-right">추가수수료</th>
                            <th className="px-3 py-2.5 text-right">합계수수료</th>
                            <th className="px-3 py-2.5 text-right">정산금액</th>
                          </>
                        )}
                        <th className="px-3 py-2.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {selected.items.map((item, i) => {
                        const m = item.altMedication;
                        const base = m?.commissionRate ?? null;
                        const extra = m?.additionalRate ?? null;
                        const total = base != null ? base + (extra ?? 0) : null;
                        const settlement = m?.price != null && total != null ? Math.round(m.price * total / 100) : null;
                        return (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                            <td className="px-3 py-2.5">
                              <p className="font-medium text-gray-900 text-sm whitespace-nowrap">
                                {m?.productName || "-"}
                                {m?.isSettlement && (m.settlementType === "원외" || m.settlementType === "원내") && (
                                  <span className={`inline-block text-[10px] border px-1 py-0.5 rounded ml-1 align-middle ${
                                    m.settlementType === "원외" ? "text-blue-700 bg-blue-50 border-blue-200" : "text-indigo-700 bg-indigo-50 border-indigo-200"
                                  }`}>{m.settlementType === "원외" ? "cso" : "원내가능"}</span>
                                )}
                              </p>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[140px] truncate">{m?.ingredientName || "-"}</td>
                            <td className="px-3 py-2.5 text-center">
                              {m && (
                                <button onClick={() => setIngredientModal({ name: m.ingredientName, categoryB: m.categoryB })}
                                  className="text-xs text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded px-2 py-1 whitespace-nowrap">
                                  <Search className="w-3 h-3 inline mr-0.5" />동일성분
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{m?.companyName || "-"}</td>
                            {cols.showCategoryB && <td className="px-3 py-2.5 text-center text-xs text-gray-500">{m?.categoryB || "-"}</td>}
                            {cols.showBioStatus && <td className="px-3 py-2.5 text-center text-xs text-gray-500">{m?.bioStatus || "-"}</td>}
                            {cols.showOriginalDrug && <td className="px-3 py-2.5 text-center text-xs text-gray-500">{m?.originalDrug || "-"}</td>}
                            {cols.showInsuranceCode && <td className="px-3 py-2.5 text-xs font-mono text-gray-500">{m?.insuranceCode || "-"}</td>}
                            {cols.showNotes && <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[100px] truncate">{m?.notes || "-"}</td>}
                            <td className="px-3 py-2.5 text-right text-sm text-gray-700 whitespace-nowrap">{formatPrice(m?.price)}</td>
                            {isSalesRep && cols.showRate && (
                              <>
                                <td className="px-3 py-2.5 text-right text-sm text-blue-600 font-medium whitespace-nowrap">{base != null ? `${base}%` : "-"}</td>
                                <td className="px-3 py-2.5 text-right text-sm text-gray-500 whitespace-nowrap">{extra != null ? `${extra}%` : "-"}</td>
                                <td className="px-3 py-2.5 text-right text-sm font-semibold text-blue-700 whitespace-nowrap">{total != null ? `${total}%` : "-"}</td>
                                <td className="px-3 py-2.5 text-right text-sm font-semibold text-green-700 whitespace-nowrap">{settlement != null ? `${settlement.toLocaleString()}원` : "-"}</td>
                              </>
                            )}
                            <td className="px-3 py-2.5">
                              <button onClick={() => removeItem(item.id)} className="text-red-400 hover:text-red-600 p-1">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {ingredientModal && (
        <SameIngredientModal
          ingredientName={ingredientModal.name}
          categoryBCode={ingredientModal.categoryB ?? undefined}
          userId={userId}
          onClose={() => { setIngredientModal(null); if (selected) loadProposal(selected); }}
          initialCols={{
            categoryB: cols.showCategoryB, bioStatus: cols.showBioStatus,
            originalDrug: cols.showOriginalDrug, insuranceCode: cols.showInsuranceCode, notes: cols.showNotes,
          }}
        />
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
