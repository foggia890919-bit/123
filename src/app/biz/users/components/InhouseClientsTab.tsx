"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search, Plus, Trash2, Loader2, Upload, Download,
  X, AlertCircle, CheckCircle, Pencil, KeyRound,
  RefreshCw, ToggleLeft, ToggleRight, CheckCircle2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import type { InhouseAccount, InhouseKmdUser, InhouseKmdClient, InhouseBulkPreviewRow, InhouseBulkResult } from "./types";
import { INHOUSE_EMPTY } from "./types";
import { fmtDate } from "./utils";

function isInhouseIncomplete(a: InhouseAccount): boolean {
  if (!a.kmdUserId) return true;
  if (!a.lastSyncedAt) return true;
  if (a.lastSyncStatus === "error") return true;
  return false;
}

function inhouseMissingFields(a: InhouseAccount): string[] {
  const m: string[] = [];
  if (!a.kmdUserId) m.push("KMD 아이디");
  if (!a.lastSyncedAt) m.push("최근 sync");
  if (a.lastSyncStatus === "error") m.push("sync 실패");
  return m;
}

function InhouseStatusBadge({ status, error }: { status: string | null; error: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">미실행</span>;
  if (status === "ok")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <CheckCircle2 className="w-3.5 h-3.5" /> 성공
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-700" title={error ?? ""}>
      <AlertCircle className="w-3.5 h-3.5" /> 실패
    </span>
  );
}

