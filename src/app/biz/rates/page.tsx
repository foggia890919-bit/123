"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Download,
  Loader2,
  X,
  Plus,
  Trash2,
  RefreshCw,
  Pencil,
  FileSpreadsheet,
  Save,
  Check,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CorpClient {
  id: string;
  clientName: string;
  dealerType: string;
}

type ColumnMap = Partial<Record<MappingKey, number>>;

interface RateFileItem {
  id: string;
  corpClientId: string;
  companyName: string;
  applyMonth: string;
  fileName: string;
  fileKey: string;
  columnMap: ColumnMap | null;
  createdAt: string;
  updatedAt: string;
  corpClient: { clientName: string };
  uploadedBy: { name: string | null };
}

interface PagedResponse<T> {
  total: number;
  page: number;
  limit: number;
  items: T[];
}

const MAPPING_KEYS = ["보험코드", "제약사", "상품명", "수수료율", "특이사항"] as const;
type MappingKey = (typeof MAPPING_KEYS)[number];

// 상위법인만 새로운 제출처로 다룬다 (필터는 좀 더 넓게)
const UPPER_DEALER_TYPES = ["UPPER_CORP"] as const;
const FILTER_DEALER_TYPES = ["UPPER_CORP", "CORPORATION", "LOWER_CORP", "SELF"] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function monthLabel(applyMonth: string): string {
  // "2025-05" → "5월"
  const m = applyMonth.match(/^\d{4}-(\d{2})$/);
  if (!m) return applyMonth;
  return `${Number(m[1])}월`;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function formatDisplay(item: RateFileItem): string {
  return `${monthLabel(item.applyMonth)}_${stripExt(item.fileName)}_요율표`;
}

function recentMonths(count = 12): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

// ─── 제출처 추가 모달 ────────────────────────────────────────────────────────

function SubmissionAddModal({
  upperCorps,
  onClose,
  onSuccess,
}: {
  upperCorps: CorpClient[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const months = useMemo(() => recentMonths(18), []);
  const [applyMonth, setApplyMonth] = useState(months[0] ?? "");
  const [corpClientId, setCorpClientId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fileLabel = useMemo(() => {
    if (!file) return "";
    return `${monthLabel(applyMonth || "")}_${stripExt(file.name)}_요율표`;
  }, [file, applyMonth]);

  function onPickFile(f: File | null) {
    setError(null);
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx" && ext !== "xls") {
      setError("xlsx/xls 파일만 업로드 가능해요.");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError("파일 크기는 50MB 이하여야 해요.");
      return;
    }
    setFile(f);
  }

  async function handleComplete() {
    setError(null);
    if (!applyMonth || !corpClientId || !file) {
      setError("작성월, 상위법인, 파일을 모두 입력해주세요.");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("corpClientId", corpClientId);
      fd.append("applyMonth", applyMonth);
      const isReplace = !!createdId;
      const res = await fetch(isReplace ? `/api/biz-rates/${createdId}` : "/api/biz-rates", {
        method: isReplace ? "PATCH" : "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장 실패");
        return;
      }
      if (!isReplace && data?.id) setCreatedId(data.id);
      setEditing(false);
      onSuccess();
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    if (!createdId) return;
    const res = await fetch(`/api/biz-rates/download/${createdId}`);
    if (!res.ok) {
      alert("다운로드 실패");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file?.name ?? "rate.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">제출처 추가</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">요율표 작성월 *</label>
            <select
              value={applyMonth}
              onChange={(e) => setApplyMonth(e.target.value)}
              disabled={!!createdId}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-500"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">상위법인 분류 *</label>
            <select
              value={corpClientId}
              onChange={(e) => setCorpClientId(e.target.value)}
              disabled={!!createdId}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:bg-gray-50 disabled:text-gray-500"
            >
              <option value="">상위법인 선택</option>
              {upperCorps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clientName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">요율표 파일 *</label>
            {editing ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  onPickFile(e.dataTransfer.files?.[0] ?? null);
                }}
                onClick={() => fileRef.current?.click()}
                className={`rounded-xl border-2 border-dashed cursor-pointer transition-colors px-4 py-6 text-center ${
                  dragOver
                    ? "border-blue-400 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300 bg-gray-50/50"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    onPickFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <FileSpreadsheet className="w-7 h-7 text-gray-400 mx-auto mb-2" />
                {file ? (
                  <p className="text-sm text-gray-700 font-medium break-all">{file.name}</p>
                ) : (
                  <>
                    <p className="text-sm text-gray-600">파일을 드래그하거나 클릭해서 선택</p>
                    <p className="text-xs text-gray-400 mt-0.5">xlsx / xls · 50MB 이하</p>
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-500 shrink-0" />
                <p className="text-sm font-medium text-gray-800 break-all flex-1">{fileLabel}</p>
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
              </div>
            )}
          </div>
        </div>

        <div className="px-6 pb-5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!editing && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> 수정
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1 px-3 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> 내려받기
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg transition-colors"
            >
              닫기
            </button>
            {editing && (
              <button
                onClick={handleComplete}
                disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                완료
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 컬럼 매핑 카드 ──────────────────────────────────────────────────────────

function MappingCard({
  files,
  initial,
  onSaved,
  onRemove,
}: {
  files: RateFileItem[];
  initial: { fileId: string; columnMap: ColumnMap };
  onSaved: () => void;
  onRemove?: () => void;
}) {
  const [fileId, setFileId] = useState(initial.fileId);
  const [map, setMap] = useState<ColumnMap>(initial.columnMap);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const selectedFile = files.find((f) => f.id === fileId);

  function setKey(key: MappingKey, value: string) {
    const n = value === "" ? undefined : Math.max(1, Math.floor(Number(value)));
    setMap((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : undefined }));
  }

  async function handleSave() {
    if (!fileId) {
      alert("파일을 선택해주세요.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/biz-rates/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnMap: map }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "저장 실패");
        return;
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={fileId}
          onChange={(e) => {
            setFileId(e.target.value);
            const f = files.find((x) => x.id === e.target.value);
            setMap((f?.columnMap as ColumnMap) ?? {});
          }}
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">요율표 선택</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>
              {f.corpClient.clientName} · {formatDisplay(f)}
            </option>
          ))}
        </select>
        {selectedFile && (
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {selectedFile.applyMonth}
          </span>
        )}
        {onRemove && (
          <button
            onClick={onRemove}
            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="이 매핑 항목 제거"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {MAPPING_KEYS.map((k) => (
          <div key={k} className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">{k}</label>
            <div className="relative">
              <input
                type="number"
                min={1}
                step={1}
                placeholder="열 번호"
                value={map[k] ?? ""}
                onChange={(e) => setKey(k, e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                열
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        {savedFlash && (
          <span className="text-xs text-emerald-600 flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> 저장됨
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !fileId}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          저장
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function RatesPage() {
  const [tab, setTab] = useState<"submissions" | "mapping">("submissions");

  // Filter state (Tab 1)
  const [filterCorpId, setFilterCorpId] = useState("");
  const [filterMonth, setFilterMonth] = useState("");

  // Data
  const [files, setFiles] = useState<RateFileItem[]>([]);
  const [filesTotal, setFilesTotal] = useState(0);
  const [filesLoading, setFilesLoading] = useState(true);

  // Corp clients
  const [allCorps, setAllCorps] = useState<CorpClient[]>([]);
  const upperCorps = useMemo(
    () => allCorps.filter((c) => UPPER_DEALER_TYPES.includes(c.dealerType as typeof UPPER_DEALER_TYPES[number])),
    [allCorps]
  );
  const filterableCorps = useMemo(
    () => allCorps.filter((c) => FILTER_DEALER_TYPES.includes(c.dealerType as typeof FILTER_DEALER_TYPES[number])),
    [allCorps]
  );

  // Modals
  const [addOpen, setAddOpen] = useState(false);

  // Inline 파일 교체 input refs
  const replaceInputRef = useRef<Record<string, HTMLInputElement | null>>({});

  // Tab 2 mapping items: 아직 저장 안된(파일 미지정) 카드 + 저장된 파일 기반 카드
  const [pendingMappingCards, setPendingMappingCards] = useState<number[]>([]);
  const pendingSeq = useRef(0);

  // ── Load corp clients ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dealer");
        const data = await res.json();
        if (Array.isArray(data)) {
          setAllCorps(
            data
              .filter((c: CorpClient) => c.dealerType)
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

  // ── Load rate files ───────────────────────────────────────────
  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const sp = new URLSearchParams();
      if (filterCorpId) sp.set("corpClientId", filterCorpId);
      if (filterMonth) sp.set("applyMonth", filterMonth);
      sp.set("page", "1");
      sp.set("limit", "200");
      const res = await fetch(`/api/biz-rates?${sp}`);
      const data: PagedResponse<RateFileItem> = await res.json();
      setFiles(Array.isArray(data?.items) ? data.items : []);
      setFilesTotal(data?.total ?? 0);
    } finally {
      setFilesLoading(false);
    }
  }, [filterCorpId, filterMonth]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // ── Row actions ───────────────────────────────────────────────
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

  async function handleReplace(item: RateFileItem, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/biz-rates/${item.id}`, { method: "PATCH", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "교체 실패");
      return;
    }
    loadFiles();
  }

  async function handleDelete(item: RateFileItem) {
    if (!confirm(`"${formatDisplay(item)}" 제출처를 삭제할까요?`)) return;
    const res = await fetch(`/api/biz-rates/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "삭제 실패");
      return;
    }
    loadFiles();
  }

  // ── Tab 2 actions ─────────────────────────────────────────────
  function addPendingMappingCard() {
    pendingSeq.current += 1;
    setPendingMappingCards((prev) => [...prev, pendingSeq.current]);
  }
  function removePendingMappingCard(id: number) {
    setPendingMappingCards((prev) => prev.filter((x) => x !== id));
  }

  const mappedFiles = files.filter((f) => f.columnMap && Object.keys(f.columnMap).length > 0);
  const unmappedFiles = files.filter((f) => !f.columnMap || Object.keys(f.columnMap).length === 0);

  // ── Render ────────────────────────────────────────────────────
  return (
    <BizLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900">법인 요율표 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              상위법인별 요율표 파일 업로드 · 컬럼 매핑 관리
            </p>
          </div>
          {tab === "submissions" && (
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              제출처 추가
            </button>
          )}
          {tab === "mapping" && (
            <button
              onClick={addPendingMappingCard}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              매핑 추가
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-gray-200">
          {[
            { key: "submissions", label: "제출처 관리" },
            { key: "mapping", label: "컬럼 매핑" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key as typeof tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Tab 1: 제출처 관리 ────────────────────────────── */}
        {tab === "submissions" && (
          <>
            {/* Filter bar */}
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={filterCorpId}
                onChange={(e) => setFilterCorpId(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[180px]"
              >
                <option value="">전체 상위법인</option>
                {filterableCorps.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.clientName}
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
                onClick={loadFiles}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                새로고침
              </button>
            </div>

            {/* List */}
            <div className="bg-white border border-gray-200 rounded-xl">
              {filesLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : files.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">
                  등록된 제출처가 없어요. <span className="text-gray-300">우측 상단의 “제출처 추가” 버튼을 눌러보세요.</span>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {files.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-5 py-4 hover:bg-gray-50/60 transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {formatDisplay(item)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {item.corpClient.clientName} · {item.applyMonth}
                          {item.uploadedBy?.name ? ` · ${item.uploadedBy.name}` : ""}
                        </p>
                      </div>

                      {/* 수정 (파일 교체) */}
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
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" /> 수정
                      </button>

                      <button
                        onClick={() => handleDownload(item)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" /> 내려받기
                      </button>

                      <button
                        onClick={() => handleDelete(item)}
                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!filesLoading && (
              <p className="text-xs text-gray-400">총 {filesTotal}개</p>
            )}
          </>
        )}

        {/* ── Tab 2: 컬럼 매핑 ──────────────────────────────── */}
        {tab === "mapping" && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              업로드한 요율표 파일에서 어느 열이 어떤 항목인지 지정합니다. 열 번호는 1부터 시작해요.
            </p>

            {/* 저장된 매핑 카드 (파일 기반) */}
            {mappedFiles.map((f) => (
              <MappingCard
                key={f.id}
                files={files}
                initial={{ fileId: f.id, columnMap: (f.columnMap as ColumnMap) ?? {} }}
                onSaved={loadFiles}
              />
            ))}

            {/* 새로 추가한 매핑 카드 (아직 파일 미지정 가능) */}
            {pendingMappingCards.map((id) => (
              <MappingCard
                key={`pending-${id}`}
                files={unmappedFiles}
                initial={{ fileId: "", columnMap: {} }}
                onSaved={() => {
                  removePendingMappingCard(id);
                  loadFiles();
                }}
                onRemove={() => removePendingMappingCard(id)}
              />
            ))}

            {mappedFiles.length === 0 && pendingMappingCards.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-xl text-center py-16 text-gray-400 text-sm">
                매핑된 항목이 없어요. <span className="text-gray-300">우측 상단의 “매핑 추가” 버튼으로 시작하세요.</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {addOpen && (
        <SubmissionAddModal
          upperCorps={upperCorps}
          onClose={() => setAddOpen(false)}
          onSuccess={loadFiles}
        />
      )}
    </BizLayout>
  );
}
