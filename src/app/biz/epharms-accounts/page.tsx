"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Plus, Pencil, Trash2, Search, Loader2, X, RefreshCw,
  ToggleLeft, ToggleRight, KeyRound, AlertCircle, CheckCircle2, Upload,
} from "lucide-react";

interface KmdUser {
  id: string;
  email: string;
  name: string | null;
  role?: string;
}

interface EpharmsAccount {
  id: string;
  bizNumber: string;
  clientName: string;
  loginId: string;
  active: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  memo: string | null;
  kmdUserId: string | null;
  kmdUser: KmdUser | null;
  createdAt: string;
  updatedAt: string;
}

interface KmdClient {
  bizNumber: string;
  clientName: string;
}

interface BulkResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

interface BulkPreviewRow {
  bizNumber: string;
  clientName: string;
  loginId: string;
  loginPw: string;
  memo: string;
}

const EMPTY = {
  bizNumber: "",
  clientName: "",
  loginId: "",
  loginPw: "",
  memo: "",
  kmdUserId: "" as string | "",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function StatusBadge({ status, error }: { status: string | null; error: string | null }) {
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

function EpharmsAccountsContent() {
  const [items, setItems] = useState<EpharmsAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [edit, setEdit] = useState<EpharmsAccount | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // KMD clients dropdown (add modal only)
  const [kmdClients, setKmdClients] = useState<KmdClient[]>([]);
  const [kmdSearch, setKmdSearch] = useState("");
  const [kmdOpen, setKmdOpen] = useState(false);
  const kmdRef = useRef<HTMLDivElement>(null);

  // KMD user (account holder) dropdown — add/edit 양쪽
  const [kmdUsers, setKmdUsers] = useState<KmdUser[]>([]);
  const [kmdUserSearch, setKmdUserSearch] = useState("");
  const [kmdUserOpen, setKmdUserOpen] = useState(false);
  const [selectedKmdUser, setSelectedKmdUser] = useState<KmdUser | null>(null);
  const kmdUserRef = useRef<HTMLDivElement>(null);

  // Bulk modal state
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/epharms-accounts${search ? `?q=${encodeURIComponent(search)}` : ""}`;
      const r = await fetch(url);
      if (r.ok) setItems(await r.json());
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  // Close KMD dropdowns when clicking outside
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

  // KMD users는 입력에 따라 서버사이드 검색 (모든 유저 풀이 클 수 있음)
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

  function selectKmdUser(u: KmdUser) {
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
    setForm(EMPTY);
    setEdit(null);
    setKmdSearch("");
    setKmdOpen(false);
    setKmdUserSearch("");
    setKmdUserOpen(false);
    setSelectedKmdUser(null);
    setModal("add");
    fetchKmdClients();
  }

  function openEdit(a: EpharmsAccount) {
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

  function selectKmdClient(c: KmdClient) {
    setForm((prev) => ({ ...prev, bizNumber: c.bizNumber, clientName: c.clientName }));
    setKmdSearch(c.clientName);
    setKmdOpen(false);
  }

  const filteredKmd = kmdClients.filter(
    (c) =>
      c.clientName.includes(kmdSearch) ||
      c.bizNumber.includes(kmdSearch)
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
        alert(e.error || "저장 실패");
        return;
      }
      setModal(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(a: EpharmsAccount) {
    await fetch("/api/epharms-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, active: !a.active }),
    });
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
    } finally {
      setSyncingAll(false);
    }
  }

  async function syncOne(a: EpharmsAccount) {
    setSyncingId(a.id);
    try {
      const r = await fetch(`/api/epharms-accounts/sync?accountId=${a.id}`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) alert(body.error || "워커 호출 실패");
      else alert(`${a.clientName} sync 시작됨. 30초~1분 후 새로고침해보세요.`);
    } finally {
      setSyncingId(null);
    }
  }

  // ── Bulk modal handlers ─────────────────────────────────────────────────────

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

    // Client-side preview using xlsx
    try {
      const { read, utils } = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = read(new Uint8Array(buffer), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      const preview: BulkPreviewRow[] = rows.slice(0, 10).map((r) => ({
        bizNumber: String(r["사업자번호"] ?? "").replace(/[^0-9]/g, ""),
        clientName: String(r["거래처명"] ?? "").trim(),
        loginId: String(r["이팜스ID"] ?? "").trim(),
        loginPw: String(r["이팜스PW"] ?? "").trim(),
        memo: String(r["메모"] ?? "").trim(),
      }));
      setBulkPreview(preview);
    } catch {
      setBulkPreview([]);
    }
  }

  async function handleBulkSubmit() {
    if (!bulkFile) return;
    setBulkSubmitting(true);
    setBulkResult(null);
    try {
      const fd = new FormData();
      fd.append("file", bulkFile);
      const r = await fetch("/api/epharms-accounts/bulk", { method: "POST", body: fd });
      const data: BulkResult = await r.json().catch(() => ({ created: 0, updated: 0, skipped: 0, errors: ["응답 파싱 실패"] }));
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
    <>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ePharms 매출원장 자동수집</h1>
            <p className="text-sm text-gray-500 mt-1">
              거래처별 yk.ep45.co.kr 로그인 계정 등록 → 매일 00:00(KST) 자동 sync.
              KMD 포털 "매출원장" 메뉴에서 영업사원/거래처가 본인 분만 조회.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={syncAll}
              disabled={syncingAll}
              className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
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

        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="거래처명 / 사업자번호 / 로그인ID 검색"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={load}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            새로고침
          </button>
        </div>

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
              {items.map((a) => (
                <tr key={a.id} className={a.active ? "" : "bg-gray-50 opacity-60"}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{a.clientName}</td>
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
                  <td className="px-4 py-3"><StatusBadge status={a.lastSyncStatus} error={a.lastSyncError} /></td>
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
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
              {/* KMD 거래처 자동완성 — add modal only */}
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
              {/* KMD 사용자 매핑 — 약국/거래처가 마이페이지에서 본인 매출원장 보려면 필요 */}
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

      {/* ── Bulk Upload Modal ────────────────────────────────────────────────── */}
      {bulkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { if (!bulkSubmitting) setBulkModal(false); }}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
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
              <p className="text-sm text-gray-500">
                엑셀 파일 컬럼 순서: <span className="font-mono text-xs bg-gray-100 px-1 rounded">사업자번호</span>{" "}
                <span className="font-mono text-xs bg-gray-100 px-1 rounded">거래처명</span>{" "}
                <span className="font-mono text-xs bg-gray-100 px-1 rounded">이팜스ID</span>{" "}
                <span className="font-mono text-xs bg-gray-100 px-1 rounded">이팜스PW</span>{" "}
                <span className="font-mono text-xs bg-gray-100 px-1 rounded">메모</span>(선택)
              </p>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleBulkFileChange}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-green-400 hover:text-green-700 transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  {bulkFile ? bulkFile.name : "xlsx / xls 파일 선택"}
                </button>
              </div>

              {bulkPreview.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">
                    미리보기 (상위 {bulkPreview.length}행)
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full text-xs divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">사업자번호</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">거래처명</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">이팜스ID</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">PW</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-500">메모</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {bulkPreview.map((row, i) => (
                          <tr key={i} className={!row.bizNumber || !row.clientName || !row.loginId || !row.loginPw ? "bg-red-50" : ""}>
                            <td className="px-3 py-1.5 font-mono">{row.bizNumber || <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5">{row.clientName || <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5 font-mono">{row.loginId || <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5 font-mono">{row.loginPw ? "••••••" : <span className="text-red-400">없음</span>}</td>
                            <td className="px-3 py-1.5 text-gray-400">{row.memo || "—"}</td>
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
    </>
  );
}

export default function EpharmsAccountsPage() {
  return (
    <BizLayout>
      <EpharmsAccountsContent />
    </BizLayout>
  );
}