function InhouseClientsTab() {
  const [items, setItems] = useState<InhouseAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "incomplete">("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [total, setTotal] = useState(0);
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [edit, setEdit] = useState<InhouseAccount | null>(null);
  const [form, setForm] = useState(INHOUSE_EMPTY);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [epharmsSyncRunning, setEpharmsSyncRunning] = useState<boolean | null>(null);
  const [resetting, setResetting] = useState(false);

  const [kmdClients, setKmdClients] = useState<InhouseKmdClient[]>([]);
  const [kmdSearch, setKmdSearch] = useState("");
  const [kmdOpen, setKmdOpen] = useState(false);
  const kmdRef = useRef<HTMLDivElement>(null);

  const [kmdUsers, setKmdUsers] = useState<InhouseKmdUser[]>([]);
  const [kmdUserSearch, setKmdUserSearch] = useState("");
  const [kmdUserOpen, setKmdUserOpen] = useState(false);
  const [selectedKmdUser, setSelectedKmdUser] = useState<InhouseKmdUser | null>(null);
  const kmdUserRef = useRef<HTMLDivElement>(null);

  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkPreview, setBulkPreview] = useState<InhouseBulkPreviewRow[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState<InhouseBulkResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const r = await fetch(`/api/epharms-accounts?${params.toString()}`);
      if (r.ok) {
        const body = await r.json();
        if (Array.isArray(body)) {
          setItems(body);
          setTotal(body.length);
        } else {
          setItems(body.items ?? []);
          setTotal(body.total ?? 0);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [search, page, limit]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, limit]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (kmdRef.current && !kmdRef.current.contains(e.target as Node)) {
        setKmdOpen(false);
      }
      if (kmdUserRef.current && !kmdUserRef.current.contains(e.target as Node)) {
        setKmdUserOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  async function fetchKmdClients() {
    try {
      const r = await fetch("/api/epharms-accounts/clients");
      if (r.ok) {
        const data = await r.json();
        setKmdClients(data.items ?? []);
      }
    } catch {
      setKmdClients([]);
    }
  }

  const kmdUserSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!kmdUserOpen) return;
    if (kmdUserSearchTimer.current) clearTimeout(kmdUserSearchTimer.current);
    kmdUserSearchTimer.current = setTimeout(async () => {
      try {
        const url = `/api/epharms-accounts/users${kmdUserSearch ? `?q=${encodeURIComponent(kmdUserSearch)}` : ""}`;
        const r = await fetch(url);
        if (r.ok) {
          const data = await r.json();
          setKmdUsers(data.items ?? []);
        }
      } catch {
        setKmdUsers([]);
      }
    }, 200);
    return () => {
      if (kmdUserSearchTimer.current) clearTimeout(kmdUserSearchTimer.current);
    };
  }, [kmdUserSearch, kmdUserOpen]);

  function selectKmdUser(u: InhouseKmdUser) {
    setSelectedKmdUser(u);
    setForm((prev) => ({ ...prev, kmdUserId: u.id }));
    setKmdUserSearch(u.email);
    setKmdUserOpen(false);
  }

  function clearKmdUser() {
    setSelectedKmdUser(null);
    setForm((prev) => ({ ...prev, kmdUserId: "" }));
    setKmdUserSearch("");
  }

  function openAdd() {
    setForm(INHOUSE_EMPTY);
    setEdit(null);
    setKmdSearch("");
    setKmdOpen(false);
    setKmdUserSearch("");
    setKmdUserOpen(false);
    setSelectedKmdUser(null);
    setModal("add");
    fetchKmdClients();
  }

  function openEdit(a: InhouseAccount) {
    setEdit(a);
    setForm({
      bizNumber: a.bizNumber,
      clientName: a.clientName,
      loginId: a.loginId,
      loginPw: "",
      memo: a.memo ?? "",
      kmdUserId: a.kmdUserId ?? "",
    });
    setSelectedKmdUser(a.kmdUser ?? null);
    setKmdUserSearch(a.kmdUser?.email ?? "");
    setKmdUserOpen(false);
    setModal("edit");
  }

  function selectKmdClient(c: InhouseKmdClient) {
    setForm((prev) => ({ ...prev, bizNumber: c.bizNumber, clientName: c.clientName }));
    setKmdSearch(c.clientName);
    setKmdOpen(false);
  }

  const filteredKmd = kmdClients.filter(
    (c) => c.clientName.includes(kmdSearch) || c.bizNumber.includes(kmdSearch)
  );

  async function handleSave() {
    setSaving(true);
    try {
      const isEdit = modal === "edit" && edit;
      const r = await fetch("/api/epharms-accounts", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? {
                id: edit!.id,
                clientName: form.clientName,
                loginId: form.loginId,
                ...(form.loginPw ? { loginPw: form.loginPw } : {}),
                memo: form.memo,
                kmdUserId: form.kmdUserId || null,
              }
            : {
                bizNumber: form.bizNumber.replace(/[^0-9]/g, ""),
                clientName: form.clientName,
                loginId: form.loginId,
                loginPw: form.loginPw,
                memo: form.memo,
                kmdUserId: form.kmdUserId || null,
              }
        ),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert((e as { error?: string }).error || "저장 실패");
        return;
      }
      setModal(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(a: InhouseAccount) {
    await fetch("/api/epharms-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, active: !a.active }),
    });
    await load();
  }

  async function handleDelete(a: InhouseAccount) {
    if (!confirm(`${a.clientName} 계정을 삭제하시겠습니까?\n저장된 매출원장 데이터도 모두 삭제됩니다.`)) return;
    await fetch(`/api/epharms-accounts?id=${a.id}`, { method: "DELETE" });
    await load();
  }

  // 10초마다 워커 sync 상태 폴링 — stuck 감지 시 강제 재시작 버튼 표시
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await fetch("/api/epharms-accounts/sync/reset");
        if (r.ok) {
          const body = await r.json() as { epharmsSyncRunning?: boolean | null };
          setEpharmsSyncRunning(body.epharmsSyncRunning ?? null);
        }
      } catch { /* ignore */ }
      timer = setTimeout(poll, 10_000);
    }
    poll();
    return () => clearTimeout(timer);
  }, []);

  async function forceRestart() {
    if (!confirm("현재 sync를 강제 중지하고 즉시 재시작합니다.\n계속하시겠습니까?")) return;
    setResetting(true);
    try {
      const r = await fetch("/api/epharms-accounts/sync/reset", { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) alert((body as { error?: string }).error || "강제 재시작 실패");
      else {
        alert("강제 재시작됨. 잠시 후 새로고침으로 결과 확인하세요.");
        setEpharmsSyncRunning(true);
      }
    } finally {
      setResetting(false);
    }
  }

  async function syncAll() {
    if (!confirm("지금 전체 활성 계정의 매출원장을 다시 긁어옵니다.\n진행할까요?")) return;
    setSyncingAll(true);
    try {
      const r = await fetch("/api/epharms-accounts/sync", { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) alert((body as { error?: string }).error || "워커 호출 실패");
      else alert("백그라운드 sync 시작됨. 잠시 후 새로고침으로 결과 확인하세요.");
    } finally {
      setSyncingAll(false);
    }
  }

  async function syncOne(a: InhouseAccount) {
    setSyncingId(a.id);
    try {
      const r = await fetch(`/api/epharms-accounts/sync?accountId=${a.id}`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) alert((body as { error?: string }).error || "워커 호출 실패");
      else alert(`${a.clientName} sync 시작됨. 30초~1분 후 새로고침해보세요.`);
    } finally {
      setSyncingId(null);
    }
  }

  function openBulkModal() {
    setBulkFile(null);
    setBulkPreview([]);
    setBulkResult(null);
    setBulkSubmitting(false);
    setBulkModal(true);
  }

  async function handleBulkFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFile(file);
    setBulkResult(null);
    try {
      const { read, utils } = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = read(new Uint8Array(buffer), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const preview: InhouseBulkPreviewRow[] = rows.slice(0, 10).map((r) => ({
        bizNumber: String(r["사업자번호"] ?? "").replace(/[^0-9]/g, ""),
        clientName: String(r["거래처명"] ?? "").trim(),
        loginId: String(r["이팜스ID"] ?? "").trim(),
        loginPw: String(r["이팜스PW"] ?? "").trim(),
        kmdEmail: String(r["KMD아이디"] ?? "").trim(),
        memo: String(r["메모"] ?? "").trim(),
        kmdUserEmail: String(r["KMD아이디(이메일)"] ?? r["KMD아이디"] ?? "").trim(),
      }));
      setBulkPreview(preview);
    } catch {
      setBulkPreview([]);
    }
  }

  async function handleTemplateDownload() {
    const { utils, writeFile } = await import("xlsx");
    const ws = utils.aoa_to_sheet([
      ["사업자번호", "거래처명", "이팜스ID", "이팜스PW", "담당자코드", "메모", "KMD아이디(이메일)"],
      ["1234567890", "○○의원", "epharms_id", "epharms_pw", "S-0001", "", "user@example.com"],
    ]);
    ws["!cols"] = [{ wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 26 }];
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "계정목록");
    writeFile(wb, "epharms_accounts_template.xlsx");
  }

  async function handleBulkSubmit() {
    if (!bulkFile) return;
    setBulkSubmitting(true);
    setBulkResult(null);
    try {
      const fd = new FormData();
      fd.append("file", bulkFile);
      const r = await fetch("/api/epharms-accounts/bulk", { method: "POST", body: fd });
      const data: InhouseBulkResult = await r.json().catch(() => ({ created: 0, updated: 0, skipped: 0, errors: ["응답 파싱 실패"] }));
      if (!r.ok) {
        setBulkResult({ created: 0, updated: 0, skipped: 0, errors: [(data as { error?: string }).error ?? "업로드 실패"] });
        return;
      }
      setBulkResult(data);
      if (data.created > 0 || data.updated > 0) {
        await load();
      }
    } finally {
      setBulkSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 상단 액션 바 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-500">
          거래처별 yk.ep45.co.kr 로그인 계정 등록 → 매일 00:00(KST) 자동 sync
        </p>
        <div className="flex items-center gap-2">
          {epharmsSyncRunning && (
            <button
              onClick={forceRestart}
              disabled={resetting}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              강제 재시작
            </button>
          )}
          <button
            onClick={syncAll}
            disabled={syncingAll || !!epharmsSyncRunning}
            className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            title={epharmsSyncRunning ? "sync 진행 중 — 강제 재시작을 사용하세요" : undefined}
          >
            {syncingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            지금 전체 sync
          </button>
          <button
            onClick={openBulkModal}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg"
          >
            <Upload className="w-4 h-4" /> 엑셀 일괄등록
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
          >
            <Plus className="w-4 h-4" /> 계정 추가
          </button>
        </div>
      </div>

      {/* 검색 + 새로고침 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="거래처명 / 사업자번호 / 로그인ID 검색"
            className="pl-9 text-sm"
          />
        </div>
        <button onClick={load} className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
          새로고침
        </button>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => setFilterMode("all")}
          className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
            filterMode === "all" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          전체 ({items.length})
        </button>
        <button
          onClick={() => setFilterMode("incomplete")}
          className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
            filterMode === "incomplete"
              ? "bg-red-600 text-white"
              : items.filter(isInhouseIncomplete).length > 0
                ? "bg-red-50 text-red-700 hover:bg-red-100"
                : "bg-gray-100 text-gray-400"
          }`}
          title="KMD 아이디 미연결 / sync 미실행 / sync 실패 중 하나라도 있는 계정"
        >
          정보 누락 ({items.filter(isInhouseIncomplete).length})
        </button>
      </div>

      {/* 테이블 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">거래처</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">사업자번호</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">ePharms ID</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">KMD 아이디</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">최근 sync</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">상태</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">활성</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> 불러오는 중…
              </td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                등록된 계정이 없습니다. "계정 추가" 버튼으로 시작하세요.
              </td></tr>
            )}
            {!loading && items.length > 0 && (filterMode === "incomplete"
              ? items.filter(isInhouseIncomplete)
              : items
            ).length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                필터에 해당하는 계정이 없습니다.
              </td></tr>
            )}
            {(filterMode === "incomplete" ? items.filter(isInhouseIncomplete) : items).map((a) => {
              const missing = inhouseMissingFields(a);
              return (
                <tr key={a.id} className={a.active ? "" : "bg-gray-50 opacity-60"}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    <div>{a.clientName}</div>
                    {missing.length > 0 && (
                      <div className="text-[11px] text-red-500 mt-0.5">누락: {missing.join(", ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">{a.bizNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 font-mono">{a.loginId}</td>
                  <td className="px-4 py-3 text-xs">
                    {a.kmdUser ? (
                      <div className="flex flex-col">
                        <span className="font-mono text-gray-700">{a.kmdUser.email}</span>
                        {a.kmdUser.name && <span className="text-[11px] text-gray-400">{a.kmdUser.name}</span>}
                      </div>
                    ) : (
                      <span className="text-gray-300">미연결</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(a.lastSyncedAt)}</td>
                  <td className="px-4 py-3"><InhouseStatusBadge status={a.lastSyncStatus} error={a.lastSyncError} /></td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(a)} title={a.active ? "비활성화" : "활성화"}>
                      {a.active
                        ? <ToggleRight className="w-6 h-6 text-blue-600" />
                        : <ToggleLeft className="w-6 h-6 text-gray-400" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => syncOne(a)}
                        disabled={syncingId === a.id || !a.active}
                        className="p-1.5 text-orange-600 hover:bg-orange-50 rounded disabled:opacity-30"
                        title="이 계정만 지금 sync"
                      >
                        {syncingId === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      </button>
                      <button onClick={() => openEdit(a)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="수정">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(a)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="삭제">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-xs text-gray-500">
            총 <span className="font-semibold text-gray-700">{total.toLocaleString()}</span>개 중{" "}
            <span className="font-semibold text-gray-700">{(page - 1) * limit + 1}</span>–
            <span className="font-semibold text-gray-700">{Math.min(page * limit, total)}</span> 표시
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="text-xs border border-gray-200 rounded px-2 py-1.5"
              title="페이지당 갯수"
            >
              {[20, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}개씩</option>
              ))}
            </select>
            <button onClick={() => setPage(1)} disabled={page <= 1}
              className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50">«</button>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50">이전</button>
            <span className="text-xs text-gray-600 px-2">
              <span className="font-semibold text-gray-900">{page}</span> / {totalPages}
            </span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50">다음</button>
            <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}
              className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50">»</button>
          </div>
        </div>
      )}

      {/* Add / Edit 모달 */}
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
              {modal === "add" && (
                <div ref={kmdRef} className="relative">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    KMD 거래처 선택 (선택시 자동입력)
                  </label>
                  <input
                    value={kmdSearch}
                    onChange={(e) => { setKmdSearch(e.target.value); setKmdOpen(true); }}
                    onFocus={() => setKmdOpen(true)}
                    placeholder="거래처명 또는 사업자번호 검색…"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {kmdOpen && filteredKmd.length > 0 && (
                    <ul className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                      {filteredKmd.map((c) => (
                        <li
                          key={c.bizNumber}
                          onMouseDown={() => selectKmdClient(c)}
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 flex items-center justify-between"
                        >
                          <span className="font-medium text-gray-800">{c.clientName}</span>
                          <span className="text-xs text-gray-400 font-mono">{c.bizNumber}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {kmdOpen && kmdSearch.length > 0 && filteredKmd.length === 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-lg text-sm text-gray-400">
                      검색 결과 없음
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">사업자번호 *</label>
                <input
                  value={form.bizNumber}
                  onChange={(e) => setForm({ ...form, bizNumber: e.target.value })}
                  disabled={modal === "edit"}
                  placeholder="숫자만 (예: 2110948285)"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">거래처명 *</label>
                <input
                  value={form.clientName}
                  onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">ePharms 로그인 ID *</label>
                <input
                  value={form.loginId}
                  onChange={(e) => setForm({ ...form, loginId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  ePharms 비밀번호 {modal === "add" ? "*" : "(변경할 때만 입력)"}
                </label>
                <input
                  type="password"
                  value={form.loginPw}
                  onChange={(e) => setForm({ ...form, loginPw: e.target.value })}
                  placeholder={modal === "edit" ? "비워두면 기존 PW 유지" : ""}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  서버에 AES-256-GCM 암호화하여 저장되며, 화면이나 API 응답에 절대 노출되지 않습니다.
                </p>
              </div>
              <div ref={kmdUserRef} className="relative">
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  KMD 아이디 매핑 <span className="text-gray-400 font-normal">(선택 — 마이페이지 노출용)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    value={kmdUserSearch}
                    onChange={(e) => { setKmdUserSearch(e.target.value); setKmdUserOpen(true); }}
                    onFocus={() => setKmdUserOpen(true)}
                    placeholder="이메일 / 이름 / 전화 검색…"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {selectedKmdUser && (
                    <button
                      type="button"
                      onClick={clearKmdUser}
                      className="px-2 py-2 text-xs text-red-500 hover:bg-red-50 rounded"
                      title="매핑 해제"
                    >
                      해제
                    </button>
                  )}
                </div>
                {selectedKmdUser && (
                  <p className="text-[11px] text-blue-600 mt-1">
                    선택됨: <span className="font-mono">{selectedKmdUser.email}</span>
                    {selectedKmdUser.name ? ` (${selectedKmdUser.name})` : ""}
                  </p>
                )}
                {kmdUserOpen && kmdUsers.length > 0 && (
                  <ul className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                    {kmdUsers.map((u) => (
                      <li
                        key={u.id}
                        onMouseDown={() => selectKmdUser(u)}
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 flex items-center justify-between"
                      >
                        <span className="font-mono text-gray-800">{u.email}</span>
                        <span className="text-xs text-gray-400">{u.name ?? ""}{u.role ? ` · ${u.role}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {kmdUserOpen && kmdUserSearch.length > 0 && kmdUsers.length === 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-lg text-sm text-gray-400">
                    검색 결과 없음
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">메모</label>
                <textarea
                  value={form.memo}
                  rows={2}
                  onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 pb-5">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {modal === "add" ? "추가" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Upload 모달 */}
      {bulkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { if (!bulkSubmitting) setBulkModal(false); }}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Upload className="w-5 h-5 text-green-600" />
                엑셀 일괄등록
              </h2>
              {!bulkSubmitting && (
                <button onClick={() => setBulkModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
              )}
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-gray-500 leading-relaxed">
                  컬럼 순서:{" "}
                  {["사업자번호", "거래처명", "이팜스ID", "이팜스PW", "KMD아이디", "메모(선택)"].map((col) => (
                    <span key={col} className="inline-block font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mr-1">{col}</span>
                  ))}
                </p>
                <button
                  onClick={async () => {
                    const { utils, write } = await import("xlsx");
                    const ws = utils.aoa_to_sheet([["사업자번호", "거래처명", "이팜스ID", "이팜스PW", "KMD아이디", "메모"]]);
                    const wb = utils.book_new();
                    utils.book_append_sheet(wb, ws, "원내거래처");
                    const buf = write(wb, { type: "array", bookType: "xlsx" });
                    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = "원내거래처_일괄등록_양식.xlsx"; a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  양식 다운로드
                </button>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleBulkFileChange}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-green-400", "bg-green-50"); }}
                  onDragLeave={(e) => { e.currentTarget.classList.remove("border-green-400", "bg-green-50"); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("border-green-400", "bg-green-50");
                    const file = e.dataTransfer.files[0];
                    if (file) {
                      setBulkFile(file);
                      setBulkResult(null);
                      import("xlsx").then(({ read, utils }) => {
                        file.arrayBuffer().then((buffer) => {
                          const wb = read(new Uint8Array(buffer), { type: "array" });
                          const ws = wb.Sheets[wb.SheetNames[0]];
                          const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
                          setBulkPreview(rows.slice(0, 10).map((r) => ({
                            bizNumber: String(r["사업자번호"] ?? "").replace(/[^0-9]/g, ""),
                            clientName: String(r["거래처명"] ?? "").trim(),
                            loginId: String(r["이팜스ID"] ?? "").trim(),
                            loginPw: String(r["이팜스PW"] ?? "").trim(),
                            kmdEmail: String(r["KMD아이디"] ?? "").trim(),
                            kmdUserEmail: String(r["KMD아이디"] ?? "").trim(),
                            memo: String(r["메모"] ?? "").trim(),
                          })));
                        }).catch(() => setBulkPreview([]));
                      });
                    }
                  }}
                  className="cursor-pointer flex flex-col items-center justify-center gap-2 px-6 py-8 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-green-400 hover:bg-green-50 hover:text-green-700 transition-colors"
                >
                  <Upload className="w-7 h-7 text-gray-300" />
                  {bulkFile ? (
                    <span className="font-medium text-gray-700">{bulkFile.name}</span>
                  ) : (
                    <>
                      <span className="font-medium">파일을 여기에 끌어다 놓거나 클릭하여 선택</span>
                      <span className="text-xs text-gray-400">xlsx / xls</span>
                    </>
                  )}
                </div>
              </div>
              {bulkPreview.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">미리보기 (상위 {bulkPreview.length}행)</p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full text-xs divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">사업자번호</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">거래처명</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">이팜스ID</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">PW</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">KMD아이디</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">메모</th>
                          <th className="px-3 py-2 text-left font-semibold text-blue-600">KMD아이디</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bulkPreview.map((row, i) => (
                          <tr key={i} className={!row.bizNumber || !row.clientName || !row.loginId || !row.loginPw ? "bg-red-50" : ""}>
                            <td className="px-3 py-1.5 font-mono">{row.bizNumber || <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5">{row.clientName || <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5 font-mono">{row.loginId || <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5 font-mono">{row.loginPw ? "••••••" : <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5 text-gray-500">{row.kmdEmail || <span className="text-gray-300">—</span>}</td>
                            <td className="px-3 py-1.5 text-gray-400">{row.memo || "—"}</td>
                            <td className="px-3 py-1.5 text-blue-600 font-mono text-[11px]">{row.kmdUserEmail || <span className="text-gray-300">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {bulkResult && (
                <div className={`rounded-lg p-4 text-sm ${bulkResult.errors.length > 0 ? "bg-yellow-50 border border-yellow-200" : "bg-green-50 border border-green-200"}`}>
                  <p className="font-semibold mb-1">
                    {bulkResult.created}개 등록, {bulkResult.updated}개 업데이트, {bulkResult.skipped}개 스킵
                  </p>
                  {bulkResult.errors.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-red-700">
                      {bulkResult.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 pb-5 flex-shrink-0 border-t pt-4">
              <button
                onClick={() => setBulkModal(false)}
                disabled={bulkSubmitting}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                닫기
              </button>
              <button
                onClick={handleBulkSubmit}
                disabled={!bulkFile || bulkSubmitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              >
                {bulkSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                일괄 등록
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InhouseClientsTab;
