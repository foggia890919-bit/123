"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Upload, CheckCircle, AlertCircle, Trash2, Sparkles, Building2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// AI 처방통계 등록 — 사진 1장 또는 여러 장 한꺼번에 업로드 → 서버 백그라운드에서
// Gemini 분석 + 마스터 매칭 + DB + 구글 시트 저장. 사용자는 전송만 누르면 끝.
// 검수는 별도 메뉴 "AI 처방통계 검수" 에서 사진과 함께 좌우 분할로 진행.

interface UserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  approved: boolean;
}

interface BatchItem {
  id: string;
  file: File;
  status: "pending" | "sending" | "queued" | "error";
  errorMsg?: string;
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

export default function StatsPhotoPage() {
  const { data: session } = useSession();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [clients, setClients] = useState<UserClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [, setClientQuery] = useState("");

  const [error, setError] = useState<string>("");

  // 거래처별 거래가능 제약사 + 제출완료 상태
  const [allowedCompanies, setAllowedCompanies] = useState<string[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<{
    submitted: boolean;
    photoCount: number;
    rowCount: number;
  } | null>(null);

  // 제약사별 매출 요약 (당월/전월/전전월) — 거래처 선택 시 자동 fetch + 백그라운드 처리 중 polling.
  // 매출 = 단가×수량 합계 (원). 수량 = 처방수량 합계 (정). 비급여는 단가 0 이라 매출만으론 불충분.
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
  const batchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/user-clients?userId=${session.user.id}`)
      .then((r) => r.json())
      .then((data) => Array.isArray(data) ? setClients(data) : setClients([]))
      .catch(() => setClients([]));
  }, [session?.user?.id]);

  // 거래처 선택 시 거래가능제약사 목록 fetch
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

  // 거래처+월 선택 시 매출 요약 (당월/전월/전전월) 자동 fetch
  useEffect(() => {
    refreshSalesSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, year, month]);

  // 사진 전송 완료 후 백그라운드 처리 중 자동 갱신 polling.
  // 클라이언트가 방금 보낸 사진(queued) 만 추적 — 옛 PROCESSING row 가 stuck 이면
  // 영원히 polling 돌던 버그 fix. 3분 timeout. 페이지 나가도 백엔드는 계속 처리.
  const [pollStartAt, setPollStartAt] = useState<number | null>(null);
  useEffect(() => {
    if (!selectedClientId) return;
    const hasQueued = batchItems.some((it) => it.status === "queued");
    if (!hasQueued) {
      // queued 가 모두 끝나면 polling 종료 (옛 PROCESSING row 와 무관)
      setPollStartAt(null);
      return;
    }
    // 첫 polling 시작 시각 기록
    if (pollStartAt === null) setPollStartAt(Date.now());

    const id = setInterval(() => {
      const now = Date.now();
      // 3분 후 자동 종료
      if (pollStartAt !== null && now - pollStartAt > 3 * 60 * 1000) {
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
  const allowedSet = useMemo(() => new Set(allowedCompanies.map((n) => n.trim())), [allowedCompanies]);
  void allowedSet;  // 안내용 — 검수 페이지에서 활용

  function addBatchFiles(files: FileList | File[] | null) {
    if (!files) return;
    // 같은 파일 (이름+크기+수정시각) 이미 batchItems 에 있으면 중복 추가 거부.
    // 서버 측에선 SHA-256 hash 로 중복 차단되지만 클라이언트에서 미리 거름.
    const incoming = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setBatchItems((prev) => {
      const seen = new Set(prev.map((it) => `${it.file.name}|${it.file.size}|${it.file.lastModified}`));
      const newItems: BatchItem[] = [];
      for (const f of incoming) {
        const key = `${f.name}|${f.size}|${f.lastModified}`;
        if (seen.has(key)) continue;
        seen.add(key);
        newItems.push({ id: crypto.randomUUID(), file: f, status: "pending" });
      }
      return [...prev, ...newItems];
    });
  }

  function removeBatchItem(id: string) {
    setBatchItems((prev) => prev.filter((it) => it.id !== id));
  }

  // 한 사진 전송 — 압축 후 /api/stats/photo-auto POST.
  // 응답이 빠르고 (1~2초) 백그라운드 처리는 서버가 알아서.
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
      const text = await res.text();
      let data: { ok?: boolean; error?: string; duplicate?: boolean; sheetWarning?: string | null };
      try {
        data = text ? JSON.parse(text) : { error: `빈 응답 (HTTP ${res.status})` };
      } catch {
        data = { error: text.slice(0, 200) || `HTTP ${res.status} 응답 파싱 실패` };
      }
      // 409 = 중복 사진. 사용자에게 명확히 표시 (실패 아님 — 이미 있음)
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
    if (!selectedClientId) {
      setError("거래처를 먼저 선택하세요");
      return;
    }
    if (batchItems.length === 0) return;
    setBatchRunning(true);
    setError("");
    try {
      // Concurrency 3 — Vercel 동시 호출 부담 회피 + 응답 안정성
      const CONCURRENCY = 3;
      const targets = batchItems.filter((it) => it.status === "pending" || it.status === "error");
      for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const chunk = targets.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map((it) => sendBatchItem(it)));
      }
    } finally {
      setBatchRunning(false);
    }
  }

  function clearBatch() {
    setBatchItems([]);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-orange-500" />
        <h1 className="text-2xl font-bold text-gray-900">AI 처방통계 등록</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-2">
        사진 1장이든 여러 장이든 선택 → "전송". 사진이 서버에 즉시 저장되고 백그라운드에서 Gemini 분석 + 매칭 + 시트.
        페이지 닫거나 다른 작업 하셔도 OK. 결과는{" "}
        <a href="/biz/stats-review" className="text-orange-600 underline">AI 처방통계 검수</a> 에서
        사진과 함께 확인. (Gemini 가 처리 못한 사진은 검수에서 "처리 실패" 로 표시되어 재업로드 가능)
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
                <a href="/mypage/clients" className="underline">거래처 관리</a>
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

        {/* 거래가능 제약사 + 제약사별 매출 표 (당월/전월/전전월) */}
        {selectedClientId && salesSummary && (
          <div className="bg-white border border-gray-200 rounded overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50">
              <Building2 className="w-3.5 h-3.5 text-gray-600" />
              <span className="text-xs font-semibold text-gray-700">
                제약사별 매출 ({salesSummary.byCompany.length}개사)
              </span>
              {(batchItems.some((it) => it.status === "queued") && pollStartAt !== null) && (
                <span className="ml-2 text-[11px] text-blue-600 inline-flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  처리 중 — 자동 갱신 (5초). <span className="font-semibold ml-1">옆에 나가도 업데이트는 됨</span>
                </span>
              )}
              <button onClick={refreshSalesSummary} disabled={summaryLoading}
                className="ml-auto text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
                <RefreshCw className={`w-3 h-3 ${summaryLoading ? "animate-spin" : ""}`} /> 새로고침
              </button>
            </div>
            {salesSummary.byCompany.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-gray-500 text-center">
                거래가능 제약사도 매출 실적도 없음.{" "}
                <a href="/biz/submission-routes" className="text-blue-600 underline">통계제출처 관리</a> 에서 제약사 등록.
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
            )}
            {salesSummary.currentErrorCount > 0 && (
              <div className="px-3 py-1.5 bg-red-50 border-t border-red-200 text-[11px] text-red-700">
                ⚠ 당월에 처리 실패한 사진 {salesSummary.currentErrorCount}장.{" "}
                <a href="/biz/stats-review" className="underline font-semibold">검수 메뉴</a>에서 확인 + 재업로드.
              </div>
            )}
          </div>
        )}
        {selectedClientId && !salesSummary && summaryLoading && (
          <div className="text-center py-4 text-xs text-gray-400 inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 매출 실적 조회 중...
          </div>
        )}

        {/* 사진 업로드 영역 */}
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
            사진을 클릭해서 선택하거나 드래그하세요 (한 장 또는 여러 장)
          </span>
          <span className="text-[11px] text-gray-400">
            선택된 거래처/월 기준으로 일괄 분석 → 자동 저장. 검수는 별도 메뉴에서.
          </span>
          <input ref={batchInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { addBatchFiles(e.target.files); e.target.value = ""; }} />
        </label>

        {/* 선택된 사진 리스트 */}
        {batchItems.length > 0 && (
          <div className="border rounded">
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50">
              <span className="text-xs font-semibold text-gray-700">
                선택된 사진 {batchItems.length}장
              </span>
              <span className="text-[10px] text-gray-500 ml-2">
                완료 {batchItems.filter(it => it.status === "queued").length} · 실패 {batchItems.filter(it => it.status === "error").length} · 대기 {batchItems.filter(it => it.status === "pending").length} · 처리중 {batchItems.filter(it => it.status === "sending").length}
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
                     it.status === "queued"  ? "전송완료 (백그라운드 처리)" :
                     "전송 실패"}
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
            : batchItems.length === 0 ? "사진을 먼저 선택하세요"
            : `${batchItems.length}장 전송 (서버에서 자동 분석·저장)`}
        </Button>

        {batchItems.filter(it => it.status === "queued").length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800 space-y-1">
            <div className="font-semibold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5"/>
              {batchItems.filter(it => it.status === "queued").length}장 전송 완료 · 서버에서 백그라운드 처리 중
            </div>
            <div className="text-blue-700">
              사진은 이미 서버에 저장됐어요. 페이지 닫거나 다른 작업 하셔도 됩니다.
              Gemini 분석 + DB + 시트 저장은 약 30~60초/사진 소요.
            </div>
            <div className="text-[11px] text-blue-600 pt-1">
              결과는 <a href="/biz/stats-review" className="underline font-semibold">AI 처방통계 검수</a> 에서
              확인. 처리 실패한 사진은 "실패" 배지 + 사유 표시됩니다.
            </div>
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
