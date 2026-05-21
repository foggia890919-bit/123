"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Upload, CheckCircle, AlertCircle, AlertTriangle, ExternalLink, Plus, Trash2, Sparkles, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// 영업사원이 보낸 EMR 처방통계 사진을 Gemini 3.5 가 사람처럼 직접 읽고 5컬럼만 표시.
// 검수 후 "최종 승인" 시 영업실적 DB + 구글 시트 동시 저장.
// 효능/카테고리/단가/기간 등 풀 데이터는 시트에만, 영업실적 DB 는 핵심 5컬럼만.

interface UserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  approved: boolean;
}

interface FusionField { value: string; confidence: number }

interface FusionDrug {
  insuranceCode: FusionField;
  companyName: FusionField;
  productName: FusionField;
  quantity: FusionField;
  unitPrice: number | null;
}

interface RxDrugRow {
  name: string;
  code: string;
  quantity: number;
  prescriptions: number;
  unitPrice: number;
  totalPrice: number;
  category: string;
  efficacy: string;
}

interface OcrResponse {
  drugs: FusionDrug[];
  hospitalName: FusionField;
  partialExtraction: { detected: number; extracted: number } | null;
  rawDrugs: RxDrugRow[];
  rawGeminiText: string;
  geminiMeta: {
    pharma: string;
    period: string;
    periodRaw: string;
    summary: { drugCount: number; totalPrescriptions: number; totalQuantity: number; totalAmountWon: number };
    durationMs: number;
    model: string;
  };
  error?: string;
}

interface EditRow {
  insuranceCode: string;
  companyName: string;
  productName: string;
  quantity: string;
  unitPrice: number;
  totalPrice: number;
  totalPriceManual: boolean;        // true = 사용자가 수동 편집 → 자동 재계산 비활성화
}

// 대량 등록 — 사진 1장 단위 전송 상태.
// 새 background 패턴: 클라이언트는 사진을 서버에 "전송"만 하고 끝. 서버가 Gemini 분석 + DB +
// 시트 저장을 비동기 백그라운드로 수행. 사용자는 페이지 떠나도 OK.
interface BatchItem {
  id: string;
  file: File;
  status: "pending" | "sending" | "queued" | "error";
  errorMsg?: string;
}

