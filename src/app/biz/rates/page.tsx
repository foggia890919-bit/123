"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Upload,
  Download,
  History,
  Loader2,
  X,
  Plus,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CorpClient {
  id: string;
  clientName: string;
  dealerType: string;
}

interface RateFileItem {
  id: string;
  corpClientId: string;
  companyName: string;
  applyMonth: string;
  fileName: string;
  fileKey: string;
  createdAt: string;
  updatedAt: string;
  corpClient: { clientName: string };
  uploadedBy: { name: string | null };
}

interface HistoryItem {
  id: string;
  rateFileId: string;
  corpClientId: string;
  companyName: string;
  applyMonth: string;
  action: string;
  prevFileName: string | null;
  newFileName: string | null;
  createdAt: string;
  performedBy: { name: string | null };
}

interface PagedResponse<T> {
  total: number;
  page: number;
  limit: number;
  items: T[];
}

// ─── Helper components ────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-sm text-gray-700 ${className ?? ""}`}>{children}</td>;
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    UPLOAD: "bg-blue-50 text-blue-700",
    REPLACE: "bg-amber-50 text-amber-700",
    DELETE: "bg-red-50 text-red-700",
  };
  const label: Record<string, string> = {
    UPLOAD: "업로드",
    REPLACE: "교체",
    DELETE: "삭제",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[action] ?? "bg-gray-100 text-gray-600"}`}>
      {label[action] ?? action}
    </span>
  );
}

function Pagination({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="p-1.5 text-gray-500 hover:text-gray-800 disabled:opacity-40"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm text-gray-600">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="p-1.5 text-gray-500 hover:text-gray-800 disabled:opacity-40"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

function UploadModal({
  corpClients,
  companies,
  onClose,
  onSuccess,
}: {
  corpClients: CorpClient[];
  companies: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [corpClientId, setCorpClientId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [applyMonth, setApplyMonth] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    setError(null);
    if (!corpClientId || !companyName || !applyMonth || !file) {
      setError("법인, 제약사, 적용월, 파일을 모두 입력해주세요.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(applyMonth)) {
      setError("적용월은 YYYY-MM 형식이어야 합니다.");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("corpClientId", corpClientId);
      fd.append("companyName", companyName);
      fd.append("applyMonth", applyMonth);
      const res = await fetch("/api/biz-rates", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "업로드 실패");
        return;
      }
      onSuccess();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">요율표 업로드</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">법인 *</label>
            <select
              value={corpClientId}
              onChange={(e) => setCorpClientId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">법인 선택</option>
              {corpClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clientName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">제약사 *</label>
            <select
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">제약사 선택</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">적용월 * (YYYY-MM)</label>
            <input
              type="month"
              value={applyMonth}
              onChange={(e) => setApplyMonth(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">파일 * (xlsx/xls, 50MB 이하)</label>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600"
              >
                <Upload className="w-4 h-4" />
                파일 선택
              </button>
              {file && (
                <span className="text-xs text-gray-600 truncate max-w-[180px]">{file.name}</span>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 pb-5 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── History Modal ────────────────────────────────────────────────────────────

function HistoryModal({
  rateFileId,
  title,
  onClose,
}: {
  rateFileId: string;
  title: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/biz-rates/history?rateFileId=${rateFileId}&limit=50`);
        const data = await res.json();
        setItems(Array.isArray(data?.items) ? data.items : []);
      } finally {
        setLoading(false);
      }
    })();
  }, [rateFileId]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">변경 이력 — {title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">이력이 없어요.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <Th>시점</Th>
                  <Th>액션</Th>
                  <Th>이전 파일</Th>
                  <Th>새 파일</Th>
                  <Th>수행자</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((h) => (
                  <tr key={h.id} className="hover:bg-gray-50">
                    <Td className="whitespace-nowrap text-xs text-gray-500">
                      {new Date(h.createdAt).toLocaleString("ko-KR")}
                    </Td>
                    <Td>
                      <ActionBadge action={h.action} />
                    </Td>
                    <Td className="text-xs max-w-[150px] truncate">{h.prevFileName ?? "—"}</Td>
                    <Td className="text-xs max-w-[150px] truncate">{h.newFileName ?? "—"}</Td>
                    <Td className="text-xs text-gray-500">{h.performedBy?.name ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RatesPage() {
  // Filter state
  const [filterCorpId, setFilterCorpId] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterMonth, setFilterMonth] = useState("");

  // File list
  const [files, setFiles] = useState<RateFileItem[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [filesPage, setFilesPage] = useState(1);
  const [filesLoading, setFilesLoading] = useState(true);
  const FILES_LIMIT = 20;

  // History (bottom card)
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [histTotal, setHistTotal] = useState(0);
  const [histPage, setHistPage] = useState(1);
  const [histLoading, setHistLoading] = useState(true);
  const HIST_LIMIT = 20;

  // Corp clients & companies
  const [corpClients, setCorpClients] = useState<CorpClient[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);

  // Modals
  const [uploadOpen, setUploadOpen] = useState(false);
  const [historyModal, setHistoryModal] = useState<{ id: string; title: string } | null>(null);

  // Deleting
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Replace file refs per row
  const replaceInputRef = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Load corp clients ─────────────────────────────────────────
  // /api/dealer returns dealer-typed UserClients for the current BIZ user.
  // isRateTarget=true would be ideal but we load all typed dealers and filter client-side
  // so the upload modal shows the full corp list regardless of isRateTarget flag.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dealer");
        const data = await res.json();
        if (Array.isArray(data)) {
          const corpTypes = ["CORPORATION", "UPPER_CORP", "LOWER_CORP", "SELF"];
          setCorpClients(
            data
              .filter((c: CorpClient) => corpTypes.includes(c.dealerType))
              .sort((a: CorpClient, b: CorpClient) =>
                a.clientName.localeCompare(b.clientName, "ko")
              )
          );
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // ── Load company names from Medication ──────────────────────
  // /api/medications/companies is a public endpoint that returns settlement companies.
  // The response shape is [{name, ...}] so we map .name to get the company string.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/medications/companies?type=settlement");
        const data = await res.json();
        if (Array.isArray(data)) {
          setCompanies(
            data
              .map((d: { name: string }) => d.name)
              .filter(Boolean)
              .sort((a: string, b: string) => a.localeCompare(b, "ko"))
          );
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // ── Load rate files ───────────────────────────────────────────
  const loadFiles = useCallback(
    async (page = 1) => {
      setFilesLoading(true);
      try {
        const sp = new URLSearchParams();
        if (filterCorpId) sp.set("corpClientId", filterCorpId);
        if (filterCompany) sp.set("companyName", filterCompany);
        if (filterMonth) sp.set("applyMonth", filterMonth);
        sp.set("page", String(page));
        sp.set("limit", String(FILES_LIMIT));
        const res = await fetch(`/api/biz-rates?${sp}`);
        const data: PagedResponse<RateFileItem> = await res.json();
        setFiles(Array.isArray(data?.items) ? data.items : []);
        setFilesTotal(data?.total ?? 0);
        setFilesPage(page);
      } finally {
        setFilesLoading(false);
      }
    },
    [filterCorpId, filterCompany, filterMonth]
  );

  // ── Load history ──────────────────────────────────────────────
  const loadHistory = useCallback(
    async (page = 1) => {
      setHistLoading(true);
      try {
        const sp = new URLSearchParams();
        if (filterCorpId) sp.set("corpClientId", filterCorpId);
        if (filterCompany) sp.set("companyName", filterCompany);
        if (filterMonth) sp.set("applyMonth", filterMonth);
        sp.set("page", String(page));
        sp.set("limit", String(HIST_LIMIT));
        const res = await fetch(`/api/biz-rates/history?${sp}`);
        const data: PagedResponse<HistoryItem> = await res.json();
        setHistory(Array.isArray(data?.items) ? data.items : []);
        setHistTotal(data?.total ?? 0);
        setHistPage(page);
      } finally {
        setHistLoading(false);
      }
    },
    [filterCorpId, filterCompany, filterMonth]
  );

  useEffect(() => {
    loadFiles(1);
  }, [loadFiles]);

  useEffect(() => {
    loadHistory(1);
  }, [loadHistory]);

  // ── Download file ─────────────────────────────────────────────
  async function handleDownload(item: RateFileItem) {
    const res = await fetch(`/api/biz-rates/download/${item.id}`);
    if (!res.ok) {
      alert("다운로드 실패");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Replace file ──────────────────────────────────────────────
  async function handleReplace(item: RateFileItem, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/biz-rates/${item.id}`, { method: "PATCH", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "교체 실패");
      return;
    }
    loadFiles(filesPage);
    loadHistory(1);
  }

  // ── Delete file ───────────────────────────────────────────────
  async function handleDelete(item: RateFileItem) {
    if (
      !confirm(
        `"${item.corpClient.clientName} / ${item.companyName} / ${item.applyMonth}" 요율표를 삭제할까요?`
      )
    )
      return;
    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/biz-rates/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "삭제 실패");
        return;
      }
      loadFiles(filesPage);
      loadHistory(1);
    } finally {
      setDeletingId(null);
    }
  }

  // ── Export history excel ──────────────────────────────────────
  async function handleExportHistory() {
    const sp = new URLSearchParams();
    if (filterCorpId) sp.set("corpClientId", filterCorpId);
    if (filterMonth) sp.set("applyMonthFrom", filterMonth);
    const res = await fetch(`/api/biz-rates/history/export?${sp}`);
    if (!res.ok) {
      alert("내보내기 실패");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "요율표_변경이력.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <BizLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900">법인 요율표 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              법인별 제약사별 요율표 파일 업로드·교체·이력 관리
            </p>
          </div>
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            요율표 업로드
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filterCorpId}
            onChange={(e) => setFilterCorpId(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[160px]"
          >
            <option value="">전체 법인</option>
            {corpClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.clientName}
              </option>
            ))}
          </select>

          <select
            value={filterCompany}
            onChange={(e) => setFilterCompany(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[140px]"
          >
            <option value="">전체 제약사</option>
            {companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <input
            type="month"
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <button
            onClick={() => {
              loadFiles(1);
              loadHistory(1);
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            새로고침
          </button>
        </div>

        {/* Files table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {filesLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              등록된 요율표가 없어요.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <Th>법인명</Th>
                    <Th>제약사</Th>
                    <Th>적용월</Th>
                    <Th>파일명</Th>
                    <Th>업로드자</Th>
                    <Th>업로드일</Th>
                    <Th>관리</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {files.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <Td className="font-medium text-gray-900">
                        {item.corpClient.clientName}
                      </Td>
                      <Td>{item.companyName}</Td>
                      <Td className="font-mono text-xs">{item.applyMonth}</Td>
                      <Td className="max-w-[200px] truncate text-xs text-gray-600">
                        {item.fileName}
                      </Td>
                      <Td className="text-xs text-gray-500">
                        {item.uploadedBy?.name ?? "—"}
                      </Td>
                      <Td className="text-xs text-gray-500 whitespace-nowrap">
                        {new Date(item.updatedAt).toLocaleDateString("ko-KR")}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          {/* History */}
                          <button
                            onClick={() =>
                              setHistoryModal({
                                id: item.id,
                                title: `${item.corpClient.clientName} / ${item.companyName} / ${item.applyMonth}`,
                              })
                            }
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="변경 이력"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>

                          {/* Download */}
                          <button
                            onClick={() => handleDownload(item)}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="다운로드"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>

                          {/* Replace */}
                          <input
                            ref={(el) => {
                              replaceInputRef.current[item.id] = el;
                            }}
                            type="file"
                            accept=".xlsx,.xls"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) handleReplace(item, f);
                            }}
                          />
                          <button
                            onClick={() => replaceInputRef.current[item.id]?.click()}
                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="파일 교체"
                          >
                            <Upload className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(item)}
                            disabled={deletingId === item.id}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                            title="삭제"
                          >
                            {deletingId === item.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!filesLoading && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">총 {filesTotal}개</p>
            <Pagination
              page={filesPage}
              total={filesTotal}
              limit={FILES_LIMIT}
              onChange={(p) => loadFiles(p)}
            />
          </div>
        )}

        {/* History card */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800 text-sm">변경 이력</h2>
            <button
              onClick={handleExportHistory}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              엑셀 내보내기
            </button>
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">이력이 없어요.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <Th>법인ID</Th>
                    <Th>제약사</Th>
                    <Th>적용월</Th>
                    <Th>액션</Th>
                    <Th>이전 파일</Th>
                    <Th>새 파일</Th>
                    <Th>수행자</Th>
                    <Th>일시</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {history.map((h) => (
                    <tr key={h.id} className="hover:bg-gray-50">
                      <Td className="text-xs font-mono text-gray-500 max-w-[100px] truncate">
                        {h.corpClientId}
                      </Td>
                      <Td>{h.companyName}</Td>
                      <Td className="font-mono text-xs">{h.applyMonth}</Td>
                      <Td>
                        <ActionBadge action={h.action} />
                      </Td>
                      <Td className="text-xs max-w-[140px] truncate">{h.prevFileName ?? "—"}</Td>
                      <Td className="text-xs max-w-[140px] truncate">{h.newFileName ?? "—"}</Td>
                      <Td className="text-xs text-gray-500">{h.performedBy?.name ?? "—"}</Td>
                      <Td className="text-xs text-gray-500 whitespace-nowrap">
                        {new Date(h.createdAt).toLocaleString("ko-KR")}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!histLoading && (
            <div className="px-5 py-3 flex items-center justify-between border-t border-gray-100">
              <p className="text-xs text-gray-400">총 {histTotal}건</p>
              <Pagination
                page={histPage}
                total={histTotal}
                limit={HIST_LIMIT}
                onChange={(p) => loadHistory(p)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <UploadModal
          corpClients={corpClients}
          companies={companies}
          onClose={() => setUploadOpen(false)}
          onSuccess={() => {
            loadFiles(1);
            loadHistory(1);
          }}
        />
      )}

      {/* History detail modal */}
      {historyModal && (
        <HistoryModal
          rateFileId={historyModal.id}
          title={historyModal.title}
          onClose={() => setHistoryModal(null)}
        />
      )}
    </BizLayout>
  );
}
