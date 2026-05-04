"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Plus, Pencil, Trash2, Search, Loader2, X, RefreshCw,
  ToggleLeft, ToggleRight, KeyRound, AlertCircle, CheckCircle2,
  FileSpreadsheet, Download,
} from "lucide-react";

interface SalesRep { id: string; name: string | null; email: string; }
interface EpharmsAccount {
  id: string; bizNumber: string; clientName: string; loginId: string;
  active: boolean; lastSyncedAt: string | null; lastSyncStatus: string | null;
  lastSyncError: string | null; memo: string | null;
  createdAt: string; updatedAt: string;
  assignedSalesRepUserId: string | null;
  assignedSalesRep: SalesRep | null;
}

const EMPTY = { bizNumber: "", clientName: "", loginId: "", loginPw: "", memo: "", assignedSalesRepUserId: "" };

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function StatusBadge({ status, error }: { status: string | null; error: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">미실행</span>;
  if (status === "ok")
    return <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> 성공</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-red-700" title={error ?? ""}><AlertCircle className="w-3.5 h-3.5" /> 실패</span>;
}

function EpharmsAccountsContent() {
  const [items, setItems] = useState<EpharmsAccount[]>([]);
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [edit, setEdit] = useState<EpharmsAccount | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/epharms-accounts${search ? `?q=${encodeURIComponent(search)}` : ""}`;
      const r = await fetch(url);
      if (r.ok) setItems(await r.json());
    } finally { setLoading(false); }
  }, [search]);

  const loadReps = useCallback(async () => {
    const r = await fetch("/api/users/sales-reps").catch(() => null);
    if (r && r.ok) { const body = await r.json(); setReps(body.reps ?? []); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadReps(); }, [loadReps]);

  function openAdd() { setForm(EMPTY); setEdit(null); setModal("add"); }
  function openEdit(a: EpharmsAccount) {
    setEdit(a);
    setForm({
      bizNumber: a.bizNumber, clientName: a.clientName, loginId: a.loginId,
      loginPw: "", memo: a.memo ?? "",
      assignedSalesRepUserId: a.assignedSalesRepUserId ?? "",
    });
    setModal("edit");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const isEdit = modal === "edit" && edit;
      const r = await fetch("/api/epharms-accounts", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? {
          id: edit!.id, clientName: form.clientName, loginId: form.loginId,
          ...(form.loginPw ? { loginPw: form.loginPw } : {}),
          memo: form.memo,
          assignedSalesRepUserId: form.assignedSalesRepUserId || null,
        } : {
          bizNumber: form.bizNumber.replace(/[^0-9]/g, ""),
          clientName: form.clientName, loginId: form.loginId, loginPw: form.loginPw,
          memo: form.memo,
          assignedSalesRepUserId: form.assignedSalesRepUserId || null,
        }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || "저장 실패"); return; }
      setModal(null); await load();
    } finally { setSaving(false); }
  }

  async function handleToggle(a: EpharmsAccount) {
    await fetch("/api/epharms-accounts", { method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, active: !a.active }) });
    await load();
  }
  async function handleDelete(a: EpharmsAccount) {
    if (!confirm(`${a.clientName} 계정을 삭제하시겠습니까?\n저장된 매출원장 데이터도 모두 삭제됩니다.`)) return;
    await fetch(`/api/epharms-accounts?id=${a.id}`, { method: "DELETE" });
    await load();
  }
  async function syncAll() {
    if (!confirm("지금 전체 활성 계정의 매출원장을 다시 긁어옵니다. (수십분 소요 가능)\n진행할까요?")) return;
    setSyncingAll(true);
    try {
      const r = await fetch("/api/epharms-accounts/sync", { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) alert(body.error || "워커 호출 실패");
      else alert("백그라운드 sync 시작됨. 잠시 후 새로고침으로 결과 확인하세요.");
    } finally { setSyncingAll(false); }
  }
  async function syncOne(a: EpharmsAccount) {
    setSyncingId(a.id);
    try {
      const r = await fetch(`/api/epharms-accounts/sync?accountId=${a.id}`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) alert(body.error || "워커 호출 실패");
      else alert(`${a.clientName} sync 시작됨. 30초~1분 후 새로고침해보세요.`);
    } finally { setSyncingId(null); }
  }
  async function downloadTemplate() {
    const r = await fetch("/api/epharms-accounts/template");
    if (!r.ok) { alert("양식 다운로드 실패"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "epharms-accounts-template.xlsx"; a.click();
    URL.revokeObjectURL(url);
  }
  async function bulkUpload(file: File) {
    setBulkUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/epharms-accounts/bulk", { method: "POST", body: fd });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { alert(body.error || "업로드 실패"); return; }
      const failedRows = (body.results ?? []).filter((x: { status: string }) => x.status === "failed");
      let msg = `완료: 신규 ${body.inserted} / 갱신 ${body.updated} / 실패 ${body.failed} (총 ${body.total})`;
      if (failedRows.length) {
        msg += "\n\n실패 행:\n" + failedRows.slice(0, 10)
          .map((x: { row: number; clientName: string; error: string }) => `  ${x.row}행 ${x.clientName}: ${x.error}`)
          .join("\n");
        if (failedRows.length > 10) msg += `\n... 외 ${failedRows.length - 10}건`;
      }
      alert(msg);
      await load();
    } finally {
      setBulkUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ePharms 매출원장 자동수집</h1>
            <p className="text-sm text-gray-500 mt-1">
              거래처별 yk.ep45.co.kr 로그인 계정 등록 → 매일 00:00(KST) 자동 sync.
              KMD 포털 “매출원장” 메뉴에서 영업사원/거래처가 본인 분만 조회.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={syncAll} disabled={syncingAll}
              className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {syncingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              지금 전체 sync
            </button>
            <button onClick={downloadTemplate}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm font-medium rounded-lg" title="엑셀 양식 다운로드">
              <Download className="w-4 h-4" /> 양식 다운로드
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) bulkUpload(f); }} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} disabled={bulkUploading}
              className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
              {bulkUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              엑셀 일괄등록
            </button>
            <button onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
              <Plus className="w-4 h-4" /> 계정 추가
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="거래처명 / 사업자번호 / 로그인ID 검색"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={load} className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">새로고침</button>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">거래처</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">사업자번호</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">ePharms ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">담당 영업사원</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">최근 sync</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">상태</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">활성</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> 불러오는 중…</td></tr>}
              {!loading && items.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">등록된 계정이 없습니다. “계정 추가” 또는 “엑셀 일괄등록”으로 시작하세요.</td></tr>}
              {items.map((a) => (
                <tr key={a.id} className={a.active ? "" : "bg-gray-50 opacity-60"}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{a.clientName}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">{a.bizNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">{a.loginId}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {a.assignedSalesRep
                      ? <>{a.assignedSalesRep.name ?? "(이름 없음)"} <span className="text-gray-400">({a.assignedSalesRep.email})</span></>
                      : <span className="text-gray-300">— 미지정</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(a.lastSyncedAt)}</td>
                  <td className="px-4 py-3"><StatusBadge status={a.lastSyncStatus} error={a.lastSyncError} /></td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(a)} title={a.active ? "비활성화" : "활성화"}>
                      {a.active ? <ToggleRight className="w-6 h-6 text-blue-600" /> : <ToggleLeft className="w-6 h-6 text-gray-400" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button onClick={() => syncOne(a)} disabled={syncingId === a.id || !a.active}
                        className="p-1.5 text-orange-600 hover:bg-orange-50 rounded disabled:opacity-30" title="이 계정만 지금 sync">
                        {syncingId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      </button>
                      <button onClick={() => openEdit(a)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="수정"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(a)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="삭제"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-blue-600" />
                {modal === "add" ? "ePharms 계정 추가" : "ePharms 계정 수정"}
              </h2>
              <button onClick={() => setModal(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">사업자번호 *</label>
                <input value={form.bizNumber} onChange={(e) => setForm({ ...form, bizNumber: e.target.value })}
                  disabled={modal === "edit"} placeholder="숫자만 (예: 2110948285)"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-50" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">거래처명 *</label>
                <input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">ePharms 로그인 ID *</label>
                <input value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  ePharms 비밀번호 {modal === "add" ? "*" : "(변경할 때만 입력)"}
                </label>
                <input type="password" value={form.loginPw}
                  onChange={(e) => setForm({ ...form, loginPw: e.target.value })}
                  placeholder={modal === "edit" ? "비워두면 기존 PW 유지" : ""}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono" />
                <p className="text-[11px] text-gray-400 mt-1">서버에 AES-256-GCM 암호화하여 저장되며, 화면이나 API 응답에 절대 노출되지 않습니다.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">담당 영업사원</label>
                <select value={form.assignedSalesRepUserId}
                  onChange={(e) => setForm({ ...form, assignedSalesRepUserId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">
                  <option value="">— 미지정 —</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>{(r.name ?? "(이름 없음)")}({r.email})</option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">KMD에 등록된 영업사원 (role=SALES_REP, 승인됨)만 선택 가능.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">메모</label>
                <textarea value={form.memo} rows={2}
                  onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 pb-5">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {modal === "add" ? "추가" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function EpharmsAccountsPage() {
  return (<BizLayout><EpharmsAccountsContent /></BizLayout>);
}