interface FinalizeResponse {
  dbRecordId?: string;
  sheetUrl?: string | null;
  sheetBatchId?: string | null;
  sheetWarning?: string | null;
  totalFee?: number;
  rowCount?: number;
  error?: string;
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

async function fileToDataUri(file: File | Blob): Promise<string> {
  return await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export default function StatsPhotoPage() {
  const { data: session } = useSession();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [clients, setClients] = useState<UserClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientQuery, setClientQuery] = useState("");

  // 탭 모드 — single: 1장 검수 후 저장, batch: 여러 장 자동 분석+저장
  const [mode, setMode] = useState<"single" | "batch">("single");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [ocr, setOcr] = useState<OcrResponse | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<FinalizeResponse | null>(null);
  const [error, setError] = useState<string>("");

  // ── 대량 등록 state ───────────────────────────────────────────────────────
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const batchInputRef = useRef<HTMLInputElement>(null);

  // 거래처별 거래가능 제약사 목록 — submission-routes 에서 조회.
  // 거래처 선택 시 자동 fetch → chip 표시 + 분석 결과의 제약사별 합계와 대조용.
  const [allowedCompanies, setAllowedCompanies] = useState<string[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);

  // 거래처×월 제출완료 여부 — 제출완료면 업로드 차단.
  const [submissionStatus, setSubmissionStatus] = useState<{
    submitted: boolean;
    photoCount: number;
    rowCount: number;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/user-clients?userId=${session.user.id}`)
      .then((r) => r.json())
      .then((data) => Array.isArray(data) ? setClients(data) : setClients([]))
      .catch(() => setClients([]));
  }, [session?.user?.id]);

  // 거래처 선택 시 거래가능제약사 목록 fetch (active=true 만)
  useEffect(() => {
    if (!selectedClientId) { setAllowedCompanies([]); return; }
    const client = clients.find((c) => c.id === selectedClientId);
    if (!client) return;
    setCompaniesLoading(true);
    fetch(`/api/submission-routes?clientName=${encodeURIComponent(client.clientName)}&active=true`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: { companyName: string }[]) => {
        const names = Array.from(new Set((data ?? []).map((d) => d.companyName).filter(Boolean)));
        setAllowedCompanies(names);
      })
      .catch(() => setAllowedCompanies([]))
      .finally(() => setCompaniesLoading(false));
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

  // 분석/저장 진행 중에 페이지 떠나려 하면 브라우저 경고. 사용자 실수로 처리 중인
  // 사진을 잃어버리는 사고 방지. 단건/대량 양쪽 모두 동일 보호.
  useEffect(() => {
    const inProgress = analyzing || saving || batchRunning;
    if (!inProgress) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 일부 브라우저는 returnValue 설정 필요. 메시지는 보안상 브라우저 기본 문구로 대체됨.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [analyzing, saving, batchRunning]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  function pickFile(f: File | null) {
    setFile(f);
    setOcr(null);
    setRows([]);
    setSaved(null);
    setError("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  async function handleAnalyze() {
    if (!file) return;
    setAnalyzing(true);
    setError("");
    setOcr(null);
    setSaved(null);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.append("image", compressed, "rx.jpg");
      const res = await fetch("/api/stats/ocr", { method: "POST", body: fd });
      const data = await res.json() as OcrResponse;
      if (!res.ok || data.error) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setOcr(data);
      // 5컬럼 EditRow 초기화. 매출금액 = quantity × unitPrice 자동 계산.
      setRows(data.drugs.map((d) => {
        const qty = parseFloat(d.quantity.value) || 0;
        const unit = d.unitPrice || 0;
        return {
          insuranceCode: d.insuranceCode.value,
          companyName: d.companyName.value,
          productName: d.productName.value,
          quantity: d.quantity.value,
          unitPrice: unit,
          totalPrice: qty * unit,
          totalPriceManual: false,
        };
      }));
    } catch (e) {
      setError(`분석 실패: ${String(e).slice(0, 300)}`);
    } finally {
      setAnalyzing(false);
    }
  }

  function updateRow(i: number, patch: Partial<EditRow>) {
    setRows((prev) => prev.map((r, idx) => {
      if (idx !== i) return r;
      const next: EditRow = { ...r, ...patch };
      // 사용자가 totalPrice 직접 입력하지 않으면 자동 재계산
      if (!next.totalPriceManual && (patch.quantity !== undefined || patch.unitPrice !== undefined)) {
        const qty = parseFloat(next.quantity) || 0;
        next.totalPrice = Math.round(qty * next.unitPrice);
      }
      return next;
    }));
  }

  function addRow() {
    setRows((prev) => [...prev, {
      insuranceCode: "", companyName: "", productName: "", quantity: "0",
      unitPrice: 0, totalPrice: 0, totalPriceManual: false,
    }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleFinalize() {
    if (!ocr || !file || rows.length === 0) return;
    if (!selectedClientId) {
      setError("거래처를 먼저 선택하세요");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const compressed = await compressImage(file);
      const imageBase64 = await fileToDataUri(compressed);
      const body = {
        clientId: selectedClientId,
        year,
        month,
        hospitalName: selectedClient?.clientName ?? ocr.hospitalName.value,
        companyName: ocr.geminiMeta.pharma,
        imageBase64,
        rows: rows.map((r) => ({
          insuranceCode: r.insuranceCode,
          companyName: r.companyName,
          productName: r.productName,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          totalPrice: r.totalPrice,
        })),
        rawDrugs: ocr.rawDrugs,
        geminiMeta: ocr.geminiMeta,
        rawGeminiText: ocr.rawGeminiText,
      };
      const res = await fetch("/api/stats/photo-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as FinalizeResponse;
      if (!res.ok || data.error) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setSaved(data);
    } catch (e) {
      setError(`저장 실패: ${String(e).slice(0, 300)}`);
    } finally {
      setSaving(false);
    }
  }

  const totalRevenue = rows.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);

  // 제약사별 매출 합계 — 검수가 진행되면서 실시간 갱신.
  // companyName 빈 값은 "(미분류)" 로 묶음. allowedCompanies 와 비교해서 unmapped 표시.
  const byCompany = useMemo(() => {
    const m = new Map<string, { revenue: number; rowCount: number; quantity: number }>();
    for (const r of rows) {
      const name = (r.companyName || "(미분류)").trim();
      const prev = m.get(name) ?? { revenue: 0, rowCount: 0, quantity: 0 };
      prev.revenue += Number(r.totalPrice) || 0;
      prev.rowCount += 1;
      prev.quantity += parseFloat(r.quantity) || 0;
      m.set(name, prev);
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  const allowedSet = useMemo(() => new Set(allowedCompanies.map((n) => n.trim())), [allowedCompanies]);

  // ── 대량 등록 함수 ────────────────────────────────────────────────────────

  function addBatchFiles(files: FileList | File[] | null) {
    if (!files) return;
    const items: BatchItem[] = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        status: "pending" as const,
      }));
    if (items.length > 0) setBatchItems((prev) => [...prev, ...items]);
  }

  function removeBatchItem(id: string) {
    setBatchItems((prev) => prev.filter((it) => it.id !== id));
  }

  // 한 사진 전송 — 압축 후 /api/stats/photo-auto POST. 응답이 빠르고 (1~2초)
  // 백그라운드 처리는 서버가 알아서. 사용자는 응답 후 자유롭게 페이지 이동 가능.
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
      const res = await fetch("/api/stats/photo-auto", { method: "POST", body: fd });
      const data = await res.json() as { queued?: boolean; error?: string };
      if (!res.ok || data.error) {
        update({ status: "error", errorMsg: data.error || `HTTP ${res.status}` });
        return;
      }
      update({ status: "queued" });
    } catch (e) {
      update({ status: "error", errorMsg: `전송 실패: ${String(e).slice(0, 200)}` });
    }
  }

  async function runBatch() {
    if (!selectedClientId) {
      setError("거래처를 먼저 선택하세요");
      return;
    }
    if (batchItems.length === 0) return;
    setBatchRunning(true);
    setError("");
    try {
      // 동시 전송 (Promise.all) — 응답이 빠르므로 사용자 대기 시간 최소화.
      // 서버 측에서 각 요청을 별도 함수 invocation 으로 받아 백그라운드 처리.
      const targets = batchItems.filter((it) => it.status === "pending" || it.status === "error");
      await Promise.all(targets.map((it) => sendBatchItem(it)));
    } finally {
      setBatchRunning(false);
    }
  }

  function clearBatch() {
    setBatchItems([]);
  }

  // (background 패턴 도입 후 클라이언트에서 배치 누적 매출 표시는 제거됨.
  //  결과는 서버 백그라운드에서 DB + 시트에 저장 → 사용자가 시트/실적관리에서 확인.)

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-orange-500" />
        <h1 className="text-2xl font-bold text-gray-900">AI 처방통계 등록</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-2">
        Gemini 멀티모달이 사진을 사람처럼 직접 읽어 보험코드·제약사·제품명·수량·매출금액 5개 정보만
        깔끔하게 추출합니다. 검수 후 최종 승인하면 영업실적 DB + 구글 시트에 동시 저장.
        OCR 사전처리 없음 — 비스듬한 사진/모니터 반사에 강건.
      </p>

      {/* 탭 */}
      <div className="border-b border-gray-200 flex gap-2">
        <button
          onClick={() => setMode("single")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            mode === "single"
              ? "border-orange-600 text-orange-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}>
          단건 등록 (검수 가능)
        </button>
        <button
          onClick={() => setMode("batch")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            mode === "batch"
              ? "border-orange-600 text-orange-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}>
          대량 등록 (여러 장 자동)
        </button>
      </div>

      {/* 상단: 처방 기간 + 거래처 선택 + 사진 업로드 (단건/대량 공통) */}
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
              onChange={(e) => { setSelectedClientId(e.target.value); setClientQuery(""); }}
              className="mt-1 w-full border rounded px-3 py-2 text-sm bg-white"
            >
              <option value="">— 거래처 선택 —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.clientName}{!c.approved ? " (승인전)" : ""}
                </option>
              ))}
            </select>
            {clients.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                등록된 거래처가 없습니다.{" "}
                <a href="/mypage/clients" className="underline">거래처 관리</a> 에서 먼저 등록하세요.
              </p>
            )}
          </div>
        </div>

        {/* 제출완료 거래처×월 — 업로드 차단 배너 */}
        {submissionStatus?.submitted && (
          <div className="bg-red-50 border border-red-200 rounded px-3 py-2.5 flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-red-800 flex-1">
              <div className="font-semibold">
                ✅ 제출완료 — {selectedClient?.clientName} · {year}년 {month}월
              </div>
              <div className="text-red-700 mt-0.5">
                사진 {submissionStatus.photoCount}장 / 약품 {submissionStatus.rowCount}건이 이미 제출완료된
                거래처×월입니다. 추가 업로드 불가. 잘못 올린 거면{" "}
                <a href="/biz/stats-review" className="underline font-semibold">검수 페이지</a>에서
                삭제 후 다시 업로드하세요.
              </div>
            </div>
          </div>
        )}

        {/* 거래가능 제약사 chip — 선택된 거래처의 SubmissionRoute (active=true) 에서 조회 */}
        {selectedClientId && (
          <div className="bg-blue-50 border border-blue-100 rounded px-3 py-2.5">
            <div className="flex items-center gap-2 mb-1.5">
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[11px] font-semibold text-blue-800">
                거래가능 제약사 ({allowedCompanies.length}개)
              </span>
              {companiesLoading && <span className="text-[10px] text-blue-500">조회 중...</span>}
            </div>
            {allowedCompanies.length === 0 && !companiesLoading ? (
              <p className="text-[11px] text-gray-500">
                이 거래처의 등록된 제약사가 없습니다.{" "}
                <a href="/biz/submission-routes" className="text-blue-600 underline">통계제출처 관리</a> 에서 등록하세요.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allowedCompanies.map((name) => (
                  <span key={name}
                    className="inline-block px-2 py-0.5 bg-white border border-blue-200 rounded text-[11px] text-blue-700">
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 단건 — 사진 1장 업로드 */}
        {mode === "single" && (
          <>
            <label
              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-md py-10 cursor-pointer hover:bg-gray-50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f && f.type.startsWith("image/")) pickFile(f);
              }}
            >
              <Upload className="w-8 h-8 text-gray-400" />
              <span className="text-sm text-gray-600">
                {file ? file.name : "처방통계 사진을 클릭 또는 드래그해서 업로드"}
              </span>
              {file && <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>}
              <input ref={inputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            </label>

            {previewUrl && (
              <div className="border rounded overflow-hidden bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="preview" className="max-h-72 mx-auto" />
              </div>
            )}

            <Button onClick={handleAnalyze}
              disabled={!file || analyzing || submissionStatus?.submitted}
              className="w-full">
              {analyzing ? "분석 중... (Gemini 3.5, 30~60초)"
                : submissionStatus?.submitted ? "제출완료된 거래처×월입니다"
                : "사진 분석 시작"}
            </Button>
          </>
        )}

        {/* 대량 — 여러 사진 한 번에 업로드 + 자동 저장 */}
        {mode === "batch" && (
          <>
            <label
              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-md py-10 cursor-pointer hover:bg-gray-50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addBatchFiles(e.dataTransfer.files);
              }}
            >
              <Upload className="w-8 h-8 text-gray-400" />
              <span className="text-sm text-gray-600">
                여러 사진을 한 번에 선택하거나 드래그하세요
              </span>
              <span className="text-[11px] text-gray-400">
                선택된 거래처/월 기준으로 일괄 분석 → 자동 저장됩니다. 검수 단계 없음.
              </span>
              <input ref={batchInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => { addBatchFiles(e.target.files); e.target.value = ""; }} />
            </label>

            {batchItems.length > 0 && (
              <div className="border rounded">
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50">
                  <span className="text-xs font-semibold text-gray-700">
                    선택된 사진 {batchItems.length}장
                  </span>
                  <span className="text-[10px] text-gray-500 ml-2">
                    전송됨 {batchItems.filter(it => it.status === "queued").length} · 실패 {batchItems.filter(it => it.status === "error").length} · 대기 {batchItems.filter(it => it.status === "pending").length}
                  </span>
                  <Button variant="outline" size="sm" onClick={clearBatch} disabled={batchRunning}
                    className="ml-auto text-xs">전체 초기화</Button>
                </div>
                <div className="max-h-60 overflow-y-auto divide-y">
                  {batchItems.map((it) => (
                    <div key={it.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate text-gray-800">
                        {it.file.name}
                        <span className="ml-2 text-[10px] text-gray-400">{(it.file.size / 1024).toFixed(0)}KB</span>
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        it.status === "pending" ? "bg-gray-100 text-gray-600" :
                        it.status === "sending" ? "bg-blue-100 text-blue-700" :
                        it.status === "queued"  ? "bg-green-100 text-green-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {it.status === "pending" ? "대기" :
                         it.status === "sending" ? "전송중" :
                         it.status === "queued"  ? "전송됨 (백그라운드)" :
                         "실패"}
                      </span>
                      {it.errorMsg && (
                        <span className="text-[10px] text-red-600 max-w-[200px] truncate" title={it.errorMsg}>
                          {it.errorMsg}
                        </span>
                      )}
                      {!batchRunning && it.status !== "sending" && (
                        <button onClick={() => removeBatchItem(it.id)} className="text-gray-400 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5"/>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button onClick={runBatch}
              disabled={batchRunning || batchItems.length === 0 || !selectedClientId || submissionStatus?.submitted}
              className="w-full bg-orange-600 hover:bg-orange-700">
              {batchRunning
                ? `전송 중... (${batchItems.filter(it => it.status === "queued" || it.status === "error").length}/${batchItems.length})`
                : submissionStatus?.submitted ? "제출완료된 거래처×월입니다"
                : `${batchItems.length}장 전송 (서버에서 자동 분석·저장)`}
            </Button>

            {batchItems.filter(it => it.status === "queued").length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800 space-y-1">
                <div className="font-semibold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5"/>
                  {batchItems.filter(it => it.status === "queued").length}장 전송 완료 · 백그라운드 처리 중
                </div>
                <div className="text-blue-700">
                  서버가 사진별로 Gemini 분석 → 영업실적 DB + 구글 시트에 자동 저장합니다.
                  사진 1장당 약 30~60초 소요. 이 페이지를 닫거나 다른 작업을 하셔도 됩니다.
                </div>
                <div className="text-[11px] text-blue-600 pt-1">
                  결과는 <a href="/mypage/performance" className="underline">영업실적 관리</a> 또는
                  구글 시트 (처방통계 데이터) 에서 확인하세요. 처리 완료 후 시트가 자동 업데이트됩니다.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 단건 분석 결과 — 5컬럼 검수 표 */}
      {mode === "single" && ocr && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-sm font-semibold text-gray-800">분석 완료 — 검수 후 최종 승인</span>
            <span className="text-[11px] text-gray-500">{ocr.geminiMeta.model} · {(ocr.geminiMeta.durationMs / 1000).toFixed(1)}s</span>
            <span className="text-[11px] text-gray-500 ml-auto">총 매출 <strong className="text-gray-800">{totalRevenue.toLocaleString()}원</strong></span>
          </div>

          {ocr.partialExtraction && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-800">
                <span className="font-semibold">부분 추출 감지</span> — 사진의 약품수 ({ocr.partialExtraction.detected}건) 와 추출된 행 수 ({ocr.partialExtraction.extracted}건) 가 다릅니다.
                일부 행이 누락됐을 수 있어요 — 행 추가로 수동 입력하거나 더 선명한 사진으로 재시도.
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 w-[18%]">보험코드</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 w-[18%]">제약사</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">제품명</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500 w-[10%]">수량</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500 w-[14%]">매출금액</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="px-2 py-1">
                      <input value={r.insuranceCode} onChange={(e) => updateRow(i, { insuranceCode: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-[11px] font-mono"/>
                    </td>
                    <td className="px-2 py-1">
                      <input value={r.companyName} onChange={(e) => updateRow(i, { companyName: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-[11px]"/>
                    </td>
                    <td className="px-2 py-1">
                      <input value={r.productName} onChange={(e) => updateRow(i, { productName: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-[11px]"/>
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" step="0.1" value={r.quantity} onChange={(e) => updateRow(i, { quantity: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-[11px] text-right"/>
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={r.totalPrice}
                        onChange={(e) => updateRow(i, { totalPrice: Number(e.target.value), totalPriceManual: true })}
                        className="w-full px-2 py-1 border rounded text-[11px] text-right"/>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500" title="행 삭제">
                        <Trash2 className="w-3.5 h-3.5"/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t px-4 py-3 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addRow} className="text-xs">
              <Plus className="w-3.5 h-3.5 mr-1"/>행 추가
            </Button>
            <span className="text-[11px] text-gray-400 ml-2">
              매출금액은 수량 × 단가 자동 계산. 직접 입력 시 자동 계산 해제.
            </span>
            <Button onClick={handleFinalize} disabled={saving || !selectedClientId}
              className="ml-auto bg-orange-600 hover:bg-orange-700">
              {saving ? "저장 중..." : "최종 승인 (DB + 시트 저장)"}
            </Button>
          </div>

          {/* 제약사별 매출 합계 — 검수 따라 실시간 갱신. allowedCompanies 와 대조해서
              거래가능제약사 외 제약사가 들어왔으면 주황색 표시 (사용자가 확인). */}
          {byCompany.length > 0 && (
            <div className="border-t bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="w-3.5 h-3.5 text-gray-600" />
                <span className="text-xs font-semibold text-gray-700">제약사별 매출 합계</span>
                <span className="text-[10px] text-gray-500 ml-auto">총 {byCompany.length}개 제약사</span>
              </div>
              <div className="space-y-1">
                {byCompany.map((c) => {
                  const isAllowed = c.name === "(미분류)" || allowedSet.size === 0 || allowedSet.has(c.name);
                  return (
                    <div key={c.name}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded ${isAllowed ? "bg-white border border-gray-200" : "bg-amber-50 border border-amber-200"}`}>
                      <span className="text-xs text-gray-800 flex-1 truncate">
                        {c.name}
                        {!isAllowed && c.name !== "(미분류)" && (
                          <span className="ml-2 text-[10px] text-amber-700 font-semibold" title="거래가능제약사 목록에 없는 제약사">
                            ⚠ 거래 외
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-gray-500 w-16 text-right">{c.rowCount}건</span>
                      <span className="text-[11px] text-gray-500 w-20 text-right">{c.quantity.toLocaleString()}정</span>
                      <span className="text-xs font-mono font-semibold text-gray-800 w-28 text-right">
                        {c.revenue.toLocaleString()}원
                      </span>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 px-2 py-2 mt-1 border-t border-gray-300 bg-orange-50">
                  <span className="text-xs font-bold text-orange-900 flex-1">총 매출</span>
                  <span className="text-sm font-mono font-bold text-orange-900">{totalRevenue.toLocaleString()}원</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 단건 저장 완료 안내 */}
      {mode === "single" && saved && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-green-800 font-semibold">
            <CheckCircle className="w-5 h-5" />
            저장 완료 — 영업실적 DB + 구글 시트
          </div>
          <div className="text-xs text-green-700 space-y-1">
            <div>약품 행 {saved.rowCount}건 · 매출 합계 <strong>{saved.totalFee?.toLocaleString()}원</strong></div>
            {saved.sheetUrl && (
              <a href={saved.sheetUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                구글 시트에서 보기 <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {saved.sheetBatchId && <div className="text-[10px] text-gray-500">batchId: <code>{saved.sheetBatchId}</code></div>}
            {saved.sheetWarning && (
              <div className="text-amber-700 mt-2 p-2 bg-amber-50 rounded border border-amber-200">
                ⚠ {saved.sheetWarning} (DB 저장은 완료. 관리자에게 알려주세요.)
              </div>
            )}
            <div className="text-[11px] text-gray-500 pt-1">
              영업실적 관리(<a href="/mypage/performance" className="text-blue-600 hover:underline">mypage/performance</a>)
              에서 이 기록을 조회할 수 있습니다.
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}
    </div>
  );
}
