"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Plus, Trash2, FileSpreadsheet, FileDown, FileText, X, Edit2, Check, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/utils";
import RequireAuth from "@/components/RequireAuth";
import * as XLSX from "xlsx";

interface Medication {
  id: string; productName: string; companyName: string; ingredientName: string;
  price: number | null; commissionRate: number | null; insuranceCode: string | null;
}
interface ProposalItem { id: string; altMedication: Medication | null; order: number; }
interface Proposal { id: string; title: string; _count?: { items: number }; items?: ProposalItem[]; createdAt: string; }

function StatusBadge({ status }: { status: string }) {
  if (status === "APPROVED") return <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">거래가능</span>;
  if (status === "REVIEWING") return <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded">검토중</span>;
  if (status === "PENDING") return <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">요청됨</span>;
  if (status === "REJECTED") return <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">거부됨</span>;
  return <span className="text-xs text-gray-400">-</span>;
}

function ProposalsContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const userId = session?.user?.id || "";

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [companyStatuses, setCompanyStatuses] = useState<Record<string, string>>({});

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
  }

  useEffect(() => { if (userId) loadProposals(); }, [userId, loadProposals]);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/filter-request/company-status?userId=${userId}`)
      .then((r) => r.json())
      .then(setCompanyStatuses);
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
    if (!newTitle.trim()) return;
    setCreating(true);
    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim(), userId }),
    });
    if (res.ok) {
      const p = await res.json();
      setNewTitle("");
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

  function exportExcel() {
    if (!selected?.items) return;
    const rows = selected.items.map((item, i) => ({
      순번: i + 1,
      품목명: item.altMedication?.productName || "-",
      성분명: item.altMedication?.ingredientName || "-",
      제약사: item.altMedication?.companyName || "-",
      약가: item.altMedication?.price || "-",
      "수수료율(%)": item.altMedication?.commissionRate || "-",
      보험코드: item.altMedication?.insuranceCode || "-",
    }));
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
    autoTable(doc, {
      startY: 28,
      head: [["순번", "품목명", "성분명", "제약사", "약가", "수수료율", "보험코드"]],
      body: selected.items.map((item, i) => [
        i + 1,
        item.altMedication?.productName || "-",
        item.altMedication?.ingredientName || "-",
        item.altMedication?.companyName || "-",
        item.altMedication?.price ? `${item.altMedication.price.toLocaleString()}원` : "-",
        item.altMedication?.commissionRate ? `${item.altMedication.commissionRate}%` : "-",
        item.altMedication?.insuranceCode || "-",
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
    });
    doc.save(`${selected.title}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  if (loading) return <div className="flex justify-center py-20 text-gray-400">불러오는 중...</div>;

  return (
    <div className="flex gap-5 h-[calc(100vh-120px)]">
      {/* 왼쪽: 제안서 목록 */}
      <div className="w-64 shrink-0 flex flex-col gap-3">
        <div className="space-y-1">
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            placeholder="새 제안서 이름..." className="h-9 text-sm"
            onKeyDown={(e) => e.key === "Enter" && createProposal()} />
          <Button onClick={createProposal} disabled={!newTitle.trim() || creating} className="w-full h-9 text-sm">
            <Plus className="w-3.5 h-3.5 mr-1" />{creating ? "생성 중..." : "새 제안서 만들기"}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {proposals.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">제안서가 없어요</p>
          ) : proposals.map((p) => (
            <div key={p.id}
              onClick={() => loadProposal(p)}
              className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${selected?.id === p.id ? "bg-blue-50 border border-blue-200" : "bg-white border border-gray-200 hover:bg-gray-50"}`}>
              <div className="flex items-center gap-2 min-w-0">
                <FileText className={`w-4 h-4 shrink-0 ${selected?.id === p.id ? "text-blue-600" : "text-gray-400"}`} />
                <div className="min-w-0">
                  <p className={`text-sm font-medium truncate ${selected?.id === p.id ? "text-blue-700" : "text-gray-800"}`}>{p.title}</p>
                  <p className="text-xs text-gray-400">{p._count?.items ?? 0}개 품목</p>
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

      {/* 가운데: 선택된 제안서 내용 */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 bg-white rounded-lg border border-gray-200">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>왼쪽에서 제안서를 선택하거나 새로 만들어요</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {editingTitle ? (
                  <>
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                      className="h-9 text-lg font-bold w-72"
                      onKeyDown={(e) => e.key === "Enter" && saveTitle()} autoFocus />
                    <button onClick={saveTitle} className="text-green-600 hover:text-green-700"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditingTitle(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                  </>
                ) : (
                  <>
                    <h2 className="text-xl font-bold text-gray-900">{selected.title}</h2>
                    <button onClick={() => { setEditTitle(selected.title); setEditingTitle(true); }}
                      className="text-gray-400 hover:text-gray-600"><Edit2 className="w-4 h-4" /></button>
                  </>
                )}
                <span className="text-sm text-gray-400">{selected.items?.length ?? 0}개 품목</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={exportExcel} disabled={!selected.items?.length}>
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />엑셀
                </Button>
                <Button variant="outline" size="sm" onClick={exportPDF} disabled={!selected.items?.length}>
                  <FileDown className="w-3.5 h-3.5 mr-1" />PDF
                </Button>
              </div>
            </div>

            {!selected.items?.length ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 bg-white rounded-lg border border-gray-200">
                <p className="text-sm">검색 결과에서 품목을 추가해보세요</p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                    <tr className="text-xs text-gray-500 font-semibold">
                      <th className="px-4 py-3 text-left w-8">#</th>
                      <th className="px-4 py-3 text-left">품목명</th>
                      <th className="px-4 py-3 text-left">성분명</th>
                      <th className="px-4 py-3 text-left">제약사</th>
                      <th className="px-4 py-3 text-right">약가</th>
                      <th className="px-4 py-3 text-right">수수료율</th>
                      <th className="px-4 py-3 text-left">보험코드</th>
                      <th className="px-4 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selected.items.map((item, i) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900 text-sm">{item.altMedication?.productName || "-"}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px] truncate">{item.altMedication?.ingredientName || "-"}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">{item.altMedication?.companyName || "-"}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-700">{formatPrice(item.altMedication?.price)}</td>
                        <td className="px-4 py-3 text-right text-sm text-blue-600 font-medium">
                          {item.altMedication?.commissionRate != null ? `${item.altMedication.commissionRate}%` : "-"}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-gray-500">{item.altMedication?.insuranceCode || "-"}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => removeItem(item.id)} className="text-red-400 hover:text-red-600 p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* 오른쪽: 제약사 현황 */}
      {selected && (
        <div className="w-52 shrink-0 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-800">제약사 현황</h3>
            <span className="text-xs text-gray-400 ml-auto">{companySummary.length}개사</span>
          </div>
          <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-gray-200">
            {companySummary.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-xs text-gray-400">품목을 추가하면 표시돼요</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {companySummary.map(({ name, count }) => (
                  <div key={name} className="px-3 py-2.5">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <p className="text-xs font-medium text-gray-800 truncate">{name}</p>
                      <span className="text-xs text-gray-400 shrink-0">{count}개</span>
                    </div>
                    <StatusBadge status={companyStatuses[name] || ""} />
                  </div>
                ))}
              </div>
            )}
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
