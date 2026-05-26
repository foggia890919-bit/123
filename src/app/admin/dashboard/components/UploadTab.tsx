"use client";

import { useState, useEffect, useRef } from "react";
import { Upload, CheckCircle, AlertCircle, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function UploadTab() {
  const [file, setFile] = useState<File | null>(null);
  const [isSettlement, setIsSettlement] = useState(true);
  const [settlementType, setSettlementType] = useState<"원외" | "원내">("원외");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; count?: number; updated?: number; created?: number; skipped?: number; error?: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);


  const [mapFile, setMapFile] = useState<File | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [missingCodeCount, setMissingCodeCount] = useState<number | null>(null);
  const [missingDownloading, setMissingDownloading] = useState(false);
  const [mapResult, setMapResult] = useState<{ success?: boolean; mapped?: number; updated?: number; ingredientUpdated?: number; ingredientAttempted?: number; total?: number; filled?: number; lastSync?: string | null; error?: string; sampleKeys?: string[]; diagnostics?: { sampleKeys?: string[]; sampleItem?: Record<string, unknown> | null; withName?: number; withSpec?: number; withEither?: number; sampleRows?: { productName: string; ingredientName: string; insuranceCode: string | null }[] } } | null>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);

  async function handleMapUpload() {
    if (!mapFile) return;
    setMapLoading(true); setMapResult(null);
    const formData = new FormData();
    formData.append("file", mapFile);
    try {
      const res = await fetch("/api/medications/map-ingredient", { method: "POST", body: formData });
      const data = await res.json();
      setMapResult(data);
      if (data.success) setMapFile(null);
    } catch { setMapResult({ error: "업로드 중 오류가 발생했어요." }); }
    finally { setMapLoading(false); }
  }

  const [fillPriceLoading, setFillPriceLoading] = useState(false);
  const [fillPriceResult, setFillPriceResult] = useState<{ success?: boolean; filled?: number; scanned?: number; pageErrors?: number; pagesProcessed?: number; totalMeds?: number; nullPriceMeds?: number; filledPriceMeds?: number; error?: string } | null>(null);
  const [fillPriceStats, setFillPriceStats] = useState<{ totalMeds?: number; nullPriceMeds?: number; hasPriceMeds?: number; excelWithPrice?: number; apiWithPrice?: number } | null>(null);

  const [priceImportFile, setPriceImportFile] = useState<File | null>(null);
  const [priceImportLoading, setPriceImportLoading] = useState(false);
  const [priceImportResult, setPriceImportResult] = useState<{ success?: boolean; parsed?: number; updated?: number; nullPriceMeds?: number; message?: string; error?: string } | null>(null);

  async function handlePriceImport() {
    if (!priceImportFile) return;
    setPriceImportLoading(true); setPriceImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", priceImportFile);
      const res = await fetch("/api/admin/price-import", { method: "POST", body: fd });
      const data = await res.json();
      setPriceImportResult(data);
      if (data.success) {
        setPriceImportFile(null);
        setFillPriceStats((prev) => prev ? { ...prev, nullPriceMeds: data.nullPriceMeds } : prev);
      }
    } catch { setPriceImportResult({ error: "업로드 중 오류가 발생했어요." }); }
    finally { setPriceImportLoading(false); }
  }

  useEffect(() => {
    fetch("/api/admin/fill-prices")
      .then((r) => r.json())
      .then((d) => setFillPriceStats(d))
      .catch(() => null);
  }, []);

  const [fillPriceDebug, setFillPriceDebug] = useState<string | null>(null);

  async function handleFillPrices() {
    setFillPriceLoading(true); setFillPriceResult(null);
    try {
      const res = await fetch("/api/admin/fill-prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ maxPages: 200 }) });
      const data = await res.json();
      setFillPriceResult(data);
      if (data.success) setFillPriceStats({ totalMeds: data.totalMeds, nullPriceMeds: data.nullPriceMeds, hasPriceMeds: data.filledPriceMeds });
    } catch { setFillPriceResult({ error: "약가 채우기 중 오류가 발생했어요." }); }
    finally { setFillPriceLoading(false); }
  }

  async function handleFillPricesDebug() {
    setFillPriceDebug("한미약품 약가 3건 조회 중...");
    try {
      const res = await fetch("/api/admin/fill-prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ debug: true, company: "한미약품" }) });
      const data = await res.json();
      setFillPriceDebug(JSON.stringify(data, null, 2));
    } catch (e) { setFillPriceDebug("오류: " + String(e)); }
  }

  async function handleIngredientSync() {
    setMapLoading(true); setMapResult(null);
    try {
      const res = await fetch("/api/medications/sync-ingredient-codes", { method: "POST" });
      const text = await res.text();
      let data: typeof mapResult;
      try { data = JSON.parse(text); }
      catch { data = { error: `API 응답이 JSON이 아닙니다 (HTTP ${res.status}): ${text.slice(0, 300)}` }; }
      setMapResult(data);
      // 동기화 후 공란 카운트 갱신
      fetch("/api/medications/missing-codes?format=json")
        .then((r) => r.json())
        .then((d) => { if (d.missingCount !== undefined) setMissingCodeCount(d.missingCount); })
        .catch(() => null);
    } catch (e) { setMapResult({ error: `동기화 중 오류: ${e instanceof Error ? e.message : String(e)}` }); }
    finally { setMapLoading(false); }
  }

  async function handleDownloadMissingCodes(insuranceOnly: boolean) {
    setMissingDownloading(true);
    try {
      const url = `/api/medications/missing-codes?format=excel${insuranceOnly ? "&hasInsuranceCode=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) { alert("다운로드 실패"); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = insuranceOnly ? "보험코드있음_주성분코드공란.xlsx" : "주성분코드공란_전체.xlsx";
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setMissingDownloading(false);
    }
  }

  useEffect(() => {
    fetch("/api/medications/sync-ingredient-codes")
      .then((r) => r.json())
      .then((d) => setMapResult(d))
      .catch(() => null);
    fetch("/api/medications/missing-codes?format=json")
      .then((r) => r.json())
      .then((d) => { if (d.missingCount !== undefined) setMissingCodeCount(d.missingCount); })
      .catch(() => null);
  }, []);

  // ③-2: 주성분명 사전 (hira_cmpn) 기반 보완 sync — 비급여 약품 커버리지 보완
  const [cmpnLoading, setCmpnLoading] = useState(false);
  const [cmpnProbing, setCmpnProbing] = useState(false);
  const [cmpnResult, setCmpnResult] = useState<{
    success?: boolean; probe?: boolean;
    apiTotalCount?: number; totalCount?: number;
    extractedCmpns?: number; uniqueNames?: number;
    candidates?: number; exactMatched?: number; containsMatched?: number;
    multiCandidate?: number; updated?: number; lastSync?: string;
    finalState?: { withCode: number; totalDb: number; coverage: string };
    sampleKeys?: string[]; sampleItems?: unknown[]; sampleExtracts?: unknown[];
    note?: string; error?: string; rawXml?: string; parsedStructure?: string; seededNames?: number;
  } | null>(null);

  async function handleCmpnProbe() {
    setCmpnProbing(true); setCmpnResult(null);
    try {
      const res = await fetch("/api/medications/sync-cmpn-codes");
      const data = await res.json();
      setCmpnResult(data);
    } catch { setCmpnResult({ error: "API 응답 확인 중 오류가 발생했어요." }); }
    finally { setCmpnProbing(false); }
  }

  async function handleCmpnSync() {
    setCmpnLoading(true); setCmpnResult(null);
    try {
      const res = await fetch("/api/medications/sync-cmpn-codes", { method: "POST" });
      const data = await res.json();
      setCmpnResult(data);
      // 보완 sync 후 공란 카운트도 갱신
      fetch("/api/medications/missing-codes?format=json")
        .then((r) => r.json())
        .then((d) => { if (d.missingCount !== undefined) setMissingCodeCount(d.missingCount); })
        .catch(() => null);
    } catch { setCmpnResult({ error: "동기화 중 오류가 발생했어요." }); }
    finally { setCmpnLoading(false); }
  }


  const [dedupStats, setDedupStats] = useState<{ totalDupeGroups?: number; totalExtraRows?: number; samples?: { productName: string; companyName: string; count: number }[] } | null>(null);
  const [dedupLoading, setDedupLoading] = useState(false);
  const [dedupResult, setDedupResult] = useState<{ deleted?: number; totalAfter?: number; error?: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/dedup-medications").then((r) => r.json()).then(setDedupStats).catch(() => null);
  }, []);

  async function handleDedup() {
    if (!confirm(`중복 약품 ${dedupStats?.totalExtraRows?.toLocaleString()}건을 삭제할까요? (제안서에 사용 중인 건은 보존됩니다)`)) return;
    setDedupLoading(true); setDedupResult(null);
    try {
      const res = await fetch("/api/admin/dedup-medications", { method: "POST" });
      const data = await res.json();
      setDedupResult(data);
      if (data.success) {
        fetch("/api/admin/dedup-medications").then((r) => r.json()).then(setDedupStats).catch(() => null);
      }
    } catch (e) { setDedupResult({ error: String(e) }); }
    finally { setDedupLoading(false); }
  }

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success?: boolean; synced?: number; totalPublic?: number; publicCount?: number; excelCount?: number; lastSync?: string | null; lastTestSync?: string | null; error?: string; pageErrors?: { page: number; error: string }[] } | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; synced: number; errors: number } | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/medications/sync").then((r) => r.json()).then(setSyncResult);
  }, []);

  function stopSync() {
    syncAbortRef.current?.abort();
  }

  async function handleSync(testMode = false) {
    setSyncLoading(true); setSyncResult(null); setSyncProgress(null);
    const abort = new AbortController();
    syncAbortRef.current = abort;

    try {
      if (testMode) {
        const res = await fetch("/api/medications/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "test" }),
          signal: abort.signal,
        });
        const data = await res.json();
        setSyncResult(data);
        // 테스트 모드여도 마지막 전체동기화 시각 보존되도록 GET 한 번 더
        fetch("/api/medications/sync").then((r) => r.json()).then((d) => {
          setSyncResult((prev) => ({ ...(prev || {}), ...d, synced: data.synced }));
        });
        return;
      }

      // 전체 동기화: 청크 단위로 루프
      let nextPage: number | null = 1;
      let totalSynced = 0;
      const allErrors: { page: number; error: string }[] = [];
      let lastResp: { publicCount?: number; excelCount?: number; totalCount?: number; totalPages?: number } = {};

      while (nextPage !== null) {
        if (abort.signal.aborted) throw new Error("사용자가 중단했습니다.");

        const res: Response = await fetch("/api/medications/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startPage: nextPage, batchSize: 10 }),
          signal: abort.signal,
        });
        const data = await res.json();

        if (!res.ok || data.error) {
          throw new Error(`페이지 ${nextPage} 구간 오류: ${data.error || res.status}`);
        }

        totalSynced += data.synced || 0;
        if (Array.isArray(data.pageErrors)) allErrors.push(...data.pageErrors);
        lastResp = data;

        setSyncProgress({
          current: data.endPage || 0,
          total: data.totalPages || 0,
          synced: totalSynced,
          errors: allErrors.length,
        });

        nextPage = data.nextPage;
      }

      setSyncResult({
        success: true,
        synced: totalSynced,
        totalPublic: lastResp.totalCount,
        publicCount: lastResp.publicCount,
        excelCount: lastResp.excelCount,
        pageErrors: allErrors.length > 0 ? allErrors : undefined,
      });
      // 최종 카운트/lastSync 다시 불러오기
      fetch("/api/medications/sync").then((r) => r.json()).then((d) => {
        setSyncResult((prev) => ({ ...(prev || {}), ...d }));
      });
      // 동기화 완료 후 약가 자동 채우기
      handleFillPrices();
    } catch (e) {
      setSyncResult({ error: e instanceof Error ? e.message : "동기화 중 오류가 발생했어요." });
    } finally {
      setSyncLoading(false);
      syncAbortRef.current = null;
    }
  }

  async function handleUpload() {
    if (!file) return;
    setLoading(true); setResult(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("isSettlement", String(isSettlement));
    if (isSettlement) formData.append("settlementType", settlementType);
    try {
      const res = await fetch("/api/medications/upload", { method: "POST", body: formData });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        setFile(null);
        // 업로드 완료 후 약가 자동 채우기
        handleFillPrices();
      }
    } catch { setResult({ error: "업로드 중 오류가 발생했어요." }); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-5">
      {/* 공공데이터 동기화 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-blue-900">① 공공데이터 약품 DB 동기화</h2>
          <p className="text-xs text-blue-700 mt-0.5">건강보험심사평가원 전체 약품 목록을 내려받아 DB에 저장합니다. 요율표 업로드 전에 먼저 실행하세요.</p>
        </div>
        {syncResult && !syncResult.error && (
          <div className="text-xs text-blue-700 bg-white rounded p-2 border border-blue-200 space-y-0.5">
            <div>
              공공데이터: <strong>{(syncResult.publicCount ?? 0).toLocaleString()}건</strong> ·
              요율표: <strong>{(syncResult.excelCount ?? 0).toLocaleString()}건</strong> ·
              합계: <strong>{((syncResult.publicCount ?? 0) + (syncResult.excelCount ?? 0)).toLocaleString()}건</strong>
              {syncResult.synced ? <> · 이번 동기화: <strong>{syncResult.synced.toLocaleString()}건</strong></> : null}
            </div>
            <div className="text-blue-500">
              마지막 전체 동기화: <strong>{syncResult.lastSync ? new Date(syncResult.lastSync).toLocaleString("ko-KR") : "기록 없음"}</strong>
            </div>
            <div className="text-blue-400">
              마지막 테스트(100건) 동기화: <strong>{syncResult.lastTestSync ? new Date(syncResult.lastTestSync).toLocaleString("ko-KR") : "기록 없음"}</strong>
            </div>
          </div>
        )}
        {syncResult?.error && (
          <div className="text-xs text-red-700 bg-red-50 rounded p-2 border border-red-200">
            {syncResult.error}
          </div>
        )}
        {syncProgress && syncLoading && (
          <div className="bg-white rounded p-3 border border-blue-200 space-y-2">
            <div className="flex items-center justify-between text-xs text-blue-800">
              <span>진행률: {syncProgress.current}/{syncProgress.total} 페이지</span>
              <span>{syncProgress.synced.toLocaleString()}건 처리 {syncProgress.errors > 0 && <span className="text-red-600">· 실패 {syncProgress.errors}</span>}</span>
            </div>
            <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 transition-all"
                style={{ width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        {syncResult?.pageErrors && syncResult.pageErrors.length > 0 && (
          <details className="text-xs bg-yellow-50 border border-yellow-200 rounded p-2">
            <summary className="cursor-pointer text-yellow-800 font-medium">일부 페이지 실패: {syncResult.pageErrors.length}건 (클릭해서 상세보기)</summary>
            <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto">
              {syncResult.pageErrors.slice(0, 20).map((e, i) => (
                <li key={i} className="text-yellow-700 font-mono">페이지 {e.page}: {e.error}</li>
              ))}
              {syncResult.pageErrors.length > 20 && <li className="text-yellow-600">... 외 {syncResult.pageErrors.length - 20}건</li>}
            </ul>
          </details>
        )}
        <div className="flex gap-2">
          <Button onClick={() => handleSync(true)} disabled={syncLoading} variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-100">
            {syncLoading ? "동기화 중..." : "테스트 (100건)"}
          </Button>
          <Button onClick={() => handleSync(false)} disabled={syncLoading} className="bg-blue-600 hover:bg-blue-700">
            {syncLoading ? "동기화 중... (자동 진행)" : "전체 동기화 시작"}
          </Button>
          {syncLoading && (
            <Button onClick={stopSync} variant="outline" className="border-red-300 text-red-700 hover:bg-red-50">
              중단
            </Button>
          )}
        </div>
      </div>

      {/* 요율표 업로드 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-gray-800">② 요율표 엑셀 업로드</h2>
          <p className="text-xs text-gray-500 mt-0.5">급여코드(보험코드) 기준으로 공공데이터 레코드에 수수료율이 자동 연결됩니다. 공공데이터 sync 먼저 실행하세요.</p>
        </div>
        <div className="bg-gray-50 rounded p-3 text-xs text-gray-500 font-mono leading-relaxed space-y-1">
          <p><span className="text-blue-600 font-semibold">최소 필수:</span> 급여코드(또는 보험코드) | 수수료율(또는 코드)</p>
          <p><span className="text-gray-400">추가 선택:</span> 분류(A) | 성분명 | 분류(B) | 제약사명 | 생동/생산 | 품목명 | 약가 | 오리지날/대조약 | 특이사항</p>
        </div>
      <div
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${file ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { setFile(f); setResult(null); } }}
      >
        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-500">
          {file ? <span className="font-medium text-gray-800">{file.name}</span> : <>클릭하거나 <span className="text-blue-500">드래그</span>해서 업로드</>}
        </p>
        <p className="text-xs text-gray-400 mt-1">.xlsx, .xls 지원</p>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <input type="checkbox" id="settlement" checked={isSettlement}
              onChange={(e) => setIsSettlement(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
            <label htmlFor="settlement" className="text-sm text-gray-700">정산 가능 제약사 요율표로 등록</label>
          </div>
          {isSettlement && (
            <select
              value={settlementType}
              onChange={(e) => setSettlementType(e.target.value as "원외" | "원내")}
              className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium text-gray-700"
            >
              <option value="원외">원외</option>
              <option value="원내">원내</option>
            </select>
          )}
        </div>
        {isSettlement && (
          <p className="text-xs text-gray-400 pl-6">이 요율표의 약품들을 <strong className="text-gray-600">{settlementType}</strong> 정산 분류로 저장합니다</p>
        )}
      </div>
      <Button onClick={() => { if (!file) return; setConfirmOpen(true); }} disabled={!file || loading} className="w-full bg-gray-800 hover:bg-gray-700">
        {loading ? "업로드 중..." : "업로드"}
      </Button>

      {/* 업로드 확인 팝업 */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 text-base">업로드 전 최종 확인</h3>
                <p className="text-sm text-gray-500 mt-1">
                  파일: <span className="font-medium text-gray-700">{file?.name}</span>
                </p>
              </div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-5 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">정산 여부</span>
                <span className="font-semibold text-gray-800">{isSettlement ? "정산 가능 요율표" : "일반 요율표"}</span>
              </div>
              {isSettlement && (
                <div className="flex justify-between">
                  <span className="text-gray-500">정산 분류</span>
                  <span className={`font-bold text-base ${settlementType === "원외" ? "text-blue-700" : "text-green-700"}`}>
                    {settlementType}
                  </span>
                </div>
              )}
            </div>
            {isSettlement && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-4 text-xs text-yellow-800">
                <strong>{settlementType}</strong> 요율표로 업로드하시겠습니까? 잘못된 분류로 등록하면 정산 데이터가 오염됩니다.
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmOpen(false); handleUpload(); }}
                className="flex-1 py-2.5 rounded-lg bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold">
                확인, 업로드합니다
              </button>
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
        {result && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {result.success
              ? <><CheckCircle className="w-4 h-4 shrink-0" />총 {result.count?.toLocaleString()}건 — 공공데이터 머지: {result.updated}건 / 신규생성: {result.created}건{(result.skipped ?? 0) > 0 ? ` / 미매칭 스킵: ${result.skipped}건` : ""}</>
              : <><AlertCircle className="w-4 h-4 shrink-0" />{result.error}</>}
          </div>
        )}
      </div>

      {/* 중복 약품 정리 */}
      <div className="bg-white rounded-lg border border-orange-200 p-4 space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-orange-800">① -보완: 중복 약품 정리</h2>
            <p className="text-xs text-gray-500 mt-0.5">보험코드 없는 약품(수출용 등)이 sync 반복 시 중복 생성됩니다. 동일 제품명+제조사 기준으로 중복 제거합니다.</p>
          </div>
          {dedupStats && dedupStats.totalExtraRows !== undefined && (
            <button
              onClick={handleDedup}
              disabled={dedupLoading || dedupStats.totalExtraRows === 0}
              className="shrink-0 text-xs px-3 py-1.5 rounded border border-orange-300 text-orange-700 hover:bg-orange-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {dedupLoading ? "삭제 중..." : `중복 ${dedupStats.totalExtraRows.toLocaleString()}건 제거`}
            </button>
          )}
        </div>
        {dedupStats && dedupStats.totalDupeGroups !== undefined && dedupStats.totalDupeGroups > 0 && (
          <details className="text-xs text-orange-700">
            <summary className="cursor-pointer">▶ 중복 그룹 {dedupStats.totalDupeGroups}개 상세보기</summary>
            <div className="mt-1 space-y-0.5 font-mono text-[10px] bg-orange-50 rounded p-2">
              {dedupStats.samples?.map((s, i) => (
                <div key={i}>{s.productName} / {s.companyName} → {s.count}건</div>
              ))}
            </div>
          </details>
        )}
        {dedupStats?.totalExtraRows === 0 && <p className="text-xs text-green-600">중복 없음</p>}
        {dedupResult && (
          <div className={`text-xs rounded p-2 ${dedupResult.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
            {dedupResult.error ? dedupResult.error : `${dedupResult.deleted?.toLocaleString()}건 삭제 완료 · 남은 약품: ${dedupResult.totalAfter?.toLocaleString()}건`}
          </div>
        )}
      </div>

      {/* 주성분코드 매핑 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-800">③ 주성분코드(ATC) 동기화</h2>
          <p className="text-xs text-gray-500 mt-0.5">건강보험심사평가원 ATC코드 매핑 API에서 주성분코드를 가져와 보험코드 기준으로 자동 연결합니다.</p>
        </div>
        {mapResult && !mapResult.error && (mapResult.filled !== undefined || mapResult.lastSync !== undefined) && (
          <div className="text-xs text-purple-700 bg-purple-50 rounded p-2 border border-purple-200 space-y-0.5">
            {mapResult.filled !== undefined && (
              <div>주성분코드 보유: <strong>{mapResult.filled?.toLocaleString()}건</strong> / 전체 <strong>{mapResult.total?.toLocaleString()}건</strong></div>
            )}
            <div className="text-purple-500">
              마지막 동기화: <strong>{mapResult.lastSync ? new Date(mapResult.lastSync).toLocaleString("ko-KR") : "기록 없음"}</strong>
            </div>
          </div>
        )}
        {mapResult?.success && mapResult.mapped !== undefined && (
          <div className="text-xs text-green-700 bg-green-50 rounded p-2 border border-green-200 space-y-1">
            <div>
              <CheckCircle className="w-3.5 h-3.5 inline mr-1" />
              API 매핑: {mapResult.mapped?.toLocaleString()}건 · DB 업데이트: {mapResult.updated?.toLocaleString()}건
              {mapResult.ingredientAttempted !== undefined && ` · 성분명/규격 보유: ${mapResult.ingredientAttempted.toLocaleString()}건`}
              {mapResult.ingredientUpdated !== undefined && ` · 반영: ${mapResult.ingredientUpdated.toLocaleString()}건`}
            </div>
            {mapResult.diagnostics && (mapResult.ingredientUpdated ?? 0) === 0 && (
              <div className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 rounded p-1.5 font-mono break-all space-y-1">
                <div>추출 건수 — 성분명: {mapResult.diagnostics.withName ?? 0} · 규격: {mapResult.diagnostics.withSpec ?? 0} · 둘중하나: {mapResult.diagnostics.withEither ?? 0}</div>
                {mapResult.diagnostics.sampleKeys && mapResult.diagnostics.sampleKeys.length > 0 && (
                  <div>응답 필드: {mapResult.diagnostics.sampleKeys.join(", ")}</div>
                )}
                {mapResult.diagnostics.sampleItem && (
                  <details>
                    <summary className="cursor-pointer">API 샘플 아이템</summary>
                    <pre className="whitespace-pre-wrap mt-1">{JSON.stringify(mapResult.diagnostics.sampleItem, null, 2)}</pre>
                  </details>
                )}
                {mapResult.diagnostics.sampleRows && mapResult.diagnostics.sampleRows.length > 0 && (
                  <details>
                    <summary className="cursor-pointer">DB 업데이트된 샘플</summary>
                    <pre className="whitespace-pre-wrap mt-1">{mapResult.diagnostics.sampleRows.map((r) => `${r.insuranceCode}  ${r.productName}  /  ${r.ingredientName}`).join("\n")}</pre>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
        {mapResult?.error && (
          <div className="text-xs text-red-700 bg-red-50 rounded p-2 border border-red-200">
            <AlertCircle className="w-3.5 h-3.5 inline mr-1" />{mapResult.error}
            {mapResult.sampleKeys && <div className="mt-1 font-mono">응답 필드: {mapResult.sampleKeys.join(", ")}</div>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleIngredientSync} disabled={mapLoading} className="bg-purple-600 hover:bg-purple-700">
            {mapLoading ? "동기화 중..." : "API로 주성분코드 동기화"}
          </Button>
          <span className="text-xs text-gray-400 self-center">또는 수동 업로드:</span>
          <Button variant="outline" onClick={() => mapInputRef.current?.click()} disabled={mapLoading} className="border-purple-300 text-purple-700 hover:bg-purple-50">
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />{mapFile ? mapFile.name.slice(0, 20) + "…" : "엑셀 파일 선택"}
          </Button>
          {mapFile && (
            <Button variant="outline" onClick={handleMapUpload} disabled={mapLoading} className="border-purple-300 text-purple-700 hover:bg-purple-50">
              업로드
            </Button>
          )}
          <input ref={mapInputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { setMapFile(e.target.files?.[0] || null); setMapResult(null); }} />
        </div>
        {/* 공란 목록 다운로드 */}
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-700">주성분코드 공란 목록</span>
            {missingCodeCount !== null && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${missingCodeCount === 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {missingCodeCount.toLocaleString()}건 누락
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">동기화 후에도 매칭 안 된 품목 목록을 내려받아 수동 보정하거나 제약사에 코드 문의 시 사용하세요.</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleDownloadMissingCodes(true)}
              disabled={missingDownloading}
              className="text-xs border-red-200 text-red-600 hover:bg-red-50"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              보험코드 있는 것만 (sync 대상)
            </Button>
            <Button
              variant="outline"
              onClick={() => handleDownloadMissingCodes(false)}
              disabled={missingDownloading}
              className="text-xs border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              전체 공란 목록
            </Button>
          </div>
        </div>

        {/* ③-2: 주성분명 사전(hira_cmpn) 기반 보완 sync — 비급여 약품 커버리지 보완 */}
        <div className="border-t border-gray-100 pt-3 space-y-2 mt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-purple-700">③-2 보완: 주성분명 사전 매칭 (비급여 약품 커버)</span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            ③번 ATC 동기화는 <strong>보험코드 있는 급여약</strong>만 매칭돼요. 이 보완 sync는 HIRA 주성분명 사전 API
            (<code className="text-[10px] bg-gray-100 px-1 rounded">getMajorCmpnNmCdList</code>)에서 전체 주성분코드 사전을 받아와
            <strong>성분명 매칭으로 비급여·OTC 약품에도 코드를 채웁니다</strong>. 약학정보원/드럭인포 수준 커버리지를 목표로 해요.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleCmpnProbe}
              disabled={cmpnProbing || cmpnLoading}
              className="text-xs border-purple-200 text-purple-700 hover:bg-purple-50"
            >
              {cmpnProbing ? "확인 중..." : "① API 응답 구조 확인 (probe)"}
            </Button>
            <Button
              onClick={handleCmpnSync}
              disabled={cmpnLoading || cmpnProbing}
              className="bg-purple-600 hover:bg-purple-700 text-xs"
            >
              {cmpnLoading ? "동기화 중..." : "② 전체 동기화 실행"}
            </Button>
          </div>
          {cmpnResult && (
            <div className={`text-xs rounded p-3 border space-y-1 ${
              cmpnResult.error ? "bg-red-50 text-red-700 border-red-200"
              : "bg-green-50 text-green-700 border-green-200"
            }`}>
              {cmpnResult.error ? (
                <>
                  <div><AlertCircle className="w-3.5 h-3.5 inline mr-1" />{cmpnResult.error}</div>
                  {cmpnResult.sampleKeys && (
                    <div className="mt-1 font-mono text-[10px]">응답 필드: {cmpnResult.sampleKeys.join(", ")}</div>
                  )}
                </>
              ) : cmpnResult.probe ? (
                <>
                  <div><CheckCircle className="w-3.5 h-3.5 inline mr-1" />{cmpnResult.note}</div>
                  <div className="font-mono text-[10px]">응답 필드: {cmpnResult.sampleKeys?.join(", ") || "(없음)"}</div>
                  <details>
                    <summary className="cursor-pointer text-[10px] underline">▶ 실제 XML 응답 (구조 확인)</summary>
                    <pre className="text-[10px] bg-white rounded p-2 mt-1 overflow-auto max-h-48">{cmpnResult.rawXml}</pre>
                  </details>
                  <details>
                    <summary className="cursor-pointer text-[10px] underline">▶ 파싱된 JSON 구조</summary>
                    <pre className="text-[10px] bg-white rounded p-2 mt-1 overflow-auto max-h-48">{cmpnResult.parsedStructure}</pre>
                  </details>
                  <details>
                    <summary className="cursor-pointer text-[10px] underline">▶ 추출 샘플 ({cmpnResult.sampleItems?.length}건)</summary>
                    <pre className="text-[10px] bg-white rounded p-2 mt-1 overflow-auto max-h-48">{JSON.stringify(cmpnResult.sampleItems, null, 2)}</pre>
                  </details>
                </>
              ) : (
                <>
                  <div><CheckCircle className="w-3.5 h-3.5 inline mr-1" />
                    DB 사전: <strong>{cmpnResult.seededNames?.toLocaleString() ?? cmpnResult.uniqueNames?.toLocaleString()}</strong>개 성분명 ·
                    매칭 후보: <strong>{cmpnResult.candidates?.toLocaleString()}</strong>건
                  </div>
                  <div>
                    정확매칭 <strong>{cmpnResult.exactMatched?.toLocaleString()}</strong>,
                    포함매칭 <strong>{cmpnResult.containsMatched?.toLocaleString()}</strong>,
                    복수후보 <strong>{cmpnResult.multiCandidate?.toLocaleString()}</strong>
                  </div>
                  <div>
                    실제 코드 채움: <strong>{cmpnResult.updated?.toLocaleString()}</strong>건
                    {cmpnResult.finalState && (
                      <span className="ml-2">
                        → 커버리지 <strong>{cmpnResult.finalState.coverage}</strong>
                        ({cmpnResult.finalState.withCode.toLocaleString()} / {cmpnResult.finalState.totalDb.toLocaleString()})
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 공공데이터 약가 채우기 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-800">④ 공공데이터 약가 채우기</h2>
            <p className="text-xs text-gray-500 mt-0.5">① 동기화 · ② 요율표 업로드 완료 시 자동 실행됩니다. HIRA 급여약가 마스터 기준으로 보험코드가 일치하는 약품의 약가를 채웁니다.</p>
          </div>
          <button
            onClick={handleFillPrices}
            disabled={fillPriceLoading}
            className="shrink-0 text-xs text-emerald-700 hover:text-emerald-900 underline disabled:opacity-50 whitespace-nowrap mt-0.5"
          >
            {fillPriceLoading ? "실행 중..." : "지금 수동 실행"}
          </button>
        </div>
        {fillPriceStats && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded p-3 border border-gray-200 grid grid-cols-2 gap-x-6 gap-y-1">
            <div>전체 약품: <strong>{fillPriceStats.totalMeds?.toLocaleString() ?? "—"}건</strong></div>
            <div>약가 있음: <strong>{fillPriceStats.hasPriceMeds?.toLocaleString() ?? "—"}건</strong></div>
            <div>약가 없음: <strong className={fillPriceStats.nullPriceMeds ? "text-amber-600" : ""}>{fillPriceStats.nullPriceMeds?.toLocaleString() ?? "—"}건</strong></div>
            <div>요율표 약가: <strong>{fillPriceStats.excelWithPrice?.toLocaleString() ?? "—"}건</strong></div>
            <div>공공데이터 약가: <strong>{fillPriceStats.apiWithPrice?.toLocaleString() ?? "—"}건</strong></div>
          </div>
        )}
        {fillPriceResult && (
          <div className={`text-xs rounded p-3 border space-y-1 ${fillPriceResult.success ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
            {fillPriceResult.success ? (
              <>
                <div><CheckCircle className="w-3.5 h-3.5 inline mr-1" />약가 채움: <strong>{fillPriceResult.filled?.toLocaleString()}건</strong> / 스캔: {fillPriceResult.scanned?.toLocaleString()}건 ({fillPriceResult.pagesProcessed}페이지)</div>
                {(fillPriceResult.pageErrors ?? 0) > 0 && <div className="text-amber-600">페이지 오류: {fillPriceResult.pageErrors}건</div>}
                <div>남은 약가 없음: <strong>{fillPriceResult.nullPriceMeds?.toLocaleString()}건</strong></div>
              </>
            ) : (
              <div><AlertCircle className="w-3.5 h-3.5 inline mr-1" />{fillPriceResult.error}</div>
            )}
          </div>
        )}
        {fillPriceLoading && (
          <div className="text-xs text-emerald-600 animate-pulse">HIRA API에서 약가 데이터 수집 중...</div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={handleFillPricesDebug} className="text-xs text-gray-400 hover:text-gray-600 underline">
            API 응답 샘플 확인 (디버그)
          </button>
        </div>
        {fillPriceDebug && (
          <pre className="text-[10px] bg-gray-900 text-green-300 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">{fillPriceDebug}</pre>
        )}
      </div>

      {/* 약가 엑셀 직접 업로드 */}
      <div className="border border-gray-200 rounded-lg p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-gray-800">⑤ 약가 엑셀 직접 업로드</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            HIRA API 미연동 시 대안. <strong>보험코드</strong>·<strong>약가</strong> 컬럼이 있는 엑셀 업로드 시 매칭되는 약품 약가를 일괄 업데이트합니다.
            <br />HIRA 홈페이지(hira.or.kr) → 공개자료실 → 급여의약품 목록 다운로드 후 업로드하세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex-1 flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50 text-xs text-gray-500">
            <FileSpreadsheet className="w-4 h-4 text-gray-400 shrink-0" />
            {priceImportFile ? <span className="text-gray-800 font-medium truncate">{priceImportFile.name}</span> : "엑셀 파일 선택 (보험코드+약가)"}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => setPriceImportFile(e.target.files?.[0] ?? null)} />
          </label>
          <button onClick={handlePriceImport} disabled={!priceImportFile || priceImportLoading}
            className="shrink-0 px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5">
            {priceImportLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />처리 중...</> : <><Upload className="w-3.5 h-3.5" />약가 업로드</>}
          </button>
        </div>
        {priceImportResult && (
          <div className={`text-xs rounded p-3 border space-y-1 ${priceImportResult.success ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
            {priceImportResult.success ? (
              <>
                <div><CheckCircle className="w-3.5 h-3.5 inline mr-1" />파싱: <strong>{priceImportResult.parsed?.toLocaleString()}건</strong> → 업데이트: <strong>{priceImportResult.updated?.toLocaleString()}건</strong></div>
                <div>남은 약가 없음: <strong>{priceImportResult.nullPriceMeds?.toLocaleString()}건</strong></div>
              </>
            ) : (
              <div><AlertCircle className="w-3.5 h-3.5 inline mr-1" />{priceImportResult.error ?? priceImportResult.message}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
