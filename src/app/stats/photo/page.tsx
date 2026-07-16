"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  CheckCircle, AlertCircle, Trash2, Sparkles, Building2,
  Loader2, RefreshCw, Plus, History, ChevronDown, ChevronRight, Shuffle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeCompanyName, companyNameKey } from "@/lib/company-name";

// AI 처방통계 등록 — 거래처×제약사 "행 목록" 방식.
// 거래처/년/월을 고르면 그 거래처에 매핑된 제약사가 행으로 뜨고, 각 행에 (+)/드래그로
// 사진을 붙인 뒤 마지막에 [업로드하기] 한 번. 저장은 제출처>제약사_거래처명 계층으로 정리.
// 제약사 없이 섞인 사진은 맨 아래 「자동 분류」 행으로 올리면 기존 OCR 자동 방식으로 처리.
// 검수는 별도 메뉴 "AI 처방통계 검수" 에서 사진과 함께 좌우 분할로 진행.

const AUTO_ROW_KEY = "__auto__";

interface UserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  approved: boolean;
}

interface BatchItem {
  id: string;
  file: File;
  rowKey: string;           // 어느 행에 붙었는지 (AUTO_ROW_KEY = 자동 분류)
  companyName: string;      // 사용자 지정 제약사 ("" = 자동 분류)
  submissionEntity: string; // 제출처 표시명 ("" = 자동 분류)
  status: "pending" | "sending" | "queued" | "error";
  errorMsg?: string;
}

interface RowDef {
  key: string;
  companyName: string;      // 표시명 (normalize)
  submissionEntity: string;
  prevSubmitted: boolean;   // 전월 제출 (전월 조합 불러오기)
  noMapping: boolean;       // 전월엔 있는데 현재 매핑 없음
}

// stats/page.tsx 의 동일 함수 — 1600px / JPEG 0.78 로 클라이언트 압축.
// Vercel 4.5MB body limit 우회 + Gemini 비용 절감.
async function compressImage(file: File, maxDim = 1600, quality = 0.78): Promise<Blob> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
  const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("canvas blob 실패"))), "image/jpeg", quality),
  );
}

// 첨부 썸네일 — object URL 을 스스로 생성/해제.
function Thumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="w-10 h-10 object-cover rounded border border-gray-200" />;
}

// 개별 행 카드 — 모듈 스코프에 두어 부모 리렌더 시 remount(썸네일 object URL 재생성) 방지.
function RowCard({
  row, isAuto, clientName, items, isSubmitted, batchRunning, onAdd, onRemoveItem, onClearRow,
}: {
  row: RowDef;
  isAuto: boolean;
  clientName: string;
  items: BatchItem[];
  isSubmitted: boolean;
  batchRunning: boolean;
  onAdd: (files: FileList | File[] | null) => void;
  onRemoveItem: (id: string) => void;
  onClearRow: () => void;
}) {
  const done = items.filter((i) => i.status === "queued").length;
  const err = items.filter((i) => i.status === "error").length;
  const sending = items.filter((i) => i.status === "sending").length;
  const pend = items.filter((i) => i.status === "pending").length;
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`border rounded-lg p-3 ${isAuto ? "border-dashed border-gray-300 bg-gray-50" : "border-gray-200 bg-white"}`}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); if (!isSubmitted) onAdd(e.dataTransfer.files); }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isAuto ? (
              <span className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1">
                <Shuffle className="w-3.5 h-3.5 text-gray-500" /> 자동 분류 (제약사 혼합 사진)
              </span>
            ) : (
              <span className="text-sm font-medium text-gray-900 truncate">
                {clientName} · {row.companyName}
              </span>
            )}
            {row.prevSubmitted && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">전월 제출</span>
            )}
            {row.noMapping && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">매핑 없음</span>
            )}
          </div>
          {isAuto ? (
            <div className="text-[11px] text-gray-500 mt-0.5">제약사 미지정 — 기존 방식대로 사진에서 OCR 자동 분류.</div>
          ) : (
            <div className="text-[11px] text-gray-500 mt-0.5">제출처: {row.submissionEntity}</div>
          )}
        </div>

        {items.length > 0 && (
          <div className="text-[10px] text-gray-500 flex items-center gap-1.5">
            {done > 0 && <span className="text-green-700">완료 {done}</span>}
            {sending > 0 && <span className="text-blue-700 inline-flex items-center gap-0.5"><Loader2 className="w-3 h-3 animate-spin" />{sending}</span>}
            {pend > 0 && <span>대기 {pend}</span>}
            {err > 0 && <span className="text-red-600">실패 {err}</span>}
          </div>
        )}

        <button
          type="button"
          disabled={isSubmitted}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> 사진
        </button>
        <input
          ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }}
        />
        {items.length > 0 && !batchRunning && (
          <button type="button" onClick={onClearRow} className="text-gray-400 hover:text-red-500" title="이 행 사진 비우기">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-2 text-[11px] text-gray-400 border border-dashed border-gray-200 rounded py-2 text-center">
          여기로 사진을 드래그하거나 (+ 사진) 을 누르세요
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((it) => (
            <div key={it.id} className="relative group">
              <Thumb file={it.file} />
              <span className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border border-white ${
                it.status === "queued" ? "bg-green-500" :
                it.status === "sending" ? "bg-blue-500" :
                it.status === "error" ? "bg-red-500" : "bg-gray-300"
              }`} title={it.errorMsg || it.status} />
              {!batchRunning && it.status !== "sending" && (
                <button
                  type="button"
                  onClick={() => onRemoveItem(it.id)}
                  className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 rounded transition-opacity"
                  title="제거"
                >
                  <Trash2 className="w-4 h-4 text-white" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StatsPhotoPage() {
  const { data: session } = useSession();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [clients, setClients] = useState<UserClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  // 본인 대표 사업자 (마이페이지 "사업자 정보" 카드와 같은 row) — 거래처 드롭다운에서 제외용
  const [myBizClientId, setMyBizClientId] = useState<string | null>(null);

  const [error, setError] = useState<string>("");

  // 거래처별 거래가능 제약사 (제약사명 + 제출처) — 행 목록의 기반.
  const [routeRows, setRouteRows] = useState<{ companyName: string; submissionEntity: string }[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<{
    submitted: boolean;
    photoCount: number;
    rowCount: number;
  } | null>(null);

  // 제약사별 매출 요약 (당월/전월/전전월) — 거래처 선택 시 자동 fetch + 백그라운드 처리 중 polling.
  interface SalesSummaryRow {
    companyName: string;
    isAllowed: boolean;
    currentSales: number;
    currentQuantity: number;
    prevSales: number;
    prevQuantity: number;
    prevPrevSales: number;
    prevPrevQuantity: number;
    currentPhotoCount: number;
    prevPhotoCount: number;
    prevPrevPhotoCount: number;
  }
  interface SalesSummary {
    year: number;
    month: number;
    prevYear: number;
    prevMonth: number;
    prevPrevYear: number;
    prevPrevMonth: number;
    byCompany: SalesSummaryRow[];
    currentProcessingCount: number;
    currentErrorCount: number;
  }
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [showSalesTable, setShowSalesTable] = useState(false);
  const [prevLoaded, setPrevLoaded] = useState(false);

  function refreshSalesSummary() {
    if (!selectedClientId || !year || !month) { setSalesSummary(null); return; }
    setSummaryLoading(true);
    fetch(`/api/stats/sales-summary?clientId=${selectedClientId}&year=${year}&month=${month}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setSalesSummary(data))
      .catch(() => setSalesSummary(null))
      .finally(() => setSummaryLoading(false));
  }

  // 배치 등록 state
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/user-clients?userId=${session.user.id}`)
      .then((r) => r.json())
      .then((data) => Array.isArray(data) ? setClients(data) : setClients([]))
      .catch(() => setClients([]));
    fetch("/api/mypage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.bizClient?.id) setMyBizClientId(d.bizClient.id); })
      .catch(() => undefined);
  }, [session?.user?.id]);

  // 거래처 선택 시 매핑 제약사(+제출처) 목록 fetch
  useEffect(() => {
    setPrevLoaded(false);
    if (!selectedClientId) { setRouteRows([]); return; }
    const client = clients.find((c) => c.id === selectedClientId);
    if (!client) return;
    setRoutesLoading(true);
    fetch(`/api/submission-routes?clientName=${encodeURIComponent(client.clientName)}&active=true`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: { companyName: string; submissionEntity?: string }[]) => {
        const seen = new Set<string>();
        const rows: { companyName: string; submissionEntity: string }[] = [];
        for (const d of data ?? []) {
          const name = (d.companyName || "").trim();
          if (!name) continue;
          const k = companyNameKey(name) || name;
          if (seen.has(k)) continue;
          seen.add(k);
          rows.push({ companyName: name, submissionEntity: (d.submissionEntity || "").trim() });
        }
        setRouteRows(rows);
      })
      .catch(() => setRouteRows([]))
      .finally(() => setRoutesLoading(false));
  }, [selectedClientId, clients]);

  // 거래처+월 선택 시 제출완료 여부 자동 조회. 제출완료면 업로드 disable.
  useEffect(() => {
    if (!selectedClientId || !year || !month) { setSubmissionStatus(null); return; }
    fetch(`/api/stats/submissions?clientId=${selectedClientId}&year=${year}&month=${month}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { submitted: boolean; metrics: { photoCount: number; rowCount: number } } | null) => {
        if (!data) { setSubmissionStatus(null); return; }
        setSubmissionStatus({
          submitted: data.submitted && data.metrics.photoCount > 0,
          photoCount: data.metrics.photoCount,
          rowCount: data.metrics.rowCount,
        });
      })
      .catch(() => setSubmissionStatus(null));
  }, [selectedClientId, year, month]);

  // 거래처+월 선택 시 매출 요약 (당월/전월/전전월) 자동 fetch
  useEffect(() => {
    refreshSalesSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, year, month]);

  // 사진 전송 완료 후 백그라운드 처리 중 자동 갱신 polling. 3분 timeout.
  const [pollStartAt, setPollStartAt] = useState<number | null>(null);
  useEffect(() => {
    if (!selectedClientId) return;
    const hasQueued = batchItems.some((it) => it.status === "queued");
    if (!hasQueued) { setPollStartAt(null); return; }
    if (pollStartAt === null) setPollStartAt(Date.now());
    const id = setInterval(() => {
      const nowMs = Date.now();
      if (pollStartAt !== null && nowMs - pollStartAt > 3 * 60 * 1000) {
        clearInterval(id);
        setPollStartAt(null);
        return;
      }
      refreshSalesSummary();
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, batchItems, pollStartAt]);

  // 배치 진행 중 페이지 떠나면 경고
  useEffect(() => {
    if (!batchRunning) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [batchRunning]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  // ── 행 목록 구성 ─────────────────────────────────────────────────────────
  // 기본: 매핑 제약사 행 (가나다순). "전월 조합 불러오기" 누르면 전월 제출 제약사 강조·상단
  // 정렬 + 매핑에 없는 전월 제약사는 "매핑 없음" 행으로 추가.
  const rows: RowDef[] = useMemo(() => {
    const base: RowDef[] = routeRows.map((r) => ({
      key: companyNameKey(r.companyName) || r.companyName,
      companyName: normalizeCompanyName(r.companyName) || r.companyName,
      submissionEntity: r.submissionEntity || "미지정",
      prevSubmitted: false,
      noMapping: false,
    }));
    const byKey = new Map(base.map((b) => [b.key, b]));

    if (prevLoaded && salesSummary) {
      for (const c of salesSummary.byCompany) {
        if ((c.prevPhotoCount ?? 0) <= 0) continue;
        const k = companyNameKey(c.companyName) || c.companyName;
        const existing = byKey.get(k);
        if (existing) {
          existing.prevSubmitted = true;
        } else {
          const row: RowDef = {
            key: k,
            companyName: normalizeCompanyName(c.companyName) || c.companyName,
            submissionEntity: "미지정",
            prevSubmitted: true,
            noMapping: true,
          };
          base.push(row);
          byKey.set(k, row);
        }
      }
    }

    base.sort((a, b) => {
      if (prevLoaded && a.prevSubmitted !== b.prevSubmitted) return a.prevSubmitted ? -1 : 1;
      return a.companyName.localeCompare(b.companyName, "ko");
    });
    return base;
  }, [routeRows, salesSummary, prevLoaded]);

  const prevCombinationCount = useMemo(
    () => (salesSummary?.byCompany ?? []).filter((c) => (c.prevPhotoCount ?? 0) > 0).length,
    [salesSummary],
  );

  // ── 파일 추가 ────────────────────────────────────────────────────────────
  function addFilesToRow(row: { key: string; companyName?: string; submissionEntity?: string }, files: FileList | File[] | null) {
    if (!files) return;
    const incoming = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) return;
    setBatchItems((prev) => {
      // 같은 행 안에서 (이름+크기+수정시각) 중복만 거름.
      const seen = new Set(
        prev.filter((it) => it.rowKey === row.key)
          .map((it) => `${it.file.name}|${it.file.size}|${it.file.lastModified}`),
      );
      const newItems: BatchItem[] = [];
      for (const f of incoming) {
        const dk = `${f.name}|${f.size}|${f.lastModified}`;
        if (seen.has(dk)) continue;
        seen.add(dk);
        newItems.push({
          id: crypto.randomUUID(),
          file: f,
          rowKey: row.key,
          companyName: row.key === AUTO_ROW_KEY ? "" : (row.companyName ?? ""),
          submissionEntity: row.key === AUTO_ROW_KEY ? "" : (row.submissionEntity ?? ""),
          status: "pending",
        });
      }
      return [...prev, ...newItems];
    });
  }

  function removeBatchItem(id: string) {
    setBatchItems((prev) => prev.filter((it) => it.id !== id));
  }
  function clearRow(rowKey: string) {
    setBatchItems((prev) => prev.filter((it) => it.rowKey !== rowKey));
  }
  function clearBatch() {
    setBatchItems([]);
  }

  // 한 사진 전송 — 압축 후 /api/stats/photo-auto POST.
  async function sendBatchItem(item: BatchItem): Promise<void> {
    const update = (patch: Partial<BatchItem>) =>
      setBatchItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, ...patch } : it)));
    update({ status: "sending" });
    try {
      const compressed = await compressImage(item.file);
      const fd = new FormData();
      fd.append("image", compressed, item.file.name);
      fd.append("clientId", selectedClientId);
      fd.append("year", String(year));
      fd.append("month", String(month));
      // 행 단위 — 제약사/제출처가 있으면 페이로드에 포함 (자동 분류 행은 미포함).
      if (item.companyName) fd.append("companyName", item.companyName);
      if (item.submissionEntity) fd.append("submissionEntity", item.submissionEntity);
      const res = await fetch("/api/stats/photo-auto", { method: "POST", body: fd });
      const text = await res.text();
      let data: { ok?: boolean; error?: string; duplicate?: boolean; sheetWarning?: string | null };
      try {
        data = text ? JSON.parse(text) : { error: `빈 응답 (HTTP ${res.status})` };
      } catch {
        data = { error: text.slice(0, 200) || `HTTP ${res.status} 응답 파싱 실패` };
      }
      if (res.status === 409 || data.duplicate) {
        update({ status: "error", errorMsg: data.error || "이미 등록된 사진 (중복)" });
        return;
      }
      if (!res.ok || data.error || !data.ok) {
        update({ status: "error", errorMsg: data.error || `HTTP ${res.status}` });
        return;
      }
      if (data.sheetWarning) {
        update({ status: "queued", errorMsg: `DB 저장됨 · 시트 실패: ${data.sheetWarning}` });
      } else {
        update({ status: "queued" });
      }
    } catch (e) {
      update({ status: "error", errorMsg: `전송 실패: ${String(e).slice(0, 200)}` });
    }
  }

  async function runBatch() {
    if (!selectedClientId) { setError("거래처를 먼저 선택하세요"); return; }
    const pending = batchItems.filter((it) => it.status === "pending" || it.status === "error");
    if (pending.length === 0) return;
    setBatchRunning(true);
    setError("");
    try {
      const CONCURRENCY = 3;
      for (let i = 0; i < pending.length; i += CONCURRENCY) {
        const chunk = pending.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map((it) => sendBatchItem(it)));
      }
    } finally {
      setBatchRunning(false);
    }
  }

  const totalPending = batchItems.filter((it) => it.status === "pending" || it.status === "error").length;
  const totalQueued = batchItems.filter((it) => it.status === "queued").length;
  const isSubmitted = !!submissionStatus?.submitted;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-orange-500" />
        <h1 className="text-2xl font-bold text-gray-900">AI 처방통계 등록</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-2">
        거래처/년/월을 고르면 매핑된 제약사가 행으로 뜹니다. 행마다 (+ 사진) 또는 드래그로 사진을 붙이고
        마지막에 [업로드하기] 한 번. 사진은 서버에 즉시 저장되고 백그라운드에서 Gemini 분석 + 매칭 + 시트.
        결과는{" "}
        <a href="/biz/stats-review" className="text-orange-600 underline">AI 처방통계 검수</a> 에서 확인.
      </p>

      {/* 거래처/월 선택 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500">처방년도</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}
              className="mt-1 w-full border rounded px-3 py-2 text-sm">
              {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">처방월</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
              className="mt-1 w-full border rounded px-3 py-2 text-sm">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">병원 (거래처)</label>
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2 text-sm bg-white"
            >
              <option value="">— 거래처 선택 —</option>
              {clients.filter((c) => c.id !== myBizClientId).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clientName}{!c.approved ? " (승인전)" : ""}
                </option>
              ))}
            </select>
            {clients.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                등록된 거래처가 없습니다.{" "}
                <a href="/mypage/clients" className="underline">거래처 관리</a>
              </p>
            )}
          </div>
        </div>

        {/* 제출완료 거래처×월 — 업로드 차단 배너 */}
        {isSubmitted && (
          <div className="bg-red-50 border border-red-200 rounded px-3 py-2.5 flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-red-800 flex-1">
              <div className="font-semibold">
                ✅ 제출완료 — {selectedClient?.clientName} · {year}년 {month}월
              </div>
              <div className="text-red-700 mt-0.5">
                사진 {submissionStatus?.photoCount}장 / 약품 {submissionStatus?.rowCount}건이 이미 제출완료된
                거래처×월입니다. 추가 업로드 불가. 잘못 올린 거면{" "}
                <a href="/biz/stats-review" className="underline font-semibold">검수 페이지</a>에서
                삭제 후 다시 업로드하세요.
              </div>
            </div>
          </div>
        )}

        {/* 행 목록 */}
        {selectedClientId && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-semibold text-gray-700">제약사별 사진 붙이기</span>
              {routesLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
              {(totalQueued > 0 && pollStartAt !== null) && (
                <span className="ml-2 text-[11px] text-blue-600 inline-flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> 처리 중 — 자동 갱신
                </span>
              )}
              {batchItems.length > 0 && !batchRunning && (
                <button onClick={clearBatch} className="ml-auto text-[11px] text-gray-500 hover:text-red-600">전체 초기화</button>
              )}
            </div>

            {rows.length === 0 && !routesLoading && (
              <div className="text-[11px] text-gray-500 border border-dashed rounded py-3 text-center">
                이 거래처에 매핑된 제약사가 없습니다.{" "}
                <a href="/submission-routes" className="text-blue-600 underline">통계제출처 관리</a> 에서 등록하거나,
                아래 「자동 분류」 행으로 사진을 올리세요.
              </div>
            )}

            {rows.map((row) => (
              <RowCard
                key={row.key}
                row={row}
                isAuto={false}
                clientName={selectedClient?.clientName ?? ""}
                items={batchItems.filter((it) => it.rowKey === row.key)}
                isSubmitted={isSubmitted}
                batchRunning={batchRunning}
                onAdd={(files) => addFilesToRow(row, files)}
                onRemoveItem={removeBatchItem}
                onClearRow={() => clearRow(row.key)}
              />
            ))}

            {/* 자동 분류 특수 행 */}
            <RowCard
              key={AUTO_ROW_KEY}
              row={{ key: AUTO_ROW_KEY, companyName: "", submissionEntity: "", prevSubmitted: false, noMapping: false }}
              isAuto
              clientName={selectedClient?.clientName ?? ""}
              items={batchItems.filter((it) => it.rowKey === AUTO_ROW_KEY)}
              isSubmitted={isSubmitted}
              batchRunning={batchRunning}
              onAdd={(files) => addFilesToRow({ key: AUTO_ROW_KEY }, files)}
              onRemoveItem={removeBatchItem}
              onClearRow={() => clearRow(AUTO_ROW_KEY)}
            />

            {/* 하단 버튼 */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => setPrevLoaded(true)}
                disabled={!salesSummary || prevCombinationCount === 0 || prevLoaded}
                className="text-sm inline-flex items-center gap-1.5"
              >
                <History className="w-4 h-4" />
                {prevLoaded
                  ? `전월 조합 불러옴 (${prevCombinationCount})`
                  : prevCombinationCount > 0
                    ? `전월 조합 불러오기 (${prevCombinationCount})`
                    : "전월 조합 없음"}
              </Button>
              <Button
                onClick={runBatch}
                disabled={batchRunning || totalPending === 0 || !selectedClientId || isSubmitted}
                className="flex-1 bg-orange-600 hover:bg-orange-700"
              >
                {batchRunning
                  ? `업로드 중... (${totalQueued}/${batchItems.length})`
                  : isSubmitted ? "제출완료된 거래처×월입니다"
                  : totalPending === 0 ? "사진을 먼저 붙이세요"
                  : `업로드하기 (${totalPending}장)`}
              </Button>
            </div>

            {totalQueued > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800 space-y-1">
                <div className="font-semibold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  {totalQueued}장 업로드 완료 · 서버에서 백그라운드 처리 중
                </div>
                <div className="text-blue-700">
                  사진은 이미 서버에 저장됐어요. 페이지 닫거나 다른 작업 하셔도 됩니다.
                  Gemini 분석 + DB + 시트 저장은 약 30~60초/사진 소요.
                </div>
                <div className="text-[11px] text-blue-600 pt-1">
                  결과는 <a href="/biz/stats-review" className="underline font-semibold">AI 처방통계 검수</a> 에서 확인.
                </div>
              </div>
            )}
          </div>
        )}

        {/* 제약사별 매출표 (3개월) — 접이식 */}
        {selectedClientId && (
          <div className="border border-gray-200 rounded overflow-hidden">
            <button
              onClick={() => setShowSalesTable((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 text-left"
            >
              {showSalesTable ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
              <span className="text-xs font-semibold text-gray-700">
                제약사별 매출 (당월·전월·전전월{salesSummary ? ` · ${salesSummary.byCompany.length}개사` : ""})
              </span>
              {summaryLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 ml-1" />}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); refreshSalesSummary(); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); refreshSalesSummary(); } }}
                className="ml-auto text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${summaryLoading ? "animate-spin" : ""}`} /> 새로고침
              </span>
            </button>

            {showSalesTable && salesSummary && (
              salesSummary.byCompany.length === 0 ? (
                <div className="px-3 py-4 text-[11px] text-gray-500 text-center">
                  거래가능 제약사도 매출 실적도 없음.{" "}
                  <a href="/submission-routes" className="text-blue-600 underline">통계제출처 관리</a> 에서 제약사 등록.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="text-left px-3 py-1.5" rowSpan={2}>제약사</th>
                        <th className="text-center px-3 py-1 border-l" colSpan={2}>
                          {salesSummary.prevPrevYear}.{String(salesSummary.prevPrevMonth).padStart(2, "0")}
                        </th>
                        <th className="text-center px-3 py-1 border-l" colSpan={2}>
                          {salesSummary.prevYear}.{String(salesSummary.prevMonth).padStart(2, "0")}
                        </th>
                        <th className="text-center px-3 py-1 border-l bg-orange-50 text-orange-700 font-semibold" colSpan={2}>
                          {salesSummary.year}.{String(salesSummary.month).padStart(2, "0")} (당월)
                        </th>
                        <th className="text-center px-2 py-1.5 w-14 border-l" rowSpan={2}>사진</th>
                      </tr>
                      <tr>
                        <th className="text-right px-2 py-1 w-20 border-l font-normal text-[10px]">수량</th>
                        <th className="text-right px-2 py-1 w-24 font-normal text-[10px]">금액</th>
                        <th className="text-right px-2 py-1 w-20 border-l font-normal text-[10px]">수량</th>
                        <th className="text-right px-2 py-1 w-24 font-normal text-[10px]">금액</th>
                        <th className="text-right px-2 py-1 w-20 border-l bg-orange-50 font-normal text-[10px] text-orange-700">수량</th>
                        <th className="text-right px-2 py-1 w-24 bg-orange-50 font-normal text-[10px] text-orange-700">금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesSummary.byCompany.map((c) => (
                        <tr key={c.companyName} className={`border-t ${c.isAllowed ? "" : "bg-amber-50"}`}>
                          <td className="px-3 py-1.5">
                            <span className="text-gray-800">{c.companyName}</span>
                            {!c.isAllowed && c.companyName !== "(미분류)" && (
                              <span className="ml-1.5 text-[10px] text-amber-700 font-semibold">⚠ 거래 외</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-gray-500 border-l">
                            {c.prevPrevQuantity > 0 ? c.prevPrevQuantity.toLocaleString() : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-gray-500">
                            {c.prevPrevSales > 0 ? c.prevPrevSales.toLocaleString() : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-gray-500 border-l">
                            {c.prevQuantity > 0 ? c.prevQuantity.toLocaleString() : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-gray-500">
                            {c.prevSales > 0 ? c.prevSales.toLocaleString() : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono font-bold bg-orange-50 text-orange-900 border-l">
                            {c.currentQuantity > 0 ? c.currentQuantity.toLocaleString() : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono font-bold bg-orange-50 text-orange-900">
                            {c.currentSales > 0 ? c.currentSales.toLocaleString() : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-center text-[11px] text-gray-500 border-l">
                            {c.currentPhotoCount > 0 ? `${c.currentPhotoCount}장` : "-"}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                        <td className="px-3 py-2 text-gray-700">합계</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 border-l">
                          {salesSummary.byCompany.reduce((s, c) => s + c.prevPrevQuantity, 0).toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600">
                          {salesSummary.byCompany.reduce((s, c) => s + c.prevPrevSales, 0).toLocaleString()}원
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 border-l">
                          {salesSummary.byCompany.reduce((s, c) => s + c.prevQuantity, 0).toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600">
                          {salesSummary.byCompany.reduce((s, c) => s + c.prevSales, 0).toLocaleString()}원
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-orange-900 bg-orange-100 border-l">
                          {salesSummary.byCompany.reduce((s, c) => s + c.currentQuantity, 0).toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-orange-900 bg-orange-100">
                          {salesSummary.byCompany.reduce((s, c) => s + c.currentSales, 0).toLocaleString()}원
                        </td>
                        <td className="px-2 py-2 text-center text-[11px] text-gray-500 border-l">
                          {salesSummary.byCompany.reduce((s, c) => s + c.currentPhotoCount, 0)}장
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
            )}
            {showSalesTable && salesSummary && salesSummary.currentErrorCount > 0 && (
              <div className="px-3 py-1.5 bg-red-50 border-t border-red-200 text-[11px] text-red-700">
                ⚠ 당월에 처리 실패한 사진 {salesSummary.currentErrorCount}장.{" "}
                <a href="/biz/stats-review" className="underline font-semibold">검수 메뉴</a>에서 확인 + 재업로드.
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}
    </div>
  );
}
