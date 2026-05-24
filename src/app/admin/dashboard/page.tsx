"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { signOut } from "next-auth/react";
import { Upload, CheckCircle, AlertCircle, ShieldCheck, Users, Percent, Download, FileSpreadsheet, Filter, Database, ChevronDown, ChevronUp, Plus, RefreshCw, LogOut, Building2, Search, X, Mail, Phone, Send, Inbox, Copy, MessageCircle, Menu, Loader2, Network, ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import * as XLSX from "xlsx";

declare global {
  interface Window {
    Kakao: {
      isInitialized(): boolean;
      init(key: string): void;
      Share: {
        sendDefault(params: {
          objectType: string;
          text?: string;
          link: { webUrl: string; mobileWebUrl: string };
          buttonTitle?: string;
        }): void;
      };
    };
  }
}

type Tab = "upload" | "members" | "rates" | "filterReqs" | "userClients" | "bizManagement" | "corpRelation" | "apiSources" | "notices" | "companySubmissions" | "bulkSubmit" | "submissionTree" | "loginLogs" | "fileMigration" | "banners" | "boards";

interface MenuItem { key: Tab; label: string; icon: React.ElementType }
interface MenuGroup { title: string; items: MenuItem[] }

const MENU_GROUPS: MenuGroup[] = [
  {
    title: "데이터 관리",
    items: [
      { key: "upload", label: "요율표 업로드", icon: Upload },
      { key: "apiSources", label: "API 연동관리", icon: Database },
    ],
  },
  {
    title: "회원 & 거래처",
    items: [
      { key: "members", label: "회원관리", icon: Users },
      { key: "rates", label: "추가수수료 관리", icon: Percent },
      { key: "userClients", label: "담당자별 거래처", icon: Building2 },
      { key: "bizManagement", label: "사업자관리", icon: Building2 },
      { key: "corpRelation", label: "상위 하위법인 지정", icon: Building2 },
    ],
  },
  {
    title: "필터링 요청",
    items: [
      { key: "filterReqs", label: "요청 내역", icon: Filter },
      { key: "bulkSubmit", label: "제약사별 일괄제출", icon: Send },
      { key: "companySubmissions", label: "제출처 관리", icon: Inbox },
      { key: "submissionTree", label: "제출 트리", icon: Network },
    ],
  },
  {
    title: "콘텐츠",
    items: [
      { key: "notices", label: "공지사항 관리", icon: FileSpreadsheet },
      { key: "banners", label: "메인 배너", icon: Upload },
      { key: "boards", label: "게시판 관리", icon: MessageCircle },
    ],
  },
  {
    title: "보안",
    items: [
      { key: "loginLogs", label: "로그인 기록", icon: ShieldCheck },
    ],
  },
  {
    title: "시스템",
    items: [
      { key: "fileMigration", label: "파일 스토리지 이전", icon: Database },
    ],
  },
];

interface UserDoc { id: string; docType: string; fileName: string; fileData?: string; }
interface User {
  id: string; email: string; name: string | null;
  role: string; approved: boolean; isBusinessApproved?: boolean; createdAt: string;
  phone?: string | null; carrier?: string | null;
  documents?: UserDoc[];
  userClients?: { id: string; clientName: string; bizNumber: string; address: string | null; bizFileName: string | null; bizFileKey: string | null }[];
}

const roleLabel: Record<string, string> = {
  ADMIN: "관리자", BUSINESS: "사업자", BIZ: "비즈회원", BASIC: "일반회원", DOCTOR: "의사", PHARMACIST: "약사",
};
const roleColor: Record<string, string> = {
  BASIC: "bg-gray-100 text-gray-600",
  BUSINESS: "bg-blue-100 text-blue-700",
  BIZ: "bg-purple-100 text-purple-700",
  ADMIN: "bg-red-100 text-red-700",
  DOCTOR: "bg-green-100 text-green-700",
  PHARMACIST: "bg-teal-100 text-teal-700",
};

export default function AdminDashboardPage() {
  const [tab, setTab] = useState<Tab>("upload");
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleLogout() {
    signOut({ callbackUrl: "/login" });
  }

  return (
    <>
      <button
        type="button"
        aria-label="메뉴 토글"
        onClick={() => setMobileOpen((v) => !v)}
        className="md:hidden fixed top-3 left-3 z-40 p-2 bg-white border border-gray-200 rounded-md shadow-sm"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-20"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
    <div className="flex gap-6 max-w-7xl mx-auto">
      <aside
        className={`w-56 shrink-0 space-y-6 bg-white p-4 overflow-y-auto fixed inset-y-0 left-0 z-30 transition-transform ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:relative md:inset-auto md:translate-x-0 md:bg-transparent md:p-0 md:overflow-visible md:sticky md:top-4 md:self-start md:z-auto md:transition-none`}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-gray-800" />
          <div>
            <h1 className="text-base font-bold text-gray-900 leading-tight">관리자</h1>
            <p className="text-[11px] text-gray-400">데이터 · 회원 관리</p>
          </div>
        </div>

        <nav className="space-y-5">
          {MENU_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-[10px] font-semibold tracking-wider text-gray-400 uppercase px-2 mb-1.5">{group.title}</div>
              <div className="space-y-0.5">
                {group.items.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => { setTab(key); setMobileOpen(false); }}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors text-left ${
                      tab === key
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${tab === key ? "text-blue-600" : "text-gray-400"}`} />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded-md px-2.5 py-2 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>

        <SyncSheetsButton />
      </aside>

      <main className="flex-1 min-w-0 space-y-4">
        {tab === "upload" && <UploadTab />}
        {tab === "notices" && <NoticesTab />}
        {tab === "members" && <MembersTab />}
        {tab === "rates" && <RatesTab />}
        {tab === "filterReqs" && <FilterReqsTab />}
        {tab === "bulkSubmit" && <BulkSubmissionTab />}
        {tab === "companySubmissions" && <CompanySubmissionsTab />}
        {tab === "submissionTree" && <SubmissionTreeTab />}
        {tab === "userClients" && <UserClientsTab />}
        {tab === "bizManagement" && <BizManagementTab />}
        {tab === "corpRelation" && <CorpRelationTab />}
        {tab === "apiSources" && <ApiSourcesTab />}
        {tab === "loginLogs" && <LoginLogsTab />}
        {tab === "fileMigration" && <FileMigrationTab />}
        {tab === "banners" && <BannersTab />}
        {tab === "boards" && <BoardsTab />}
      </main>
    </div>
    </>
  );
}

function UploadTab() {
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

// ─────────────────────────────────────────────
// 제출처 일괄 업로드 탭
// ─────────────────────────────────────────────

interface SubUploadRow {
  companyName: string;
  submissionEntity: string;
  contactName: string;
  email: string;
  phone: string;
  fax: string;
  defaultAdditionalRate: string;
  notes: string;
  _error?: string;
}

const EXPECTED_COLUMNS: Record<string, keyof SubUploadRow> = {
  "제약사명": "companyName",
  "제출처법인명": "submissionEntity",
  "담당자": "contactName",
  "담당자명": "contactName",
  "이메일": "email",
  "전화번호": "phone",
  "전화": "phone",
  "팩스": "fax",
  "추가수수료": "defaultAdditionalRate",
  "추가수수료율": "defaultAdditionalRate",
  "비고": "notes",
};

function validateRow(row: SubUploadRow): string | undefined {
  if (!row.companyName) return "제약사명 없음";
  if (row.defaultAdditionalRate && isNaN(Number(row.defaultAdditionalRate))) return `추가수수료 숫자 아님: ${row.defaultAdditionalRate}`;
  return undefined;
}

function SubmissionUploadTab({ onSaved }: { onSaved?: () => void } = {}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SubUploadRow[]>([]);
  const [savedSet, setSavedSet] = useState<Set<number>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState("");
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Tabs & current-status state
  const [activeTab, setActiveTab] = useState<"upload" | "current">("upload");
  const [currentRows, setCurrentRows] = useState<SubUploadRow[]>([]);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentQuery, setCurrentQuery] = useState("");
  const [currentSavedSet, setCurrentSavedSet] = useState<Set<string>>(new Set());
  const [currentSavingName, setCurrentSavingName] = useState<string | null>(null);

  useEffect(() => { loadCurrentRows(); }, []);

  async function loadCurrentRows() {
    setCurrentLoading(true);
    try {
      const res = await fetch("/api/admin/company-submissions");
      const data = await res.json();
      if (Array.isArray(data)) {
        setCurrentRows(data.map((r: CompanySubmission) => ({
          companyName: r.companyName || "",
          submissionEntity: r.submissionEntity || "",
          contactName: r.contactName || "",
          email: r.email || "",
          phone: r.phone || "",
          fax: r.fax || "",
          defaultAdditionalRate: r.defaultAdditionalRate != null ? String(r.defaultAdditionalRate) : "",
          notes: r.notes || "",
        })));
      }
    } catch {}
    setCurrentLoading(false);
  }

  function updateCurrentField(companyName: string, field: keyof SubUploadRow, value: string) {
    setCurrentRows((prev) => prev.map((r) => {
      if (r.companyName !== companyName) return r;
      const updated = { ...r, [field]: value } as SubUploadRow;
      updated._error = validateRow(updated);
      return updated;
    }));
    setCurrentSavedSet((prev) => { const n = new Set(prev); n.delete(companyName); return n; });
  }

  async function saveCurrentRow(row: SubUploadRow) {
    if (row._error || !row.companyName) return;
    setCurrentSavingName(row.companyName);
    try {
      const res = await fetch("/api/admin/company-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: row.companyName,
          submissionEntity: row.submissionEntity || null,
          contactName: row.contactName || null,
          email: row.email || null,
          phone: row.phone || null,
          fax: row.fax || null,
          defaultAdditionalRate: row.defaultAdditionalRate !== "" ? Number(row.defaultAdditionalRate) : null,
          notes: row.notes || null,
        }),
      });
      if (res.ok) { setCurrentSavedSet((prev) => new Set([...prev, row.companyName])); onSaved?.(); }
      else { const d = await res.json().catch(() => ({})); alert(`저장 실패: ${d.error || "오류"}`); }
    } finally { setCurrentSavingName(null); }
  }

  async function deleteCurrentRow(companyName: string) {
    if (!confirm(`"${companyName}" 제출처 정보를 삭제할까요?`)) return;
    const res = await fetch("/api/admin/company-submissions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName }),
    });
    if (res.ok) { setCurrentRows((prev) => prev.filter((r) => r.companyName !== companyName)); onSaved?.(); }
    else alert("삭제 실패");
  }

  function parseFile(f: File) {
    setFile(f);
    setResult(null);
    setParseError(null);
    setSavedSet(new Set());
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        if (raw.length === 0) { setParseError("시트에 데이터가 없어요."); return; }

        const rows: SubUploadRow[] = raw.map((r) => {
          const row: SubUploadRow = { companyName: "", submissionEntity: "", contactName: "", email: "", phone: "", fax: "", defaultAdditionalRate: "", notes: "" };
          for (const [colKey, val] of Object.entries(r)) {
            const field = EXPECTED_COLUMNS[colKey.trim()];
            if (field) row[field] = String(val ?? "").trim();
          }
          row._error = validateRow(row);
          return row;
        });

        setPreview(rows);
      } catch {
        setParseError("파일을 읽는 중 오류가 발생했어요. xlsx/xls 파일인지 확인해 주세요.");
      }
    };
    reader.readAsBinaryString(f);
  }

  function updateField(idx: number, field: keyof SubUploadRow, value: string) {
    setPreview((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: value } as SubUploadRow;
      updated._error = validateRow(updated);
      return updated;
    }));
    setSavedSet((prev) => {
      if (!prev.has(idx)) return prev;
      const n = new Set(prev);
      n.delete(idx);
      return n;
    });
  }

  function deleteRow(idx: number) {
    setPreview((prev) => prev.filter((_, i) => i !== idx));
    setSavedSet((prev) => {
      const n = new Set<number>();
      for (const id of prev) {
        if (id < idx) n.add(id);
        else if (id > idx) n.add(id - 1);
      }
      return n;
    });
  }

  function addBlankRow() {
    setPreview((prev) => [...prev, { companyName: "", submissionEntity: "", contactName: "", email: "", phone: "", fax: "", defaultAdditionalRate: "", notes: "", _error: "제약사명 없음" }]);
  }

  async function saveOne(idx: number) {
    const row = preview[idx];
    if (row._error || !row.companyName) return;
    setSavingIdx(idx);
    try {
      const res = await fetch("/api/admin/company-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: row.companyName,
          submissionEntity: row.submissionEntity || null,
          contactName: row.contactName || null,
          email: row.email || null,
          phone: row.phone || null,
          fax: row.fax || null,
          defaultAdditionalRate: row.defaultAdditionalRate !== "" ? Number(row.defaultAdditionalRate) : null,
          notes: row.notes || null,
        }),
      });
      if (res.ok) {
        setSavedSet((prev) => new Set([...prev, idx]));
        onSaved?.();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(`저장 실패: ${data.error || "알 수 없는 오류"}`);
      }
    } finally {
      setSavingIdx(null);
    }
  }

  async function saveAll() {
    const toSave = preview.map((r, i) => ({ r, i })).filter(({ r, i }) => !r._error && r.companyName && !savedSet.has(i));
    if (toSave.length === 0) return;
    setBatchSaving(true);
    setResult(null);
    const payload = toSave.map(({ r }) => ({
      companyName: r.companyName,
      submissionEntity: r.submissionEntity || null,
      contactName: r.contactName || null,
      email: r.email || null,
      phone: r.phone || null,
      fax: r.fax || null,
      defaultAdditionalRate: r.defaultAdditionalRate !== "" ? Number(r.defaultAdditionalRate) : null,
      notes: r.notes || null,
    }));
    const res = await fetch("/api/admin/company-submissions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setResult(data);
    if (res.ok) {
      setSavedSet((prev) => {
        const n = new Set(prev);
        toSave.forEach(({ i }) => n.add(i));
        return n;
      });
      onSaved?.();
    }
    setBatchSaving(false);
  }

  async function downloadTemplate() {
    let templateData: Record<string, string>[];
    try {
      const res = await fetch("/api/admin/company-submissions");
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        templateData = (data as CompanySubmission[]).map((r) => ({
          제약사명: r.companyName || "",
          제출처법인명: r.submissionEntity || "",
          담당자: r.contactName || "",
          이메일: r.email || "",
          전화번호: r.phone || "",
          팩스: r.fax || "",
          추가수수료: r.defaultAdditionalRate != null ? String(r.defaultAdditionalRate) : "",
          비고: r.notes || "",
        }));
      } else {
        templateData = [
          { 제약사명: "동아ST", 제출처법인명: "동아쏘시오홀딩스", 담당자: "홍길동", 이메일: "contact@donga.com", 전화번호: "02-1234-5678", 팩스: "02-1234-5679", 추가수수료: "2.5", 비고: "" },
          { 제약사명: "한미약품", 제출처법인명: "", 담당자: "", 이메일: "", 전화번호: "", 팩스: "", 추가수수료: "", 비고: "" },
        ];
      }
    } catch {
      templateData = [
        { 제약사명: "동아ST", 제출처법인명: "동아쏘시오홀딩스", 담당자: "홍길동", 이메일: "contact@donga.com", 전화번호: "02-1234-5678", 팩스: "02-1234-5679", 추가수수료: "2.5", 비고: "" },
      ];
    }
    const ws = XLSX.utils.json_to_sheet(templateData);
    ws["!cols"] = [{ wch: 16 }, { wch: 18 }, { wch: 10 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "제출처");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "제출처업로드_양식.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  const errorRows = preview.filter((r) => r._error);
  const validCount = preview.length - errorRows.length;
  const savedCount = savedSet.size;

  const previewFiltered = previewQuery.trim()
    ? preview.map((r, i) => ({ r, i })).filter(({ r }) => {
        const q = previewQuery.toLowerCase();
        return r.companyName.toLowerCase().includes(q) ||
          r.submissionEntity.toLowerCase().includes(q) ||
          r.contactName.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q);
      })
    : preview.map((r, i) => ({ r, i }));

  const currentFiltered = currentQuery.trim()
    ? currentRows.filter((r) => {
        const q = currentQuery.toLowerCase();
        return r.companyName.toLowerCase().includes(q) ||
          (r.submissionEntity || "").toLowerCase().includes(q) ||
          (r.contactName || "").toLowerCase().includes(q) ||
          (r.email || "").toLowerCase().includes(q);
      })
    : currentRows;

  const inputCls = "w-full bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:bg-white rounded px-1.5 py-1 text-xs focus:outline-none transition-colors";

  const tableHead = (
    <thead className="sticky top-0 bg-gray-50 z-10">
      <tr className="text-gray-500 font-semibold">
        <th className="px-2 py-2.5 text-left w-8">#</th>
        <th className="px-2 py-2.5 text-left w-[160px]">제약사명 *</th>
        <th className="px-2 py-2.5 text-left w-[160px]">제출처법인명</th>
        <th className="px-2 py-2.5 text-left w-[100px]">담당자</th>
        <th className="px-2 py-2.5 text-left w-[180px]">이메일</th>
        <th className="px-2 py-2.5 text-left w-[120px]">전화</th>
        <th className="px-2 py-2.5 text-left w-[120px]">팩스</th>
        <th className="px-2 py-2.5 text-right w-[80px]">수수료%</th>
        <th className="px-2 py-2.5 text-left">비고</th>
        <th className="px-2 py-2.5 text-center w-[90px]">저장</th>
        <th className="px-2 py-2.5 text-center w-[40px]"></th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-3">
      {/* Compact header: title + upload button + template download */}
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">제출처 일괄 업로드</h2>
            <p className="text-xs text-gray-400 mt-0.5">엑셀로 업로드한 내용은 미리보기 탭에서 수정·저장할 수 있어요.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 rounded px-3 py-1.5 transition-colors">
              <Download className="w-3.5 h-3.5" />양식 내려받기
            </button>
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs border border-gray-200 hover:border-blue-300 hover:bg-blue-50 rounded px-3 py-1.5 text-gray-600 hover:text-blue-600 transition-colors">
              <Upload className="w-3.5 h-3.5" />
              {file ? <span className="font-medium text-blue-700 max-w-[140px] truncate">{file.name}</span> : "엑셀 선택 (.xlsx / .xls)"}
              <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { parseFile(f); setActiveTab("upload"); } e.target.value = ""; }} />
            </label>
            {file && (
              <button type="button"
                onClick={() => { setFile(null); setPreview([]); setResult(null); setSavedSet(new Set()); }}
                className="text-xs text-red-400 hover:text-red-600 transition-colors">× 제거</button>
            )}
          </div>
        </div>
        {parseError && <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2">{parseError}</p>}
        {file && !parseError && (
          <p className="mt-1.5 text-xs text-gray-400">{preview.length}행 · 유효 {validCount}{errorRows.length > 0 ? ` · 오류 ${errorRows.length}` : ""} · 저장됨 {savedCount}</p>
        )}
      </div>

      {/* Tabbed area */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Tab bar */}
        <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-0.5">
            <button type="button" onClick={() => setActiveTab("upload")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === "upload" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
              업로드 미리보기 <span className={activeTab === "upload" ? "opacity-70" : "text-gray-400"}>({preview.length}행)</span>
            </button>
            <button type="button" onClick={() => { setActiveTab("current"); loadCurrentRows(); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === "current" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
              현재 현황 <span className={activeTab === "current" ? "opacity-70" : "text-gray-400"}>({currentRows.length}개)</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                value={activeTab === "upload" ? previewQuery : currentQuery}
                onChange={(e) => activeTab === "upload" ? setPreviewQuery(e.target.value) : setCurrentQuery(e.target.value)}
                placeholder="검색"
                className="h-8 w-44 border border-gray-200 rounded pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            {activeTab === "upload" ? (
              <>
                <button onClick={addBlankRow}
                  className="text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 rounded px-2 py-1.5 flex items-center gap-1">
                  <Plus className="w-3 h-3" />행 추가
                </button>
                <button onClick={saveAll} disabled={batchSaving || validCount === 0 || validCount === savedCount}
                  className="h-8 px-3 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 flex items-center gap-1.5">
                  {batchSaving ? <><RefreshCw className="w-3 h-3 animate-spin" />업로드 중...</> : <><Upload className="w-3 h-3" />{Math.max(0, validCount - savedCount)}행 일괄 저장</>}
                </button>
              </>
            ) : (
              <button onClick={loadCurrentRows} disabled={currentLoading}
                className="text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 rounded px-2 py-1.5 flex items-center gap-1 disabled:opacity-50">
                <RefreshCw className={`w-3 h-3 ${currentLoading ? "animate-spin" : ""}`} />새로고침
              </button>
            )}
          </div>
        </div>

        {/* Upload preview tab */}
        {activeTab === "upload" && (
          preview.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">
              위에서 엑셀을 선택하면 이 곳에 표시됩니다. 행마다 바로 수정하고 저장할 수 있어요.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-xs min-w-[1180px]">
                {tableHead}
                <tbody className="divide-y divide-gray-100">
                  {previewFiltered.map(({ r: row, i }) => {
                    const isSaved = savedSet.has(i);
                    const hasError = !!row._error;
                    const isSaving = savingIdx === i;
                    return (
                      <tr key={i} className={hasError ? "bg-red-50/60" : isSaved ? "bg-emerald-50/40" : "hover:bg-gray-50"}>
                        <td className="px-2 py-1 text-gray-400 align-middle">{i + 1}</td>
                        <td className="px-1 py-1 align-middle">
                          <input value={row.companyName} onChange={(e) => updateField(i, "companyName", e.target.value)} className={`${inputCls} font-medium text-gray-900`} placeholder="필수" />
                          {hasError && <div className="text-[10px] text-red-500 px-1.5">{row._error}</div>}
                        </td>
                        <td className="px-1 py-1 align-middle"><input value={row.submissionEntity} onChange={(e) => updateField(i, "submissionEntity", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.contactName} onChange={(e) => updateField(i, "contactName", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input type="email" value={row.email} onChange={(e) => updateField(i, "email", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.phone} onChange={(e) => updateField(i, "phone", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.fax} onChange={(e) => updateField(i, "fax", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.defaultAdditionalRate} onChange={(e) => updateField(i, "defaultAdditionalRate", e.target.value)} className={`${inputCls} text-right font-mono`} placeholder="0" /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.notes} onChange={(e) => updateField(i, "notes", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button onClick={() => saveOne(i)} disabled={hasError || isSaving}
                            className={`text-[11px] px-2 py-1 rounded font-medium ${isSaved ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"}`}>
                            {isSaving ? "..." : isSaved ? "저장됨 ↻" : "저장"}
                          </button>
                        </td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button onClick={() => deleteRow(i)} className="text-gray-300 hover:text-red-500" title="행 제거"><X className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {previewFiltered.length === 0 && previewQuery && (
                    <tr><td colSpan={11} className="py-10 text-center text-gray-400 text-sm">검색 결과가 없어요.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Current status tab */}
        {activeTab === "current" && (
          currentLoading ? (
            <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : currentRows.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">등록된 제출처가 없어요.</div>
          ) : (
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-xs min-w-[1180px]">
                {tableHead}
                <tbody className="divide-y divide-gray-100">
                  {currentFiltered.map((row, idx) => {
                    const isSaved = currentSavedSet.has(row.companyName);
                    const hasError = !!row._error;
                    const isSaving = currentSavingName === row.companyName;
                    return (
                      <tr
                        key={row.companyName}
                        className={hasError ? "bg-red-50/60" : isSaved ? "bg-emerald-50/40" : "hover:bg-gray-50"}
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !hasError && !isSaving) {
                            saveCurrentRow(row);
                          }
                        }}
                      >
                        <td className="px-2 py-1 text-gray-400 align-middle">{idx + 1}</td>
                        <td className="px-1 py-1 align-middle">
                          <span className="px-1.5 py-1 text-xs font-medium text-gray-900">{row.companyName}</span>
                        </td>
                        <td className="px-1 py-1 align-middle"><input value={row.submissionEntity} onChange={(e) => updateCurrentField(row.companyName, "submissionEntity", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.contactName} onChange={(e) => updateCurrentField(row.companyName, "contactName", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input type="email" value={row.email} onChange={(e) => updateCurrentField(row.companyName, "email", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.phone} onChange={(e) => updateCurrentField(row.companyName, "phone", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.fax} onChange={(e) => updateCurrentField(row.companyName, "fax", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.defaultAdditionalRate} onChange={(e) => updateCurrentField(row.companyName, "defaultAdditionalRate", e.target.value)} className={`${inputCls} text-right font-mono`} placeholder="0" /></td>
                        <td className="px-1 py-1 align-middle"><input value={row.notes} onChange={(e) => updateCurrentField(row.companyName, "notes", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button onClick={() => saveCurrentRow(row)} disabled={hasError || isSaving}
                            className={`text-[11px] px-2 py-1 rounded font-medium ${isSaved ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"}`}>
                            {isSaving ? "..." : isSaved ? "저장됨 ↻" : "저장"}
                          </button>
                        </td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button onClick={() => deleteCurrentRow(row.companyName)} className="text-gray-300 hover:text-red-500" title="삭제"><X className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {currentFiltered.length === 0 && currentQuery && (
                    <tr><td colSpan={11} className="py-10 text-center text-gray-400 text-sm">검색 결과가 없어요.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {result && (
        <div className={`rounded-lg border p-4 ${result.errors.length > 0 ? "bg-yellow-50 border-yellow-200" : "bg-green-50 border-green-200"}`}>
          <div className="flex items-center gap-2 mb-2">
            {result.errors.length > 0
              ? <AlertCircle className="w-4 h-4 text-yellow-600" />
              : <CheckCircle className="w-4 h-4 text-green-600" />}
            <span className="text-sm font-medium text-gray-800">
              신규 등록 {result.created}건 · 수정 {result.updated}건
              {result.errors.length > 0 ? ` · 오류 ${result.errors.length}건` : " 완료"}
            </span>
          </div>
          {result.errors.length > 0 && (
            <ul className="text-xs text-red-700 space-y-0.5 ml-6 list-disc max-h-40 overflow-y-auto">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MembersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [docUser, setDocUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [bulkApproving, setBulkApproving] = useState(false);

  useEffect(() => {
    const delay = searchQuery ? 300 : 0;
    const t = setTimeout(() => fetchUsers(searchQuery), delay);
    return () => clearTimeout(t);
  }, [searchQuery]);

  async function fetchUsers(q: string) {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/admin/users?${params}`);
    const data = await res.json();
    const list: User[] = Array.isArray(data) ? data : (data.users ?? []);
    setUsers(list);
    setTotal(Array.isArray(data) ? list.length : (data.total ?? list.length));
    setLoading(false);
  }

  async function bulkApprove() {
    const pendingCount = users.filter((u) => !u.approved).length;
    if (pendingCount === 0) return;
    if (!confirm(`미승인 회원 ${pendingCount}명을 모두 승인할까요?`)) return;
    setBulkApproving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulkApprove" }),
      });
      if (res.ok) await fetchUsers(searchQuery);
    } finally {
      setBulkApproving(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, role }) });
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role } : u));
  }

  async function toggleApproval(userId: string, approved: boolean) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, approved }) });
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, approved } : u));
  }

  async function toggleBusinessApproval(userId: string, isBusinessApproved: boolean) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, isBusinessApproved }) });
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isBusinessApproved } : u));
  }

  async function resetPassword() {
    if (!newPw || newPw.length < 4) return alert("4자 이상 입력해주세요.");
    setPwLoading(true);
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: resetUserId, newPassword: newPw }) });
    setPwLoading(false);
    setResetUserId(null);
    setNewPw("");
    alert("비밀번호가 초기화됐어요.");
  }

  async function downloadDoc(doc: UserDoc) {
    let data = doc.fileData;
    if (!data) {
      const res = await fetch(`/api/admin/users/document/${doc.id}`);
      if (!res.ok) { alert("문서를 불러오지 못했어요."); return; }
      const full = await res.json();
      data = full.fileData;
    }
    if (!data) return;
    const a = document.createElement("a");
    a.href = data;
    a.download = doc.fileName;
    a.click();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">
                회원 목록 {total > 0 && <span className="text-base font-normal text-gray-500">({total}명)</span>}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">가입 승인 후 서비스를 이용할 수 있어요.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="이름·이메일·연락처 검색"
                  className="h-8 pl-7 pr-7 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 w-52"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {users.filter((u) => !u.approved).length > 0 && (
                <button
                  onClick={bulkApprove}
                  disabled={bulkApproving}
                  className="h-8 px-3 text-xs font-medium rounded-md bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                >
                  {bulkApproving
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <CheckCircle className="w-3.5 h-3.5" />}
                  일괄 승인 ({users.filter((u) => !u.approved).length}명)
                </button>
              )}
            </div>
          </div>
        </div>
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중...
          </div>
        ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
              <th className="px-4 py-3 text-left">이름</th>
              <th className="px-4 py-3 text-left">이메일</th>
              <th className="px-4 py-3 text-left">연락처</th>
              <th className="px-4 py-3 text-center">직업</th>
              <th className="px-4 py-3 text-center">가입일</th>
              <th className="px-4 py-3 text-center">상태</th>
              <th className="px-4 py-3 text-center">서류</th>
              <th className="px-4 py-3 text-center">승인</th>
              <th className="px-4 py-3 text-center">비밀번호</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900 cursor-pointer hover:text-blue-600"
                  title="클릭해서 이름 수정"
                  onClick={() => {
                    const newName = prompt("이름 수정:", user.name || "");
                    if (newName === null) return;
                    fetch("/api/admin/users", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ userId: user.id, name: newName.trim() }),
                    }).then(async (r) => {
                      if (r.ok) setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, name: newName.trim() } : u));
                      else alert("수정 실패");
                    });
                  }}>{user.name || "-"}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{user.email}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  <div>{user.carrier || "-"}</div>
                  <div>{user.phone || "-"}</div>
                </td>
                <td className="px-4 py-3 text-center">
                  <select
                    value={user.role}
                    onChange={(e) => changeRole(user.id, e.target.value)}
                    className={`text-xs font-medium rounded px-2 py-1 border-0 cursor-pointer ${roleColor[user.role] || "bg-gray-100 text-gray-600"}`}
                  >
                    <option value="BASIC">일반회원</option>
                    <option value="BUSINESS">사업자</option>
                    <option value="BIZ">비즈회원</option>
                    <option value="ADMIN">관리자</option>
                    <option value="DOCTOR">의사</option>
                    <option value="PHARMACIST">약사</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-center text-gray-400 text-xs">{new Date(user.createdAt).toLocaleDateString("ko-KR")}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Badge variant={user.approved ? "success" : "warning"}>{user.approved ? "가입 승인" : "가입 대기"}</Badge>
                    {user.isBusinessApproved
                      ? <Badge variant="success">사업자 인증</Badge>
                      : (user.userClients && user.userClients.length > 0
                          ? <Badge variant="warning">사업자 대기</Badge>
                          : <span className="text-[10px] text-gray-400">사업자 정보 없음</span>)}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-1">
                    {user.documents && user.documents.length > 0 ? (
                      <button onClick={() => setDocUser(user)} className="text-xs text-blue-600 hover:underline">
                        가입서류 ({user.documents.length})
                      </button>
                    ) : <span className="text-xs text-gray-300">없음</span>}
                    {user.userClients && user.userClients[0] && (
                      <div className="text-[10px] text-gray-500 text-center space-y-0.5">
                        <div className="cursor-pointer hover:text-blue-600" title="클릭해서 수정"
                          onClick={() => {
                            const newName = prompt("상호명 수정:", user.userClients![0].clientName);
                            if (newName === null) return;
                            const newBiz = prompt("사업자번호 수정:", user.userClients![0].bizNumber);
                            if (newBiz === null) return;
                            fetch("/api/admin/users", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ userId: user.id, bizUpdate: { clientName: newName, bizNumber: newBiz } }),
                            }).then(async (r) => {
                              if (r.ok) {
                                const d = await r.json();
                                setUsers((prev) => prev.map((u) =>
                                  u.id === user.id && u.userClients?.[0]
                                    ? { ...u, userClients: [{ ...u.userClients[0], clientName: d.clientName ?? newName, bizNumber: d.bizNumber ?? newBiz }] }
                                    : u
                                ));
                              } else {
                                const d = await r.json().catch(() => ({}));
                                alert(d.error || "수정 실패");
                              }
                            });
                          }}>
                          {user.userClients[0].clientName}
                        </div>
                        <div className="font-mono">{user.userClients[0].bizNumber}</div>
                        {user.userClients[0].bizFileName && (
                          <a href={`/api/files/user-client-biz/${user.userClients[0].id}`} target="_blank" rel="noreferrer"
                            className="text-blue-600 hover:underline">사업자등록증</a>
                        )}
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <button onClick={() => toggleApproval(user.id, !user.approved)}
                      className={`text-xs px-2.5 py-1 rounded font-medium transition-colors w-full ${user.approved ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>
                      가입 {user.approved ? "취소" : "승인"}
                    </button>
                    {user.userClients && user.userClients.length > 0 && (
                      <button onClick={() => toggleBusinessApproval(user.id, !user.isBusinessApproved)}
                        className={`text-xs px-2.5 py-1 rounded font-medium transition-colors w-full ${user.isBusinessApproved ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                        사업자 {user.isBusinessApproved ? "취소" : "승인"}
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => { setResetUserId(user.id); setNewPw(""); }}
                    className="text-xs px-2.5 py-1.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">
                    초기화
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-gray-400 text-sm">
                  {searchQuery ? `"${searchQuery}" 검색 결과가 없어요.` : "가입 회원이 없어요."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        )}
      </div>

      {/* 비밀번호 초기화 모달 */}
      {resetUserId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-80 space-y-4 shadow-xl">
            <h3 className="font-semibold text-gray-900">임시 비밀번호 설정</h3>
            <input value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="새 비밀번호 입력"
              className="w-full h-10 border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="flex gap-2">
              <button onClick={() => setResetUserId(null)} className="flex-1 h-10 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">취소</button>
              <button onClick={resetPassword} disabled={pwLoading} className="flex-1 h-10 rounded-md bg-gray-800 text-white text-sm hover:bg-gray-700">
                {pwLoading ? "처리 중..." : "변경"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 첨부서류 모달 */}
      {docUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 space-y-4 shadow-xl">
            <h3 className="font-semibold text-gray-900">{docUser.name} 첨부서류</h3>
            {docUser.documents?.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-800">{doc.docType}</p>
                  <p className="text-xs text-gray-400">{doc.fileName}</p>
                </div>
                <button onClick={() => downloadDoc(doc)} className="text-xs text-blue-600 border border-blue-200 rounded px-3 py-1.5 hover:bg-blue-50">다운로드</button>
              </div>
            ))}
            <button onClick={() => setDocUser(null)} className="w-full h-10 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface RateRow { companyName: string; additionalRate: number }

function RatesTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; count?: number; saved?: number; samples?: RateRow[]; mode?: string; rate?: number; error?: string } | null>(null);
  const [currentRates, setCurrentRates] = useState<RateRow[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [bulkValue, setBulkValue] = useState("1");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/users?limit=200")
      .then((r) => r.json())
      .then((data) => setUsers(Array.isArray(data) ? data : (data.users ?? [])));
  }, []);

  async function loadCurrentRates(userId: string) {
    if (!userId) { setCurrentRates([]); return; }
    setRatesLoading(true);
    try {
      const res = await fetch(`/api/admin/rates?userId=${userId}`);
      const data: RateRow[] = await res.json();
      setCurrentRates(data);
    } finally { setRatesLoading(false); }
  }

  useEffect(() => { loadCurrentRates(selectedUser); }, [selectedUser]);

  async function downloadTemplate() {
    if (!selectedUser) return alert("회원을 먼저 선택해주세요.");
    const res = await fetch("/api/admin/rates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedUser }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const user = users.find((u) => u.id === selectedUser);
    a.download = `${user?.name || "회원"}_추가수수료.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function uploadRates(file: File) {
    if (!selectedUser) return alert("회원을 먼저 선택해주세요.");
    setUploading(true); setResult(null);
    const formData = new FormData();
    formData.append("userId", selectedUser);
    formData.append("file", file);
    try {
      const res = await fetch("/api/admin/rates", { method: "POST", body: formData });
      const data = await res.json();
      setResult(data);
      if (data.success) await loadCurrentRates(selectedUser);
    } catch { setResult({ error: "업로드 오류" }); }
    finally { setUploading(false); }
  }

  async function bulkSet() {
    if (!selectedUser) return alert("회원을 먼저 선택해주세요.");
    const n = Number(bulkValue);
    if (isNaN(n)) return alert("숫자를 입력해주세요.");
    if (!confirm(`${users.find((u) => u.id === selectedUser)?.name}의 모든 정산제약사에 추가수수료 ${n}%를 일괄 적용할까요?`)) return;
    setUploading(true); setResult(null);
    try {
      const res = await fetch("/api/admin/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser, bulkRate: n }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) await loadCurrentRates(selectedUser);
    } catch { setResult({ error: "일괄설정 오류" }); }
    finally { setUploading(false); }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">회원별 추가수수료 관리</h2>
        <p className="text-sm text-gray-500">회원 선택 → 엑셀 다운로드 → B열에 추가수수료 입력 → 업로드</p>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">회원 선택</label>
          <select
            value={selectedUser}
            onChange={(e) => { setSelectedUser(e.target.value); setResult(null); }}
            className="w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- 회원 선택 --</option>
            {users.filter((u) => u.approved).map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <Button onClick={downloadTemplate} disabled={!selectedUser} variant="outline" className="flex-1">
            <Download className="w-4 h-4 mr-2" />
            제약사 목록 엑셀 다운로드
          </Button>
          <Button onClick={() => fileRef.current?.click()} disabled={!selectedUser} className="flex-1 bg-gray-800 hover:bg-gray-700">
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            {uploading ? "업로드 중..." : "수수료 엑셀 업로드"}
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadRates(f); }} />
        </div>

        <div className="flex items-end gap-2 bg-amber-50 border border-amber-200 rounded p-3">
          <div>
            <label className="text-xs font-medium text-amber-800 block mb-1">전체 정산제약사 일괄 추가수수료</label>
            <input
              type="number"
              step="0.1"
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              className="h-9 w-24 rounded border border-amber-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <span className="ml-2 text-sm text-amber-700">%</span>
          </div>
          <Button onClick={bulkSet} disabled={!selectedUser || uploading} className="bg-amber-600 hover:bg-amber-700">
            전체 일괄 적용
          </Button>
        </div>

        <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700 space-y-1">
          <p className="font-medium">엑셀 작성 방법</p>
          <p>• A열: 제약사명 (다운로드한 그대로 유지)</p>
          <p>• B열: 추가수수료(%) 숫자 입력 (예: 2.5)</p>
          <p>• 0이면 추가수수료 없음, 입력한 수치가 기본수수료에 더해져 합계수수료가 됩니다</p>
        </div>

        {result && (
          <div className={`p-3 rounded-lg text-sm space-y-1 ${result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {result.success ? (
              <>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  {result.mode === "bulk"
                    ? <>일괄 적용 완료: <strong>{result.count}개 제약사</strong>에 <strong>{result.rate}%</strong> 설정</>
                    : <>엑셀 업로드 완료: <strong>{result.count}개</strong> 반영, DB 누적 <strong>{result.saved}개</strong></>}
                </div>
                {result.samples && result.samples.length > 0 && (
                  <div className="text-xs text-green-600 pl-6">
                    샘플: {result.samples.map((s) => `${s.companyName}(${s.additionalRate}%)`).join(", ")}
                  </div>
                )}
              </>
            ) : <><AlertCircle className="w-4 h-4 shrink-0" />{result.error}</>}
          </div>
        )}

        {/* 현재 저장된 추가수수료 목록 */}
        {selectedUser && (
          <div className="border border-gray-200 rounded-lg">
            <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">
                현재 저장된 추가수수료 ({currentRates.filter((r) => r.additionalRate !== 0).length} / {currentRates.length}개 제약사)
              </h3>
              <button onClick={() => loadCurrentRates(selectedUser)} className="text-xs text-gray-500 hover:text-gray-800">
                <RefreshCw className="w-3 h-3 inline mr-0.5" />새로고침
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {ratesLoading ? (
                <p className="text-xs text-gray-400 py-6 text-center">불러오는 중...</p>
              ) : currentRates.length === 0 ? (
                <p className="text-xs text-gray-400 py-6 text-center">저장된 수수료가 없어요.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="px-3 py-2 text-left">제약사명</th>
                      <th className="px-3 py-2 text-right w-24">추가수수료</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {currentRates.map((r) => (
                      <tr key={r.companyName}>
                        <td className="px-3 py-1.5 text-gray-700">{r.companyName}</td>
                        <td className={`px-3 py-1.5 text-right font-mono ${r.additionalRate ? "text-blue-700 font-semibold" : "text-gray-300"}`}>
                          {r.additionalRate}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface FilterReq {
  id: string; userName: string; clientName: string; bizNumber: string;
  companyName: string; status: string; createdAt: string;
  replyText: string | null; repliedAt: string | null;
  user: { name: string | null; email: string };
}

const statusOptions = [
  { value: "PENDING", label: "대기", cls: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  { value: "REVIEWING", label: "확인중", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "REJECTED", label: "거래불가", cls: "bg-red-50 text-red-700 border-red-200" },
  { value: "APPROVED", label: "거래가능", cls: "bg-green-50 text-green-700 border-green-200" },
];

function FilterReqsTab() {
  const [reqs, setReqs] = useState<FilterReq[]>([]);
  const [subs, setSubs] = useState<Map<string, CompanySubmission>>(new Map());
  const [loading, setLoading] = useState(true);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const [r1, r2] = await Promise.all([
      fetch("/api/filter-request?all=true").then((r) => r.json()),
      fetch("/api/admin/company-submissions").then((r) => r.json()),
    ]);
    setReqs(Array.isArray(r1) ? r1 : []);
    setSubs(new Map(Array.isArray(r2) ? r2.map((s: CompanySubmission) => [s.companyName, s]) : []));
    setLoading(false);
  }

  async function fetchReqs() {
    const res = await fetch("/api/filter-request?all=true");
    setReqs(await res.json());
  }

  async function updateStatus(id: string, status: string) {
    await fetch("/api/filter-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setReqs((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
  }

  async function sendReply(id: string) {
    const text = (replyDraft[id] ?? "").trim();
    if (!text) return;
    setSavingId(id);
    const res = await fetch("/api/filter-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, replyText: text }),
    });
    if (res.ok) {
      const updated = await res.json();
      setReqs((prev) => prev.map((r) => r.id === id ? { ...r, replyText: updated.replyText, repliedAt: updated.repliedAt } : r));
      setReplyDraft((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
    setSavingId(null);
  }

  const statusCounts: Record<string, number> = { ALL: reqs.length };
  for (const s of statusOptions) statusCounts[s.value] = 0;
  for (const r of reqs) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

  const filtered = reqs.filter((r) => {
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (r.user.name || r.userName || "").toLowerCase().includes(q) ||
      r.user.email.toLowerCase().includes(q) ||
      r.clientName.toLowerCase().includes(q) ||
      r.bizNumber.includes(query) ||
      r.companyName.toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function handleQueryChange(v: string) { setQuery(v); setPage(1); }
  function handleStatusChange(v: string) { setStatusFilter(v); setPage(1); }
  function handlePageSizeChange(v: number) { setPageSize(v); setPage(1); }

  function exportExcel() {
    const rows = filtered.map((r) => {
      const sub = subs.get(r.companyName);
      return {
        영업사원명: r.user.name || r.userName,
        아이디: r.user.email,
        거래처명: r.clientName,
        사업자번호: r.bizNumber,
        "요청 제약사": r.companyName,
        "제출처 법인명": sub?.submissionEntity || "",
        "추가수수료(%)": sub?.defaultAdditionalRate ?? "",
        요청일: new Date(r.createdAt).toLocaleString("ko-KR"),
        상태: statusOptions.find((s) => s.value === r.status)?.label || r.status,
        회신: r.replyText || "",
        회신일: r.repliedAt ? new Date(r.repliedAt).toLocaleString("ko-KR") : "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 10 }, { wch: 24 }, { wch: 18 }, { wch: 14 }, { wch: 18 },
      { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 40 }, { wch: 18 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "필터링요청");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `필터링요청_${statusFilter === "ALL" ? "전체" : statusOptions.find((s) => s.value === statusFilter)?.label}_${stamp}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">영업사원 필터링 요청 ({filtered.length}/{reqs.length}건)</h2>
            <p className="text-xs text-gray-400 mt-0.5">영업사원이 요청한 제약사 거래 조회 현황입니다.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder="영업사원·거래처·사업자번호·제약사 검색"
                className="h-9 w-72 border border-gray-200 rounded pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {query && (
                <button onClick={() => handleQueryChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="h-9 border border-gray-200 rounded px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {[10, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}개씩</option>)}
            </select>
            <button
              onClick={exportExcel}
              disabled={filtered.length === 0}
              className="h-9 px-3 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />엑셀
            </button>
            <button onClick={fetchReqs} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />새로고침
            </button>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => handleStatusChange("ALL")}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
              statusFilter === "ALL" ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >전체 <span className="opacity-70">({statusCounts.ALL})</span></button>
          {statusOptions.map((s) => (
            <button
              key={s.value}
              onClick={() => handleStatusChange(s.value)}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                statusFilter === s.value ? `${s.cls} ring-2 ring-offset-1 ring-current/20` : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >{s.label} <span className="opacity-70">({statusCounts[s.value] || 0})</span></button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
              <th className="px-4 py-3 text-left">영업사원명</th>
              <th className="px-4 py-3 text-left">아이디(이메일)</th>
              <th className="px-4 py-3 text-left">거래처명</th>
              <th className="px-4 py-3 text-left">사업자번호</th>
              <th className="px-4 py-3 text-left">요청 제약사</th>
              <th className="px-4 py-3 text-left">제출처</th>
              <th className="px-4 py-3 text-center">요청일</th>
              <th className="px-4 py-3 text-center">상태</th>
              <th className="px-4 py-3 text-left min-w-[280px]">회신</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageRows.map((req) => {
              const statusOpt = statusOptions.find((s) => s.value === req.status) || statusOptions[0];
              const draft = replyDraft[req.id] ?? "";
              const sub = subs.get(req.companyName);
              return (
                <tr key={req.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-3 font-medium text-gray-900">{req.user.name || req.userName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{req.user.email}</td>
                  <td className="px-4 py-3 text-gray-700">{req.clientName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">{req.bizNumber}</td>
                  <td className="px-4 py-3 text-gray-800">{req.companyName}</td>
                  <td className="px-4 py-3 text-xs">
                    {sub ? (
                      <div className="space-y-0.5">
                        {sub.submissionEntity && <div className="font-medium text-gray-800">{sub.submissionEntity}</div>}
                        {sub.contactName && <div className="text-gray-500">{sub.contactName}</div>}
                        {sub.email && <div className="text-blue-600 truncate max-w-[140px]">{sub.email}</div>}
                        {sub.defaultAdditionalRate != null && (
                          <div className="text-emerald-600 font-medium">+{sub.defaultAdditionalRate}%</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-300 text-[11px]">미등록</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-400 text-xs">{new Date(req.createdAt).toLocaleDateString("ko-KR")}</td>
                  <td className="px-4 py-3 text-center">
                    <select
                      value={req.status}
                      onChange={(e) => updateStatus(req.id, e.target.value)}
                      className={`text-xs px-2 py-1 rounded border font-medium ${statusOpt.cls} focus:outline-none cursor-pointer`}
                    >
                      {statusOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {req.replyText ? (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-700 whitespace-pre-wrap bg-blue-50 border border-blue-100 rounded px-2 py-1.5">{req.replyText}</p>
                        <div className="flex items-center gap-2 text-[11px] text-gray-400">
                          <span>{req.repliedAt ? new Date(req.repliedAt).toLocaleString("ko-KR") : ""}</span>
                          <button
                            type="button"
                            onClick={() => setReplyDraft((p) => ({ ...p, [req.id]: req.replyText || "" }))}
                            className="text-blue-500 hover:text-blue-700"
                          >수정</button>
                        </div>
                        {replyDraft[req.id] !== undefined && (
                          <div className="space-y-1">
                            <textarea
                              value={draft}
                              onChange={(e) => setReplyDraft((p) => ({ ...p, [req.id]: e.target.value }))}
                              placeholder="회신 내용"
                              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 min-h-[56px] focus:outline-none focus:border-blue-400"
                            />
                            <div className="flex gap-1 justify-end">
                              <button
                                type="button"
                                onClick={() => setReplyDraft((p) => { const n = { ...p }; delete n[req.id]; return n; })}
                                className="text-[11px] text-gray-500 hover:text-gray-700 px-2 py-1"
                              >취소</button>
                              <button
                                type="button"
                                onClick={() => sendReply(req.id)}
                                disabled={!draft.trim() || savingId === req.id}
                                className="text-[11px] text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 rounded px-2 py-1"
                              >{savingId === req.id ? "저장 중..." : "저장"}</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <textarea
                          value={draft}
                          onChange={(e) => setReplyDraft((p) => ({ ...p, [req.id]: e.target.value }))}
                          placeholder="회신 내용 (영업사원에게 표시됨)"
                          className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 min-h-[56px] focus:outline-none focus:border-blue-400"
                        />
                        <button
                          type="button"
                          onClick={() => sendReply(req.id)}
                          disabled={!draft.trim() || savingId === req.id}
                          className="text-[11px] text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 rounded px-2 py-1 ml-auto block"
                        >{savingId === req.id ? "저장 중..." : "회신 보내기"}</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={9} className="py-12 text-center text-gray-400 text-sm">
                {query ? "검색 결과가 없어요." : "요청 내역이 없어요."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-600">
          <span className="text-xs text-gray-400">{(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} / {filtered.length}건</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)} disabled={safePage === 1}
              className="px-2 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >«</button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}
              className="px-2 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >‹</button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(safePage - 3, totalPages - 6));
              return start + i;
            }).map((n) => (
              <button
                key={n} onClick={() => setPage(n)}
                className={`px-2.5 py-1 rounded text-xs border ${n === safePage ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 hover:bg-gray-50"}`}
              >{n}</button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              className="px-2 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >›</button>
            <button
              onClick={() => setPage(totalPages)} disabled={safePage === totalPages}
              className="px-2 py-1 rounded text-xs border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >»</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 제약사 제출처 관리 탭
// ─────────────────────────────────────────────

interface CompanySubmission {
  companyName: string;
  submissionEntity: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  defaultAdditionalRate: number | null;
  notes: string | null;
}

const emptySubmission = (): Omit<CompanySubmission, "companyName"> & { companyName: string } => ({
  companyName: "", submissionEntity: "", contactName: "", email: "", phone: "", fax: "", defaultAdditionalRate: null, notes: "",
});

interface SubmissionEntity {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  fax: string | null;
  notes: string | null;
}

// ─────────────────────────────────────────────
// 제약사별 일괄제출 탭
// ─────────────────────────────────────────────

type EditSub = CompanySubmission & { isNew?: boolean };

function BulkSubmissionTab() {
  const [reqs, setReqs] = useState<FilterReq[]>([]);
  const [subs, setSubs] = useState<CompanySubmission[]>([]);
  const [entities, setEntities] = useState<SubmissionEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusScope, setStatusScope] = useState<"PENDING" | "ALL" | "OPEN">("PENDING");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editSub, setEditSub] = useState<EditSub | null>(null);
  const [savingSub, setSavingSub] = useState(false);
  const [editSubEntityMode, setEditSubEntityMode] = useState<"select" | "new">("select");
  const [newEntityForm, setNewEntityForm] = useState<SubmissionEntity | null>(null);
  const [savingEntity, setSavingEntity] = useState(false);
  const [bulkingName, setBulkingName] = useState<string | null>(null);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [kakaoReady, setKakaoReady] = useState(false);
  const [kakaoModal, setKakaoModal] = useState<{ companyName: string; rows: FilterReq[]; sub: CompanySubmission; editMsg: string; editContact: string; editPhone: string } | null>(null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const KAKAO_APP_KEY = process.env.NEXT_PUBLIC_KAKAO_APP_KEY;
    if (!KAKAO_APP_KEY) return;
    const initKakao = () => {
      if (window.Kakao && !window.Kakao.isInitialized()) window.Kakao.init(KAKAO_APP_KEY);
      setKakaoReady(true);
    };
    if (typeof window !== "undefined" && window.Kakao) { initKakao(); return; }
    const script = document.createElement("script");
    script.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js";
    script.async = true;
    script.onload = initKakao;
    document.head.appendChild(script);
  }, []);

  async function load() {
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      fetch("/api/filter-request?all=true").then((r) => r.json()),
      fetch("/api/admin/company-submissions").then((r) => r.json()),
      fetch("/api/admin/submission-entities").then((r) => r.json()),
    ]);
    setReqs(Array.isArray(r1) ? r1 : []);
    setSubs(Array.isArray(r2) ? r2 : []);
    setEntities(Array.isArray(r3) ? r3 : []);
    setLoading(false);
  }

  const subsByCompany = new Map(subs.map((s) => [s.companyName, s]));

  const filtered = reqs.filter((r) => {
    if (statusScope === "PENDING" && r.status !== "PENDING") return false;
    if (statusScope === "OPEN" && r.status !== "PENDING" && r.status !== "REVIEWING") return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        r.companyName.toLowerCase().includes(q) ||
        r.clientName.toLowerCase().includes(q) ||
        r.bizNumber.includes(query)
      );
    }
    return true;
  });

  const groups = new Map<string, FilterReq[]>();
  for (const r of filtered) {
    const arr = groups.get(r.companyName) || [];
    arr.push(r);
    groups.set(r.companyName, arr);
  }
  const groupEntries = Array.from(groups.entries()).sort((a, b) => {
    const aHas = subsByCompany.has(a[0]) ? 1 : 0;
    const bHas = subsByCompany.has(b[0]) ? 1 : 0;
    if (aHas !== bHas) return aHas - bHas; // 제출처 없는 곳을 위로
    return a[0].localeCompare(b[0]);
  });

  const withSubCount = groupEntries.filter(([name]) => subsByCompany.has(name)).length;

  function toggle(name: string) {
    setCollapsed((p) => ({ ...p, [name]: !p[name] }));
  }

  function composeMail(companyName: string, rows: FilterReq[], sub: CompanySubmission | undefined) {
    if (!sub?.email) {
      alert("이 제약사의 이메일 제출처가 등록되지 않았어요. 먼저 제출처를 등록해 주세요.");
      return;
    }
    const subject = `[필터링 요청] ${companyName} - 거래가능 여부 확인 (${rows.length}건)`;
    const body = `안녕하세요, ${sub.contactName || "담당자"}님.\n\n아래 ${rows.length}개 거래처에 대해 거래 가능 여부 확인 부탁드립니다.\n\n` +
      rows.map((r, i) => `${i + 1}. ${r.clientName} (사업자번호 ${r.bizNumber})`).join("\n") +
      `\n\n회신은 본 메일로 부탁드리며, 각 거래처별 가능/불가 여부 표시해 주시면 감사하겠습니다.\n\n감사합니다.`;
    window.location.href = `mailto:${sub.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function copyList(companyName: string, rows: FilterReq[]) {
    const text = rows.map((r, i) => `${i + 1}. ${r.clientName} / ${r.bizNumber}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedName(companyName);
      setTimeout(() => setCopiedName((n) => n === companyName ? null : n), 1500);
    } catch {
      alert("복사에 실패했어요.");
    }
  }

  function exportCompanyExcel(companyName: string, rows: FilterReq[]) {
    const sub = subsByCompany.get(companyName);
    const data = rows.map((r) => ({
      거래처명: r.clientName,
      사업자번호: r.bizNumber,
      영업사원명: r.user.name || r.userName,
      아이디: r.user.email,
      "제출처 법인명": sub?.submissionEntity || "",
      요청일: new Date(r.createdAt).toLocaleDateString("ko-KR"),
      상태: statusOptions.find((s) => s.value === r.status)?.label || r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, companyName.slice(0, 30) || "Sheet1");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `필터링요청_${companyName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function markAllReviewing(companyName: string, rows: FilterReq[]) {
    const pendingIds = rows.filter((r) => r.status === "PENDING").map((r) => r.id);
    if (pendingIds.length === 0) return;
    if (!confirm(`${companyName}의 대기 ${pendingIds.length}건을 "확인중"으로 변경할까요?`)) return;
    setBulkingName(companyName);
    await Promise.all(pendingIds.map((id) => fetch("/api/filter-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "REVIEWING" }),
    })));
    setReqs((prev) => prev.map((r) => pendingIds.includes(r.id) ? { ...r, status: "REVIEWING" } : r));
    setBulkingName(null);
  }

  async function saveNewEntity() {
    if (!newEntityForm) return;
    const name = newEntityForm.name.trim();
    if (!name) { alert("법인명은 필수에요."); return; }
    setSavingEntity(true);
    const res = await fetch("/api/admin/submission-entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newEntityForm),
    });
    if (res.ok) {
      const saved: SubmissionEntity = await res.json();
      setEntities((prev) => [...prev.filter((e) => e.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setEditSub((p) => p ? { ...p, submissionEntity: saved.name, contactName: saved.contactName || p.contactName, email: saved.email || p.email, phone: saved.phone || p.phone, fax: saved.fax || p.fax } : p);
      setEditSubEntityMode("select");
      setNewEntityForm(null);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(`저장 실패: ${data.error || "알 수 없는 오류"}`);
    }
    setSavingEntity(false);
  }

  async function saveSubmission() {
    if (!editSub) return;
    const name = editSub.companyName.trim();
    if (!name) return;
    setSavingSub(true);
    const res = await fetch("/api/admin/company-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editSub),
    });
    if (res.ok) {
      const saved: CompanySubmission = await res.json();
      setSubs((prev) => {
        const idx = prev.findIndex((s) => s.companyName === saved.companyName);
        return idx >= 0 ? prev.map((s, i) => i === idx ? saved : s) : [...prev, saved];
      });
      setEditSub(null);
    }
    setSavingSub(false);
  }

  function sendKakao() {
    if (!kakaoModal) return;
    if (!window.Kakao?.Share) { alert("카카오 SDK가 아직 로드되지 않았어요. 잠시 후 다시 시도해 주세요."); return; }
    const text = kakaoModal.editMsg.slice(0, 200);
    window.Kakao.Share.sendDefault({
      objectType: "text",
      text,
      link: { webUrl: window.location.href, mobileWebUrl: window.location.href },
      buttonTitle: "확인하기",
    });
    setKakaoModal(null);
  }

  function buildKakaoPreview(companyName: string, rows: FilterReq[]) {
    const listText = rows.slice(0, 6).map((r, i) => `${i + 1}. ${r.clientName} (${r.bizNumber})`).join("\n");
    const suffix = rows.length > 6 ? `\n...외 ${rows.length - 6}건` : "";
    return `[필터링 요청] ${companyName}\n${rows.length}개 거래처 거래가능 여부 확인 요청드립니다.\n\n${listText}${suffix}`.slice(0, 200);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">제약사별 일괄제출</h2>
            <p className="text-xs text-gray-400 mt-0.5">여러 거래처의 필터링 요청을 제약사 단위로 묶어 제출처(필터링요청처)에 한 번에 보냅니다.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusScope}
              onChange={(e) => setStatusScope(e.target.value as "PENDING" | "ALL" | "OPEN")}
              className="h-9 border border-gray-200 rounded px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="PENDING">대기 상태만</option>
              <option value="OPEN">대기 + 확인중</option>
              <option value="ALL">전체 상태</option>
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="제약사 / 거래처 / 사업자번호"
                className="h-9 w-60 border border-gray-200 rounded pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button onClick={load} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />새로고침
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 border border-blue-100 rounded-md px-3 py-2.5">
            <div className="text-[11px] text-blue-700 font-medium">대상 제약사</div>
            <div className="text-xl font-bold text-blue-900 mt-0.5">{groupEntries.length}곳</div>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-md px-3 py-2.5">
            <div className="text-[11px] text-amber-700 font-medium">총 요청 건수</div>
            <div className="text-xl font-bold text-amber-900 mt-0.5">{filtered.length}건</div>
          </div>
          <div className={`${withSubCount === groupEntries.length ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"} border rounded-md px-3 py-2.5`}>
            <div className={`text-[11px] font-medium ${withSubCount === groupEntries.length ? "text-emerald-700" : "text-red-700"}`}>제출처 등록됨</div>
            <div className={`text-xl font-bold mt-0.5 ${withSubCount === groupEntries.length ? "text-emerald-900" : "text-red-900"}`}>{withSubCount}/{groupEntries.length}곳</div>
          </div>
        </div>
      </div>

      {loading && <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>}

      {!loading && groupEntries.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg py-16 text-center text-gray-400 text-sm">
          {query || statusScope !== "PENDING" ? "조건에 맞는 요청이 없어요." : "대기 중인 필터링 요청이 없어요."}
        </div>
      )}

      {!loading && groupEntries.map(([companyName, rows]) => {
        const sub = subsByCompany.get(companyName);
        const isCollapsed = collapsed[companyName] ?? false;
        const pendingCount = rows.filter((r) => r.status === "PENDING").length;
        return (
          <div key={companyName} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <button onClick={() => toggle(companyName)} className="text-gray-400 hover:text-gray-700 shrink-0">
                  {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
                <h3 className="text-base font-semibold text-gray-900 truncate">{companyName}</h3>
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">{rows.length}건</span>
                {sub ? (
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1 shrink-0">
                    <CheckCircle className="w-3 h-3" />제출처 등록됨
                  </span>
                ) : (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1 shrink-0">
                    <AlertCircle className="w-3 h-3" />제출처 없음
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {sub?.email && (
                  <button onClick={() => composeMail(companyName, rows, sub)} className="text-xs bg-blue-600 text-white hover:bg-blue-700 rounded px-2.5 py-1.5 flex items-center gap-1">
                    <Mail className="w-3 h-3" />이메일 작성
                  </button>
                )}
                {kakaoReady && sub && (
                  <button
                    onClick={() => setKakaoModal({ companyName, rows, sub, editMsg: buildKakaoPreview(companyName, rows), editContact: sub.contactName || "", editPhone: sub.phone || "" })}
                    className="text-xs rounded px-2.5 py-1.5 flex items-center gap-1 font-medium"
                    style={{ background: "#FEE500", color: "#3C1E1E" }}
                  >
                    <MessageCircle className="w-3 h-3" />카카오톡
                  </button>
                )}
                <button onClick={() => copyList(companyName, rows)} className="text-xs bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 rounded px-2.5 py-1.5 flex items-center gap-1">
                  <Copy className="w-3 h-3" />{copiedName === companyName ? "복사됨!" : "목록 복사"}
                </button>
                <button onClick={() => exportCompanyExcel(companyName, rows)} className="text-xs bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50 rounded px-2.5 py-1.5 flex items-center gap-1">
                  <Download className="w-3 h-3" />엑셀
                </button>
                {pendingCount > 0 && (
                  <button
                    onClick={() => markAllReviewing(companyName, rows)}
                    disabled={bulkingName === companyName}
                    className="text-xs bg-white text-blue-700 border border-blue-200 hover:bg-blue-50 rounded px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50"
                  >{bulkingName === companyName ? "처리중..." : `${pendingCount}건 확인중 표시`}</button>
                )}
                <button
                  onClick={() => { setEditSub(sub ? { ...sub } : { companyName, submissionEntity: "", contactName: "", email: "", phone: "", fax: "", defaultAdditionalRate: null, notes: "", isNew: true }); setEditSubEntityMode(sub?.submissionEntity ? "select" : "select"); }}
                  className="text-xs bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 rounded px-2.5 py-1.5 flex items-center gap-1"
                ><Inbox className="w-3 h-3" />{sub ? "제출처 수정" : "제출처 등록"}</button>
              </div>
            </div>

            {sub ? (
              <div className="px-5 py-2.5 bg-gray-50/60 border-b border-gray-100 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                {sub.contactName && <span className="text-gray-700"><span className="text-gray-400">담당자:</span> <span className="font-medium">{sub.contactName}</span></span>}
                {sub.email && <span className="text-gray-700"><span className="text-gray-400">이메일:</span> <a className="text-blue-600 hover:underline" href={`mailto:${sub.email}`}>{sub.email}</a></span>}
                {sub.phone && <span className="text-gray-700"><span className="text-gray-400">전화:</span> {sub.phone}</span>}
                {sub.fax && <span className="text-gray-700"><span className="text-gray-400">팩스:</span> {sub.fax}</span>}
                {sub.notes && <span className="text-gray-500 italic">{sub.notes}</span>}
              </div>
            ) : (
              <div className="px-5 py-2.5 bg-red-50/50 border-b border-red-100 text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5" /> 제출처 정보가 없어요. "제출처 등록"을 눌러 담당자 이메일·연락처를 먼저 등록해 주세요.
              </div>
            )}

            {!isCollapsed && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white text-xs text-gray-500 font-semibold">
                      <th className="px-5 py-2.5 text-left w-10">#</th>
                      <th className="px-4 py-2.5 text-left">거래처명</th>
                      <th className="px-4 py-2.5 text-left">사업자번호</th>
                      <th className="px-4 py-2.5 text-left">영업사원</th>
                      <th className="px-4 py-2.5 text-center">요청일</th>
                      <th className="px-4 py-2.5 text-center">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((r, i) => {
                      const sOpt = statusOptions.find((s) => s.value === r.status) || statusOptions[0];
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-5 py-2 text-gray-400 text-xs">{i + 1}</td>
                          <td className="px-4 py-2 text-gray-800">{r.clientName}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs font-mono">{r.bizNumber}</td>
                          <td className="px-4 py-2 text-gray-600 text-xs">{r.user.name || r.userName} <span className="text-gray-400">({r.user.email})</span></td>
                          <td className="px-4 py-2 text-center text-gray-400 text-xs">{new Date(r.createdAt).toLocaleDateString("ko-KR")}</td>
                          <td className="px-4 py-2 text-center">
                            <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${sOpt.cls}`}>{sOpt.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {kakaoModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full" style={{ background: "#FEE500" }}>
                  <MessageCircle className="w-3.5 h-3.5" style={{ color: "#3C1E1E" }} />
                </span>
                카카오톡으로 보내기 — {kakaoModal.companyName}
              </h3>
              <button onClick={() => setKakaoModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">담당자명</label>
                  <input
                    value={kakaoModal.editContact}
                    onChange={(e) => setKakaoModal((p) => p ? { ...p, editContact: e.target.value } : p)}
                    className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300"
                    placeholder="담당자명"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">전화번호</label>
                  <input
                    value={kakaoModal.editPhone}
                    onChange={(e) => setKakaoModal((p) => p ? { ...p, editPhone: e.target.value } : p)}
                    className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300"
                    placeholder="전화번호"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-500">메시지 내용</label>
                  <span className={`text-[10px] ${kakaoModal.editMsg.length > 200 ? "text-red-500 font-semibold" : "text-gray-400"}`}>{kakaoModal.editMsg.length}/200자</span>
                </div>
                <textarea
                  value={kakaoModal.editMsg}
                  onChange={(e) => setKakaoModal((p) => p ? { ...p, editMsg: e.target.value } : p)}
                  rows={7}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-yellow-300 resize-none leading-relaxed"
                />
                {kakaoModal.editMsg.length > 200 && (
                  <p className="text-[11px] text-red-500 mt-1">200자를 초과했어요. 전송 시 200자까지만 발송됩니다.</p>
                )}
              </div>
              <p className="text-[11px] text-gray-400">카카오톡 공유 화면이 열리면 보낼 대화방 또는 친구를 선택해 주세요.</p>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setKakaoModal(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50">취소</button>
              <button
                onClick={sendKakao}
                className="px-4 py-2 text-sm font-semibold rounded flex items-center gap-2 hover:opacity-90"
                style={{ background: "#FEE500", color: "#3C1E1E" }}
              >
                <MessageCircle className="w-4 h-4" />카카오톡으로 전송
              </button>
            </div>
          </div>
        </div>
      )}

      {editSub && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{editSub.isNew ? `${editSub.companyName} 제출처 등록` : `${editSub.companyName} 제출처 수정`}</h3>
              <button onClick={() => setEditSub(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* 제출처법인명 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-700">제출처법인명</label>
                    <button
                    type="button"
                    onClick={() => setNewEntityForm({ name: "", contactName: null, email: null, phone: null, fax: null, notes: null })}
                    className="text-[11px] text-blue-600 hover:underline flex items-center gap-1"
                  ><Plus className="w-3 h-3" />신규 제출처 등록</button>
                </div>
                <select
                  value={editSub.submissionEntity || ""}
                  onChange={(e) => {
                    const entity = entities.find((en) => en.name === e.target.value);
                    setEditSub((p) => p ? {
                      ...p,
                      submissionEntity: e.target.value,
                      contactName: entity?.contactName ?? p.contactName,
                      email: entity?.email ?? p.email,
                      phone: entity?.phone ?? p.phone,
                      fax: entity?.fax ?? p.fax,
                    } : p);
                  }}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  <option value="">— 선택 안 함 —</option>
                  {entities.map((en) => (
                    <option key={en.name} value={en.name}>{en.name}</option>
                  ))}
                </select>
                {editSub.submissionEntity && entities.find((e) => e.name === editSub.submissionEntity) && (
                  <div className="mt-1.5 text-[11px] text-gray-500 bg-gray-50 rounded px-2 py-1.5 flex flex-wrap gap-x-3">
                    {entities.find((e) => e.name === editSub.submissionEntity)?.contactName && <span>담당자: {entities.find((e) => e.name === editSub.submissionEntity)?.contactName}</span>}
                    {entities.find((e) => e.name === editSub.submissionEntity)?.phone && <span>전화: {entities.find((e) => e.name === editSub.submissionEntity)?.phone}</span>}
                    {entities.find((e) => e.name === editSub.submissionEntity)?.email && <span>이메일: {entities.find((e) => e.name === editSub.submissionEntity)?.email}</span>}
                  </div>
                )}
                {entities.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1">등록된 제출처가 없어요. 아래 버튼으로 먼저 등록해 주세요.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">담당자명</label>
                <input
                  value={editSub.contactName || ""}
                  onChange={(e) => setEditSub((p) => p ? { ...p, contactName: e.target.value } : p)}
                  placeholder="예) 홍길동"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">이메일 <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  value={editSub.email || ""}
                  onChange={(e) => setEditSub((p) => p ? { ...p, email: e.target.value } : p)}
                  placeholder="예) contact@company.com"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <p className="text-[11px] text-gray-400 mt-1">이메일이 있어야 "이메일 작성" 버튼으로 일괄 발송할 수 있어요.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">전화번호</label>
                  <input
                    value={editSub.phone || ""}
                    onChange={(e) => setEditSub((p) => p ? { ...p, phone: e.target.value } : p)}
                    placeholder="예) 02-1234-5678"
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">팩스</label>
                  <input
                    value={editSub.fax || ""}
                    onChange={(e) => setEditSub((p) => p ? { ...p, fax: e.target.value } : p)}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
                <textarea
                  value={editSub.notes || ""}
                  onChange={(e) => setEditSub((p) => p ? { ...p, notes: e.target.value } : p)}
                  rows={2}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setEditSub(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50">취소</button>
              <button
                onClick={saveSubmission}
                disabled={savingSub}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
              >{savingSub ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {newEntityForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">신규 제출처(법인) 등록</h3>
              <button onClick={() => setNewEntityForm(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">법인명 <span className="text-red-500">*</span></label>
                <input
                  autoFocus
                  value={newEntityForm.name}
                  onChange={(e) => setNewEntityForm((p) => p ? { ...p, name: e.target.value } : p)}
                  placeholder="예) 동아쏘시오홀딩스"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">담당자명</label>
                <input
                  value={newEntityForm.contactName || ""}
                  onChange={(e) => setNewEntityForm((p) => p ? { ...p, contactName: e.target.value } : p)}
                  placeholder="예) 홍길동"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">이메일</label>
                <input
                  type="email"
                  value={newEntityForm.email || ""}
                  onChange={(e) => setNewEntityForm((p) => p ? { ...p, email: e.target.value } : p)}
                  placeholder="예) contact@company.com"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">전화번호</label>
                  <input
                    value={newEntityForm.phone || ""}
                    onChange={(e) => setNewEntityForm((p) => p ? { ...p, phone: e.target.value } : p)}
                    placeholder="예) 02-1234-5678"
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">팩스</label>
                  <input
                    value={newEntityForm.fax || ""}
                    onChange={(e) => setNewEntityForm((p) => p ? { ...p, fax: e.target.value } : p)}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
                <input
                  value={newEntityForm.notes || ""}
                  onChange={(e) => setNewEntityForm((p) => p ? { ...p, notes: e.target.value } : p)}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setNewEntityForm(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50">취소</button>
              <button
                onClick={saveNewEntity}
                disabled={savingEntity || !newEntityForm.name.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
              >{savingEntity ? "저장 중..." : "등록 후 선택"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompanySubmissionsTab() {
  const [subTab, setSubTab] = useState<"new" | "bulk" | "current">("current");
  const [rows, setRows] = useState<CompanySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [inlineEdits, setInlineEdits] = useState<Map<string, Record<string, string>>>(new Map());
  const [inlineSavingName, setInlineSavingName] = useState<string | null>(null);
  const [inlineSavedSet, setInlineSavedSet] = useState<Set<string>>(new Set());
  // 신규 등록 폼
  const [newForm, setNewForm] = useState<CompanySubmission>({ ...emptySubmission() });
  const [savingNew, setSavingNew] = useState(false);
  const [newSaved, setNewSaved] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/company-submissions");
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function saveNew() {
    const name = newForm.companyName.trim();
    if (!name) { alert("제약사명은 필수에요."); return; }
    setSavingNew(true);
    const res = await fetch("/api/admin/company-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newForm),
    });
    if (res.ok) {
      const saved: CompanySubmission = await res.json();
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.companyName === saved.companyName);
        return idx >= 0 ? prev.map((r, i) => i === idx ? saved : r) : [...prev, saved].sort((a, b) => a.companyName.localeCompare(b.companyName));
      });
      setNewForm({ ...emptySubmission() });
      setNewSaved(true);
      setTimeout(() => setNewSaved(false), 2000);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(`저장 실패: ${data.error || "알 수 없는 오류"}`);
    }
    setSavingNew(false);
  }

  function getInlineField(companyName: string, field: keyof CompanySubmission): string {
    const edits = inlineEdits.get(companyName);
    if (edits && field in edits) return edits[field as string];
    const row = rows.find((r) => r.companyName === companyName);
    if (!row) return "";
    const v = row[field];
    return v != null ? String(v) : "";
  }

  function updateInlineField(companyName: string, field: keyof CompanySubmission, value: string) {
    setInlineEdits((prev) => {
      const n = new Map(prev);
      n.set(companyName, { ...(n.get(companyName) ?? {}), [field]: value });
      return n;
    });
    setInlineSavedSet((prev) => { const n = new Set(prev); n.delete(companyName); return n; });
  }

  async function saveInlineRow(companyName: string) {
    if (inlineSavingName === companyName) return;
    const baseRow = rows.find((r) => r.companyName === companyName);
    if (!baseRow) return;
    const edits = inlineEdits.get(companyName) ?? {};
    const merged: CompanySubmission = {
      ...baseRow,
      submissionEntity: "submissionEntity" in edits ? edits.submissionEntity || null : baseRow.submissionEntity,
      contactName: "contactName" in edits ? edits.contactName || null : baseRow.contactName,
      email: "email" in edits ? edits.email || null : baseRow.email,
      phone: "phone" in edits ? edits.phone || null : baseRow.phone,
      fax: "fax" in edits ? edits.fax || null : baseRow.fax,
      defaultAdditionalRate: "defaultAdditionalRate" in edits
        ? (edits.defaultAdditionalRate !== "" ? Number(edits.defaultAdditionalRate) : null)
        : baseRow.defaultAdditionalRate,
      notes: "notes" in edits ? edits.notes || null : baseRow.notes,
    };
    setInlineSavingName(companyName);
    try {
      const res = await fetch("/api/admin/company-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged),
      });
      if (res.ok) {
        const saved: CompanySubmission = await res.json();
        setRows((prev) => prev.map((r) => r.companyName === saved.companyName ? saved : r));
        setInlineEdits((prev) => { const n = new Map(prev); n.delete(companyName); return n; });
        setInlineSavedSet((prev) => new Set([...prev, companyName]));
      }
    } finally {
      setInlineSavingName(null);
    }
  }

  async function deleteRow(companyName: string) {
    if (!confirm(`"${companyName}" 제출처 정보를 삭제할까요?`)) return;
    setDeletingName(companyName);
    await fetch("/api/admin/company-submissions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName }),
    });
    setRows((prev) => prev.filter((r) => r.companyName !== companyName));
    setDeletingName(null);
  }

  const filtered = rows.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return r.companyName.toLowerCase().includes(q) ||
      (r.contactName || "").toLowerCase().includes(q) ||
      (r.email || "").toLowerCase().includes(q) ||
      (r.phone || "").includes(query);
  });

  const fieldCls = "w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* 서브탭 헤더 */}
        <div className="px-5 pt-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1">
            {([["new","신규 등록"],["bulk","일괄 업로드"],["current","현재 현황"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSubTab(key)}
                className={`text-sm px-4 py-2 border-b-2 font-medium transition-colors ${subTab === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"}`}
              >{label}{key === "current" && <span className="ml-1 text-xs opacity-60">({rows.length})</span>}</button>
            ))}
          </div>
          {subTab === "current" && (
            <div className="flex items-center gap-2 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제약사·담당자·이메일·전화번호"
                  className="h-8 w-60 border border-gray-200 rounded pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                {query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>}
              </div>
              <button onClick={load} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />새로고침
              </button>
            </div>
          )}
        </div>

        {/* 신규 등록 */}
        {subTab === "new" && (
          <div className="p-6 max-w-lg">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">제약사명 <span className="text-red-500">*</span></label>
                <input value={newForm.companyName} onChange={(e) => setNewForm((p) => ({ ...p, companyName: e.target.value }))} placeholder="예) 동아ST" className={fieldCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">제출처 법인명</label>
                <input value={newForm.submissionEntity || ""} onChange={(e) => setNewForm((p) => ({ ...p, submissionEntity: e.target.value }))} placeholder="예) 동아쏘시오홀딩스" className={fieldCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">담당자명</label>
                  <input value={newForm.contactName || ""} onChange={(e) => setNewForm((p) => ({ ...p, contactName: e.target.value }))} placeholder="예) 홍길동" className={fieldCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">기본 추가수수료 (%)</label>
                  <input type="number" step="0.1" min="0" value={newForm.defaultAdditionalRate ?? ""} onChange={(e) => setNewForm((p) => ({ ...p, defaultAdditionalRate: e.target.value !== "" ? Number(e.target.value) : null }))} placeholder="예) 2.5" className={fieldCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">이메일</label>
                <input type="email" value={newForm.email || ""} onChange={(e) => setNewForm((p) => ({ ...p, email: e.target.value }))} placeholder="예) contact@company.com" className={fieldCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">전화번호</label>
                  <input value={newForm.phone || ""} onChange={(e) => setNewForm((p) => ({ ...p, phone: e.target.value }))} placeholder="예) 02-1234-5678" className={fieldCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">팩스</label>
                  <input value={newForm.fax || ""} onChange={(e) => setNewForm((p) => ({ ...p, fax: e.target.value }))} className={fieldCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
                <textarea value={newForm.notes || ""} onChange={(e) => setNewForm((p) => ({ ...p, notes: e.target.value }))} rows={2} className={`${fieldCls} resize-none`} />
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button onClick={saveNew} disabled={savingNew || !newForm.companyName.trim()}
                  className="px-5 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 font-medium">
                  {savingNew ? "저장 중..." : "저장"}
                </button>
                {newSaved && <span className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle className="w-4 h-4" />저장됐어요!</span>}
                <button onClick={() => setNewForm({ ...emptySubmission() })} className="text-xs text-gray-400 hover:text-gray-600">초기화</button>
              </div>
            </div>
          </div>
        )}

        {/* 일괄 업로드 */}
        {subTab === "bulk" && <SubmissionUploadTab onSaved={load} />}

        {/* 현재 현황 */}
        {subTab === "current" && (
          loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-xs min-w-[1100px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                    <th className="px-3 py-2 text-left w-36">제약사명</th>
                    <th className="px-1 py-2 text-left">제출처 법인명</th>
                    <th className="px-1 py-2 text-left w-28">담당자명</th>
                    <th className="px-1 py-2 text-right w-20">추가수수료</th>
                    <th className="px-1 py-2 text-left">이메일</th>
                    <th className="px-1 py-2 text-left w-32">전화번호</th>
                    <th className="px-1 py-2 text-left w-28">팩스</th>
                    <th className="px-1 py-2 text-left">비고</th>
                    <th className="px-2 py-2 text-center w-14">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((row) => {
                    const isSaving = inlineSavingName === row.companyName;
                    const isSaved = inlineSavedSet.has(row.companyName);
                    const hasEdits = inlineEdits.has(row.companyName);
                    const inCls = "w-full h-7 px-2 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white";
                    return (
                      <tr
                        key={row.companyName}
                        className={isSaved ? "bg-emerald-50/40" : hasEdits ? "bg-amber-50/30" : "hover:bg-gray-50"}
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !isSaving) {
                            saveInlineRow(row.companyName);
                          }
                        }}
                      >
                        <td className="px-3 py-1.5 font-medium text-gray-900 text-xs whitespace-nowrap">{row.companyName}</td>
                        <td className="px-1 py-1"><input value={getInlineField(row.companyName, "submissionEntity")} onChange={(e) => updateInlineField(row.companyName, "submissionEntity", e.target.value)} className={inCls} /></td>
                        <td className="px-1 py-1"><input value={getInlineField(row.companyName, "contactName")} onChange={(e) => updateInlineField(row.companyName, "contactName", e.target.value)} className={inCls} /></td>
                        <td className="px-1 py-1"><input type="number" step="0.1" min="0" value={getInlineField(row.companyName, "defaultAdditionalRate")} onChange={(e) => updateInlineField(row.companyName, "defaultAdditionalRate", e.target.value)} className={`${inCls} text-right`} placeholder="0" /></td>
                        <td className="px-1 py-1"><input type="email" value={getInlineField(row.companyName, "email")} onChange={(e) => updateInlineField(row.companyName, "email", e.target.value)} className={inCls} /></td>
                        <td className="px-1 py-1"><input value={getInlineField(row.companyName, "phone")} onChange={(e) => updateInlineField(row.companyName, "phone", e.target.value)} className={inCls} /></td>
                        <td className="px-1 py-1"><input value={getInlineField(row.companyName, "fax")} onChange={(e) => updateInlineField(row.companyName, "fax", e.target.value)} className={inCls} /></td>
                        <td className="px-1 py-1"><input value={getInlineField(row.companyName, "notes")} onChange={(e) => updateInlineField(row.companyName, "notes", e.target.value)} className={inCls} /></td>
                        <td className="px-2 py-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                            {isSaved && !isSaving && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                            <button onClick={() => deleteRow(row.companyName)} disabled={deletingName === row.companyName}
                              className="text-gray-300 hover:text-red-500 disabled:opacity-40" title="삭제">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="py-12 text-center text-gray-400 text-sm">
                      {query ? "검색 결과가 없어요." : "등록된 제출처 정보가 없어요."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 담당자별 거래처 등록 현황 탭
// ─────────────────────────────────────────────

interface AdminUserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  bizDocument: string | null;
  bizFileName: string | null;
  hasBizDocument?: boolean;
  approved: boolean;
  createdAt: string;
  userId: string;
  dealerType?: string | null;
  user: { name: string | null; email: string; phone?: string | null };
}

type BizSubTab = "all" | "hospital" | "upper-corp" | "lower-corp";

function BizManagementTab() {
  const [rows, setRows] = useState<AdminUserClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [subTab, setSubTab] = useState<BizSubTab>("all");
  // 삭제 진행 상태 — 동일 행 더블 클릭 방지. 삭제 직전 GET 으로 연결 카운트 받아와서 confirm.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    fetch("/api/user-clients?all=true")
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }
  useEffect(() => { reload(); }, []);

  async function handleDelete(row: AdminUserClient) {
    if (deletingId) return;
    setDeletingId(row.id);
    try {
      // 연결된 보고서/제안서 카운트 미리 받아서 사용자에게 알리기.
      let reportCount = 0, proposalCount = 0;
      try {
        const r = await fetch(`/api/user-clients/${row.id}`);
        if (r.ok) {
          const d = await r.json();
          reportCount = d.reportCount ?? 0;
          proposalCount = d.proposalCount ?? 0;
        }
      } catch { /* 카운트 못 받아도 진행 가능 */ }

      const lines = [
        `정말 삭제할까요?`,
        ``,
        `거래처명: ${row.clientName}`,
        `사업자번호: ${row.bizNumber}`,
        `담당자: ${row.user.name || row.user.email}`,
      ];
      if (reportCount > 0 || proposalCount > 0) {
        lines.push(``, `⚠️ 이 거래처에 연결된 항목:`);
        if (reportCount > 0) lines.push(`  - 처방통계 보고서 ${reportCount}건`);
        if (proposalCount > 0) lines.push(`  - 제안서 ${proposalCount}건`);
        lines.push(`삭제해도 보고서/제안서 자체는 남지만 거래처 연결이 끊깁니다.`);
      }
      if (!confirm(lines.join("\n"))) return;

      const del = await fetch(`/api/user-clients/${row.id}`, { method: "DELETE" });
      if (!del.ok) {
        const err = await del.json().catch(() => ({}));
        alert(`삭제 실패: ${err.error || del.status}`);
        return;
      }
      // 로컬 state 에서도 즉시 제거 (네트워크 reload 동시에).
      setRows((prev) => prev.filter((x) => x.id !== row.id));
      reload();
    } finally {
      setDeletingId(null);
    }
  }

  const SUB_TABS: { key: BizSubTab; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "hospital", label: "병의원(원외)" },
    { key: "upper-corp", label: "상위법인" },
    { key: "lower-corp", label: "하위법인" },
  ];

  const typeFiltered = rows.filter((r) => {
    if (subTab === "hospital") return !r.dealerType;
    if (subTab === "upper-corp") return r.dealerType === "UPPER_CORP";
    if (subTab === "lower-corp") return r.dealerType === "LOWER_CORP";
    return true;
  });

  const filtered = typeFiltered.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (r.user.name || "").toLowerCase().includes(q) ||
      r.user.email.toLowerCase().includes(q) ||
      r.clientName.toLowerCase().includes(q) ||
      r.bizNumber.includes(query)
    );
  });

  const dealerLabel = (type?: string | null) => {
    if (!type) return "병의원(원외)";
    if (type === "UPPER_CORP") return "상위법인";
    if (type === "LOWER_CORP") return "하위법인";
    if (type === "CORPORATION") return "법인";
    if (type === "INDIVIDUAL") return "개인사업자";
    return type;
  };
  const dealerColor = (type?: string | null) => {
    if (!type) return "bg-green-100 text-green-700";
    if (type === "UPPER_CORP") return "bg-indigo-100 text-indigo-700";
    if (type === "LOWER_CORP") return "bg-cyan-100 text-cyan-700";
    return "bg-gray-100 text-gray-600";
  };

  const counts = {
    all: rows.length,
    hospital: rows.filter((r) => !r.dealerType).length,
    "upper-corp": rows.filter((r) => r.dealerType === "UPPER_CORP").length,
    "lower-corp": rows.filter((r) => r.dealerType === "LOWER_CORP").length,
  };

  // 본인 대표 사업자 진단 — 마이페이지 사업자 정보 카드는 dealerType=null 중 가장 오래된 1행만 가져옴.
  // 한 회원이 dealerType=null 행을 여러 개 가지면 마이페이지에선 안 보이는 사업자가 생기고
  // 저장 시 "이미 같은 사업자번호로 등록된 거래처" 오류로 막힘. 이를 자동 감지.
  const mypageDiag = useMemo(() => {
    const byUser = new Map<string, AdminUserClient[]>();
    for (const r of rows) {
      if (r.dealerType != null) continue;
      const list = byUser.get(r.userId) ?? [];
      list.push(r);
      byUser.set(r.userId, list);
    }
    const mypagePrimaryIds = new Set<string>();
    const duplicateUserIds = new Set<string>();
    for (const [uid, list] of byUser.entries()) {
      list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      mypagePrimaryIds.add(list[0].id);
      if (list.length >= 2) duplicateUserIds.add(uid);
    }
    return { mypagePrimaryIds, duplicateUserIds, byUser };
  }, [rows]);

  // 중복 회원 펼침 토글
  const [diagOpen, setDiagOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* 진단 패널 — 본인 대표 사업자 중복 (dealerType=null 행이 한 회원에 2개+) */}
      {mypageDiag.duplicateUserIds.size > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setDiagOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-red-100/50 text-left"
          >
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-bold text-red-800">
                마이페이지 사업자 정보 충돌 — {mypageDiag.duplicateUserIds.size}명 감지
              </div>
              <div className="text-xs text-red-600 mt-0.5">
                같은 회원이 &quot;본인 대표 사업자&quot; 후보 행(병의원 유형) 을 2개 이상 가지고 있어요.
                마이페이지는 그중 가장 오래된 1행만 보여주고, 나머지는 사업자번호 충돌로 저장 안 됨.
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-red-500 transition-transform ${diagOpen ? "rotate-180" : ""}`} />
          </button>
          {diagOpen && (
            <div className="px-4 pb-4 space-y-3 border-t border-red-200 pt-3 bg-red-50/30">
              {Array.from(mypageDiag.byUser.entries())
                .filter(([uid]) => mypageDiag.duplicateUserIds.has(uid))
                .map(([uid, list]) => {
                  const owner = list[0]; // any row has user info
                  return (
                    <div key={uid} className="bg-white border border-red-200 rounded p-3">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-sm font-bold text-gray-900">{owner.user.name || owner.user.email.split("@")[0]}</span>
                        <span className="text-xs text-gray-500">{owner.user.email}</span>
                        <span className="ml-auto text-[10px] text-red-700">중복 {list.length}건</span>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left py-1">거래처명</th>
                            <th className="text-left py-1">사업자번호</th>
                            <th className="text-left py-1">등록일</th>
                            <th className="text-left py-1">상태</th>
                            <th className="text-center py-1 w-12">삭제</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {list.map((r, idx) => (
                            <tr key={r.id} className={idx === 0 ? "bg-green-50/40" : ""}>
                              <td className="py-1.5 font-medium">{r.clientName}</td>
                              <td className="py-1.5 font-mono">{r.bizNumber}</td>
                              <td className="py-1.5 text-gray-500">{new Date(r.createdAt).toLocaleDateString("ko-KR")}</td>
                              <td className="py-1.5">
                                {idx === 0
                                  ? <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold text-[10px]">마이페이지 표시</span>
                                  : <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold text-[10px]">숨김 — 저장 시 충돌</span>}
                              </td>
                              <td className="py-1.5 text-center">
                                <button
                                  onClick={() => handleDelete(r)}
                                  disabled={deletingId === r.id}
                                  title="이 거래처 행 삭제"
                                  className="text-gray-400 hover:text-red-600 disabled:opacity-30 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-red-50"
                                >
                                  {deletingId === r.id
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <Trash2 className="w-3 h-3" />}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              <p className="text-[11px] text-red-700 px-1">
                해결: 어드민에서 불필요한 행을 정리하거나, 회원에게 거래처관리(의료기관) 페이지에서 직접 삭제 안내.
                마이페이지 사업자 정보 수정으로는 이 충돌을 풀 수 없어요.
              </p>
            </div>
          )}
        </div>
      )}

    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">사업자관리 ({rows.length}건)</h2>
          <p className="text-xs text-gray-400 mt-0.5">전체 등록 사업자 정보를 유형별로 확인할 수 있어요.</p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="담당자 / 거래처명 / 사업자번호 검색"
          className="h-9 w-64 border border-gray-200 rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      <div className="flex border-b border-gray-100">
        {SUB_TABS.map((t) => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`text-sm px-5 py-2.5 border-b-2 font-medium transition-colors ${
              subTab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}>
            {t.label} <span className="text-xs opacity-60">({counts[t.key]})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-gray-400 text-sm">해당하는 사업자가 없어요.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <th className="px-4 py-3 text-left">거래처명</th>
                <th className="px-4 py-3 text-left">사업자번호</th>
                <th className="px-4 py-3 text-left">유형</th>
                <th className="px-4 py-3 text-left">담당자</th>
                <th className="px-4 py-3 text-left">이메일</th>
                <th className="px-4 py-3 text-center">승인</th>
                <th className="px-4 py-3 text-center">등록일</th>
                <th className="px-4 py-3 text-center">삭제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((c) => {
                const isMypagePrimary = mypageDiag.mypagePrimaryIds.has(c.id);
                const isHiddenConflict = !c.dealerType && !isMypagePrimary && mypageDiag.duplicateUserIds.has(c.userId);
                return (
                <tr key={c.id} className={`hover:bg-gray-50 ${isHiddenConflict ? "bg-amber-50/40" : ""}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {c.clientName}
                    {isMypagePrimary && c.dealerType == null && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-semibold align-middle">마이페이지 표시</span>
                    )}
                    {isHiddenConflict && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold align-middle">숨김 — 저장 충돌</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs font-mono">{c.bizNumber}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dealerColor(c.dealerType)}`}>
                      {dealerLabel(c.dealerType)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <p>{c.user.name || "-"}</p>
                    {c.user.phone && <p className="text-xs text-gray-400 mt-0.5">{c.user.phone}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.user.email}</td>
                  <td className="px-4 py-3 text-center">
                    {c.approved
                      ? <span className="text-xs text-green-600 font-medium">승인</span>
                      : <span className="text-xs text-amber-500">미승인</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-400">
                    {new Date(c.createdAt).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleDelete(c)}
                      disabled={deletingId === c.id}
                      title="이 거래처 행 삭제"
                      className="text-gray-400 hover:text-red-600 disabled:opacity-30 inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50"
                    >
                      {deletingId === c.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </div>
  );
}

function UserClientsTab() {
  const [rows, setRows] = useState<AdminUserClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [clientTab, setClientTab] = useState<"approved" | "unapproved">("unapproved");
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/user-clients?all=true");
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  const approvedRows = rows.filter((r) => r.approved);
  const unapprovedRows = rows.filter((r) => !r.approved);
  const baseRows = clientTab === "approved" ? approvedRows : unapprovedRows;

  const filtered = baseRows.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (r.user.name || "").toLowerCase().includes(q) ||
      r.user.email.toLowerCase().includes(q) ||
      r.clientName.toLowerCase().includes(q) ||
      r.bizNumber.includes(query)
    );
  });

  const grouped = new Map<string, { user: AdminUserClient["user"]; clients: AdminUserClient[] }>();
  for (const row of filtered) {
    const prev = grouped.get(row.userId);
    if (prev) prev.clients.push(row);
    else grouped.set(row.userId, { user: row.user, clients: [row] });
  }

  async function toggleApproval(id: string, approved: boolean) {
    setApprovingId(id);
    await fetch(`/api/user-clients?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, approved } : r));
    setApprovingId(null);
  }

  async function downloadDoc(row: AdminUserClient) {
    let href = row.bizDocument;
    if (!href) {
      const res = await fetch(`/api/files/user-client/${row.id}`);
      if (!res.ok) { alert("문서를 불러오지 못했어요."); return; }
      const data = await res.json();
      href = data.bizDocument;
    }
    if (!href) return;
    const a = document.createElement("a");
    a.href = href;
    a.download = row.bizFileName || "bizDocument";
    a.click();
  }

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !uploadingId) return;
    const fr = new FileReader();
    fr.onload = async () => {
      const bizDocument = fr.result as string;
      const res = await fetch(`/api/user-clients?id=${uploadingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bizDocument, bizFileName: file.name }),
      });
      if (res.ok) {
        setRows((prev) => prev.map((r) => r.id === uploadingId ? { ...r, bizFileName: file.name, hasBizDocument: true } : r));
      }
      setUploadingId(null);
    };
    fr.readAsDataURL(file);
  }

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <input ref={uploadRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleDocUpload} />
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">담당자별 거래처 등록 현황 ({rows.length}건)</h2>
          <p className="text-xs text-gray-400 mt-0.5">영업사원이 등록한 거래처를 담당자별로 확인할 수 있어요.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="담당자 / 거래처명 / 사업자번호 검색"
            className="h-9 w-64 border border-gray-200 rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button onClick={load} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />새로고침
          </button>
        </div>
      </div>

      <div className="flex border-b border-gray-100">
        <button
          onClick={() => setClientTab("unapproved")}
          className={`text-sm px-5 py-2.5 border-b-2 font-medium transition-colors ${
            clientTab === "unapproved" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          미승인 거래처 <span className="text-xs opacity-70">({unapprovedRows.length})</span>
        </button>
        <button
          onClick={() => setClientTab("approved")}
          className={`text-sm px-5 py-2.5 border-b-2 font-medium transition-colors ${
            clientTab === "approved" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          승인 거래처 <span className="text-xs opacity-70">({approvedRows.length})</span>
        </button>
      </div>

      {filtered.length === 0 && !query ? (
        <p className="py-12 text-center text-gray-400 text-sm">
          {clientTab === "unapproved" ? "미승인 거래처가 없어요." : "승인된 거래처가 없어요."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <th className="px-4 py-3 text-left">담당자</th>
                <th className="px-4 py-3 text-left">아이디(이메일)</th>
                <th className="px-4 py-3 text-left">거래처명</th>
                <th className="px-4 py-3 text-left">사업자번호</th>
                <th className="px-4 py-3 text-left">구분</th>
                <th className="px-4 py-3 text-left">사업자등록증</th>
                <th className="px-4 py-3 text-center">등록일</th>
                <th className="px-4 py-3 text-center">승인</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Array.from(grouped.values()).map(({ user, clients }) => (
                clients.map((c, idx) => (
                  <tr key={c.id} className="hover:bg-gray-50 align-top">
                    {idx === 0 ? (
                      <>
                        <td rowSpan={clients.length} className="px-4 py-3 font-medium text-gray-900 border-r border-gray-100 bg-gray-50/40">
                          {user.name || "-"}
                          <div className="text-[10px] text-gray-400 font-normal mt-0.5">{clients.length}개 등록</div>
                        </td>
                        <td rowSpan={clients.length} className="px-4 py-3 text-gray-500 text-xs border-r border-gray-100 bg-gray-50/40">{user.email}</td>
                      </>
                    ) : null}
                    <td className="px-4 py-3 text-gray-800">{c.clientName}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs font-mono">{c.bizNumber}</td>
                    <td className="px-4 py-3 text-xs">
                      {c.dealerType ? (
                        <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded text-[10px] font-medium">{c.dealerType}</span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-medium">병의원</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex items-center gap-2">
                        {(c.bizDocument || c.hasBizDocument || c.bizFileName) ? (
                          <button onClick={() => downloadDoc(c)} className="text-blue-600 hover:underline">
                            {c.bizFileName || "다운로드"}
                          </button>
                        ) : <span className="text-gray-300">없음</span>}
                        <button
                          onClick={() => { setUploadingId(c.id); uploadRef.current?.click(); }}
                          className="text-gray-300 hover:text-blue-500 transition-colors"
                          title="사업자등록증 업로드"
                        >
                          <Upload className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400 text-xs whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleApproval(c.id, !c.approved)}
                        disabled={approvingId === c.id}
                        className={`text-xs px-2.5 py-1.5 rounded font-medium transition-colors ${
                          c.approved
                            ? "bg-red-50 text-red-600 hover:bg-red-100"
                            : "bg-green-50 text-green-700 hover:bg-green-100"
                        }`}
                      >
                        {approvingId === c.id ? "..." : c.approved ? "승인취소" : "승인"}
                      </button>
                    </td>
                  </tr>
                ))
              ))}
              {filtered.length === 0 && query && (
                <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm">검색 결과가 없어요.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// API 연동관리 탭
// ─────────────────────────────────────────────

const DB_FIELD_LABELS: Record<string, string> = {
  productName: "제품명", companyName: "제약사명", ingredientName: "성분명",
  insuranceCode: "보험코드", categoryA: "분류A", categoryB: "주성분코드(분류B)",
  price: "약가", bioStatus: "생동/생산", originalDrug: "오리지날/대조약",
  notes: "특이사항", commissionRate: "수수료율", isSettlement: "정산제약사여부",
  "(매핑키)": "(매핑키 — DB 조회용)", "(미사용)": "(저장 안 함)",
};

interface ApiSource {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiPath: string;
  status: "connected" | "manual" | "pending";
  totalCount?: number;
  mapping: { apiField: string; dbField: string; note?: string }[];
}

const KNOWN_SOURCES: ApiSource[] = [
  {
    id: "mfds",
    name: "식약처 의약품 허가정보",
    provider: "식품의약품안전처 (data.go.kr)",
    baseUrl: "https://apis.data.go.kr",
    apiPath: "/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07",
    status: "connected",
    totalCount: 43252,
    mapping: [
      { apiField: "ITEM_NAME", dbField: "productName" },
      { apiField: "ENTP_NAME", dbField: "companyName" },
      { apiField: "EDI_CODE", dbField: "insuranceCode" },
      { apiField: "ITEM_INGR_NAME", dbField: "ingredientName" },
      { apiField: "PRODUCT_TYPE", dbField: "categoryA" },
      { apiField: "SPCLTY_PBLC", dbField: "(미사용)", note: "전문/일반 구분" },
    ],
  },
  {
    id: "hira_atc",
    name: "HIRA ATC코드 매핑목록 (2025)",
    provider: "건강보험심사평가원 (odcloud.kr)",
    baseUrl: "https://api.odcloud.kr",
    apiPath: "/api/15118958/v1/uddi:6753c7f1-65ed-4bbe-9e98-cd6b7b156a92",
    status: "connected",
    totalCount: 21953,
    mapping: [
      { apiField: "주성분코드", dbField: "categoryB" },
      { apiField: "제품코드", dbField: "(매핑키)", note: "insuranceCode 기준으로 매칭" },
      { apiField: "제품명", dbField: "(미사용)" },
      { apiField: "업체명", dbField: "(미사용)" },
      { apiField: "ATC코드", dbField: "(미사용)" },
      { apiField: "ATC코드 명칭", dbField: "(미사용)" },
    ],
  },
  {
    id: "hira_rate",
    name: "HIRA 약가마스터 의약품주성분",
    provider: "건강보험심사평가원 (odcloud.kr)",
    baseUrl: "https://api.odcloud.kr",
    apiPath: "",
    status: "pending",
    mapping: [],
  },
  {
    id: "excel",
    name: "요율표 엑셀 업로드",
    provider: "수동 업로드",
    baseUrl: "",
    apiPath: "",
    status: "manual",
    mapping: [
      { apiField: "분류(A)", dbField: "categoryA" },
      { apiField: "성분명", dbField: "ingredientName" },
      { apiField: "분류(B)", dbField: "categoryB" },
      { apiField: "코드(수수료율)", dbField: "commissionRate" },
      { apiField: "제약사명", dbField: "companyName" },
      { apiField: "생동/생산", dbField: "bioStatus" },
      { apiField: "품목명", dbField: "productName" },
      { apiField: "약가", dbField: "price" },
      { apiField: "오리지날/대조약", dbField: "originalDrug" },
      { apiField: "보험코드", dbField: "insuranceCode" },
      { apiField: "특이사항", dbField: "notes" },
    ],
  },
];

interface PreviewResult {
  format?: string;
  totalCount?: number;
  columns?: string[];
  sample?: Record<string, unknown>[];
  error?: string;
  raw?: string;
}

function ApiSourcesTab() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ mfds: true, hira_atc: true });
  const [testUrl, setTestUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [dbStats, setDbStats] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/medications/sync").then(r => r.json()).then(d => {
      setDbStats({ public: d.publicCount ?? 0, excel: d.excelCount ?? 0 });
    });
    fetch("/api/medications/sync-ingredient-codes").then(r => r.json()).then(d => {
      setDbStats(prev => ({ ...prev, categoryB: d.filled ?? 0, total: d.total ?? 0 }));
    });
  }, []);

  async function handleTest() {
    if (!testUrl.trim()) return;
    setTesting(true); setPreview(null);
    try {
      const res = await fetch("/api/admin/preview-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: testUrl.trim() }),
      });
      setPreview(await res.json());
    } catch (e) {
      setPreview({ error: String(e) });
    } finally { setTesting(false); }
  }

  const statusBadge = (s: ApiSource["status"]) => {
    if (s === "connected") return <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">● 연동됨</span>;
    if (s === "manual") return <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">↑ 수동업로드</span>;
    return <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">○ 미연동</span>;
  };

  return (
    <div className="space-y-4">
      {/* DB 현황 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "공공API 약품", value: dbStats.public ?? "-" },
          { label: "엑셀 업로드 약품", value: dbStats.excel ?? "-" },
          { label: "전체 약품", value: dbStats.total ?? "-" },
          { label: "주성분코드 보유", value: dbStats.categoryB != null ? `${dbStats.categoryB}건` : "-" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{typeof value === "number" ? value.toLocaleString() + "건" : value}</p>
          </div>
        ))}
      </div>

      {/* 소스 카드 목록 */}
      {KNOWN_SOURCES.map((src) => (
        <div key={src.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50"
            onClick={() => setExpanded(p => ({ ...p, [src.id]: !p[src.id] }))}
          >
            <div className="flex items-center gap-3">
              <Database className="w-4 h-4 text-gray-400 shrink-0" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 text-sm">{src.name}</span>
                  {statusBadge(src.status)}
                  {src.totalCount && <span className="text-xs text-gray-400">{src.totalCount.toLocaleString()}건</span>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{src.provider}</p>
              </div>
            </div>
            {expanded[src.id] ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {expanded[src.id] && (
            <div className="border-t border-gray-100 px-5 py-4 space-y-4">
              {/* API URL */}
              {src.baseUrl && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Base URL</p>
                  <code className="text-xs bg-gray-50 border border-gray-200 rounded px-3 py-1.5 block text-gray-700 break-all">{src.baseUrl}</code>
                  {src.apiPath && (
                    <>
                      <p className="text-xs font-semibold text-gray-500 mb-1 mt-2">API Path</p>
                      <code className="text-xs bg-gray-50 border border-gray-200 rounded px-3 py-1.5 block text-gray-700 break-all">{src.apiPath}</code>
                    </>
                  )}
                </div>
              )}

              {/* 컬럼 매핑 */}
              {src.mapping.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">컬럼 매핑 ({src.mapping.length}개 필드)</p>
                  <div className="border border-gray-200 rounded overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500">
                          <th className="px-3 py-2 text-left font-medium">API 필드명</th>
                          <th className="px-3 py-2 text-center font-medium">→</th>
                          <th className="px-3 py-2 text-left font-medium">DB 저장 필드</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-400">비고</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {src.mapping.map((m) => (
                          <tr key={m.apiField} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-blue-700">{m.apiField}</td>
                            <td className="px-3 py-2 text-center text-gray-400">→</td>
                            <td className="px-3 py-2">
                              <span className={`font-medium ${m.dbField.startsWith("(") ? "text-gray-400 italic" : "text-green-700"}`}>
                                {m.dbField.startsWith("(") ? m.dbField : `${m.dbField} (${DB_FIELD_LABELS[m.dbField] ?? m.dbField})`}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-400">{m.note ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {src.status === "pending" && (
                <p className="text-xs text-yellow-700 bg-yellow-50 rounded p-3">
                  API URL을 아래 테스트 도구에 입력하면 컬럼을 확인할 수 있어요.
                </p>
              )}
            </div>
          )}
        </div>
      ))}

      {/* 새 API 테스트 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-gray-500" />
          <h3 className="font-semibold text-gray-800 text-sm">새 API 미리보기 / 컬럼 확인</h3>
        </div>
        <p className="text-xs text-gray-500">API URL을 입력하면 현재 API 키로 연결해서 컬럼명과 샘플 데이터를 보여줍니다.</p>
        <div className="flex gap-2">
          <input
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            placeholder="https://api.odcloud.kr/api/..."
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button onClick={handleTest} disabled={testing || !testUrl.trim()} className="shrink-0">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${testing ? "animate-spin" : ""}`} />
            {testing ? "조회 중..." : "컬럼 확인"}
          </Button>
        </div>

        {preview && (
          <div className="space-y-3">
            {preview.error ? (
              <div className="text-xs text-red-700 bg-red-50 rounded p-3">
                <AlertCircle className="w-3.5 h-3.5 inline mr-1" />{preview.error}
                {preview.raw && <div className="mt-1 font-mono text-gray-500 break-all">{preview.raw}</div>}
              </div>
            ) : (
              <>
                <div className="text-xs text-green-700 bg-green-50 rounded p-3">
                  <CheckCircle className="w-3.5 h-3.5 inline mr-1" />
                  연결 성공 · 형식: <strong>{preview.format}</strong> · 전체 데이터: <strong>{Number(preview.totalCount).toLocaleString()}건</strong>
                </div>

                {preview.columns && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">컬럼 목록 ({preview.columns.length}개)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {preview.columns.map((col) => (
                        <span key={col} className="text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded px-2 py-0.5 font-mono">{col}</span>
                      ))}
                    </div>
                  </div>
                )}

                {preview.sample && preview.sample.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">샘플 데이터 (3건)</p>
                    <div className="overflow-x-auto border border-gray-200 rounded">
                      <table className="text-xs">
                        <thead>
                          <tr className="bg-gray-50">
                            {preview.columns?.map(c => (
                              <th key={c} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {preview.sample.map((row, i) => (
                            <tr key={i}>
                              {preview.columns?.map(c => (
                                <td key={c} className="px-3 py-1.5 whitespace-nowrap text-gray-700">{String(row[c] ?? "-")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 공지사항 관리 탭 ──────────────────────────────────────────────────────────
interface Notice { id: string; title: string; content: string; category: string; isPinned: boolean; showAsPopup: boolean; popupUntil: string | null; createdAt: string; }

function NoticesTab() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("공지");
  const [isPinned, setIsPinned] = useState(false);
  const [showAsPopup, setShowAsPopup] = useState(false);
  const [popupUntil, setPopupUntil] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const r = await fetch("/api/notices");
    const d = await r.json();
    setNotices(Array.isArray(d) ? d : []);
  }
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) { setError("제목과 내용을 입력하세요"); return; }
    setLoading(true); setError("");
    const r = await fetch("/api/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, category, isPinned, showAsPopup, popupUntil: popupUntil || null }),
    });
    if (r.ok) {
      setTitle(""); setContent(""); setIsPinned(false); setCategory("공지");
      setShowAsPopup(false); setPopupUntil("");
      await load();
    } else {
      const d = await r.json();
      setError(d.error || "등록 실패");
    }
    setLoading(false);
  }

  async function remove(id: string) {
    if (!confirm("삭제하시겠습니까?")) return;
    await fetch("/api/notices", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await load();
  }

  async function togglePopup(n: Notice) {
    await fetch(`/api/notices/${n.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showAsPopup: !n.showAsPopup }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      {/* 등록 폼 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-4">공지사항 등록</h3>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28">
              {["공지", "업데이트", "안내", "이벤트"].map((c) => <option key={c}>{c}</option>)}
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-0" />
            <label className="flex items-center gap-1.5 text-sm text-gray-600 whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} className="rounded" />
              필독 고정
            </label>
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="내용"
            rows={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
          <div className="flex gap-4 items-center flex-wrap">
            <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={showAsPopup} onChange={(e) => setShowAsPopup(e.target.checked)} className="rounded" />
              팝업으로 노출
            </label>
            {showAsPopup && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">팝업 종료일:</span>
                <input type="date" value={popupUntil} onChange={e => setPopupUntil(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm" />
                <span className="text-xs text-gray-400">(비워두면 무기한)</span>
              </div>
            )}
          </div>
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "등록 중..." : "공지 등록"}
          </Button>
        </form>
      </div>

      {/* 목록 */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <span className="text-sm font-semibold text-gray-700">등록된 공지사항 ({notices.length}건)</span>
        </div>
        {notices.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">등록된 공지사항이 없습니다.</p>
        ) : (
          notices.map((n) => (
            <div key={n.id} className="border-b border-gray-100 last:border-0 px-5 py-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{n.category}</span>
                  {n.isPinned && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-medium">필독</span>}
                  {n.showAsPopup && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-medium">팝업</span>}
                  <span className="text-sm font-medium text-gray-800 truncate">{n.title}</span>
                </div>
                <p className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleDateString("ko-KR")}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => togglePopup(n)}
                  className={`text-xs px-2 py-1 rounded border ${n.showAsPopup ? "border-orange-300 text-orange-600 hover:border-orange-400" : "border-gray-200 text-gray-400 hover:border-gray-300"}`}>
                  {n.showAsPopup ? "팝업끄기" : "팝업켜기"}
                </button>
                <button onClick={() => remove(n.id)}
                  className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-2 py-1">
                  삭제
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 제출처(법인) 관리 탭
// ─────────────────────────────────────────────

function SubmissionEntityTab() {
  const [rows, setRows] = useState<SubmissionEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editRow, setEditRow] = useState<(SubmissionEntity & { isNew?: boolean }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/submission-entities");
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function save() {
    if (!editRow) return;
    const name = editRow.name.trim();
    if (!name) { alert("법인명은 필수에요."); return; }
    setSaving(true);
    const res = await fetch("/api/admin/submission-entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editRow),
    });
    if (res.ok) {
      const saved: SubmissionEntity = await res.json();
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.name === saved.name);
        return idx >= 0 ? prev.map((r, i) => i === idx ? saved : r) : [...prev, saved].sort((a, b) => a.name.localeCompare(b.name));
      });
      setEditRow(null);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(`저장 실패: ${data.error || "알 수 없는 오류"}`);
    }
    setSaving(false);
  }

  async function deleteRow(name: string) {
    if (!confirm(`"${name}" 제출처를 삭제할까요?`)) return;
    setDeletingName(name);
    await fetch("/api/admin/submission-entities", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRows((prev) => prev.filter((r) => r.name !== name));
    setDeletingName(null);
  }

  const filtered = rows.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return r.name.toLowerCase().includes(q) ||
      (r.contactName || "").toLowerCase().includes(q) ||
      (r.email || "").toLowerCase().includes(q) ||
      (r.phone || "").includes(query);
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">제출처(법인) 관리</h2>
            <p className="text-xs text-gray-400 mt-0.5">필터링 요청을 접수하는 제출처(법인) 정보를 등록·관리합니다. 등록된 법인은 제약사별 제출처 연결 시 드롭다운으로 선택할 수 있어요.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="법인명 · 담당자 · 이메일"
                className="h-8 w-52 border border-gray-200 rounded pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <button onClick={load} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />새로고침
            </button>
            <button
              onClick={() => setEditRow({ name: "", contactName: null, email: null, phone: null, fax: null, notes: null, isNew: true })}
              className="h-8 px-3 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Plus className="w-3 h-3" />신규 등록
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            {query ? "검색 결과가 없어요." : "등록된 제출처가 없어요. 위 \"신규 등록\" 버튼으로 추가해 주세요."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <th className="px-4 py-3 text-left">법인명</th>
                <th className="px-4 py-3 text-left">담당자</th>
                <th className="px-4 py-3 text-left">이메일</th>
                <th className="px-4 py-3 text-left">전화번호</th>
                <th className="px-4 py-3 text-left">팩스</th>
                <th className="px-4 py-3 text-left">비고</th>
                <th className="px-4 py-3 text-center w-[100px]">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => (
                <tr key={r.name} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{r.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.contactName || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-blue-600">{r.email ? <a href={`mailto:${r.email}`} className="hover:underline">{r.email}</a> : <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.phone || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-gray-500">{r.fax || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-gray-500 max-w-[160px] truncate">{r.notes || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditRow({ ...r })}
                        className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
                      >수정</button>
                      <button
                        onClick={() => deleteRow(r.name)}
                        disabled={deletingName === r.name}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 disabled:opacity-40"
                      >{deletingName === r.name ? "..." : "삭제"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editRow && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{editRow.isNew ? "신규 제출처 등록" : `${editRow.name} 수정`}</h3>
              <button onClick={() => setEditRow(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">법인명 <span className="text-red-500">*</span></label>
                <input
                  autoFocus={!!editRow.isNew}
                  value={editRow.name}
                  onChange={(e) => setEditRow((p) => p ? { ...p, name: e.target.value } : p)}
                  disabled={!editRow.isNew}
                  placeholder="예) 동아쏘시오홀딩스"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">담당자명</label>
                <input
                  value={editRow.contactName || ""}
                  onChange={(e) => setEditRow((p) => p ? { ...p, contactName: e.target.value } : p)}
                  placeholder="예) 홍길동"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">이메일</label>
                <input
                  type="email"
                  value={editRow.email || ""}
                  onChange={(e) => setEditRow((p) => p ? { ...p, email: e.target.value } : p)}
                  placeholder="예) contact@company.com"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">전화번호</label>
                  <input
                    value={editRow.phone || ""}
                    onChange={(e) => setEditRow((p) => p ? { ...p, phone: e.target.value } : p)}
                    placeholder="예) 02-1234-5678"
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">팩스</label>
                  <input
                    value={editRow.fax || ""}
                    onChange={(e) => setEditRow((p) => p ? { ...p, fax: e.target.value } : p)}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
                <input
                  value={editRow.notes || ""}
                  onChange={(e) => setEditRow((p) => p ? { ...p, notes: e.target.value } : p)}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setEditRow(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50">취소</button>
              <button
                onClick={save}
                disabled={saving || !editRow.name.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
              >{saving ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface LoginLogEntry {
  id: string;
  email: string;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { name: string | null; role: string; phone: string | null; email: string } | null;
}

function LoginLogsTab() {
  const [logs, setLogs] = useState<LoginLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [successFilter, setSuccessFilter] = useState<"" | "true" | "false">("");

  async function loadLogs(p = page, q = query, success = successFilter) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (q) params.set("q", q);
      if (success) params.set("success", success);
      const res = await fetch(`/api/admin/login-logs?${params}`);
      const data = await res.json();
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadLogs(1); }, []);

  function handleSearch() {
    setPage(1);
    loadLogs(1, query, successFilter);
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-base font-bold text-gray-900 mb-4">로그인 기록</h2>

        {/* 필터 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="이름 · 이메일 · 전화번호 검색"
            className="h-9 px-3 border border-gray-300 rounded-md text-sm w-72"
          />
          <select
            value={successFilter}
            onChange={(e) => setSuccessFilter(e.target.value as "" | "true" | "false")}
            className="h-9 px-3 border border-gray-300 rounded-md text-sm bg-white"
          >
            <option value="">전체</option>
            <option value="true">성공</option>
            <option value="false">실패</option>
          </select>
          <Button size="sm" onClick={handleSearch} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span className="ml-1">조회</span>
          </Button>
          <span className="ml-auto text-xs text-gray-500 self-center">총 {total.toLocaleString()}건</span>
        </div>

        {/* 테이블 */}
        <div className="overflow-auto rounded-lg border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 font-semibold">
              <tr>
                <th className="px-4 py-2.5 text-left">시각</th>
                <th className="px-4 py-2.5 text-left">이름</th>
                <th className="px-4 py-2.5 text-left">이메일</th>
                <th className="px-4 py-2.5 text-left">전화번호</th>
                <th className="px-4 py-2.5 text-left">역할</th>
                <th className="px-4 py-2.5 text-center">결과</th>
                <th className="px-4 py-2.5 text-left">IP</th>
                <th className="px-4 py-2.5 text-left">브라우저</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">기록이 없습니다.</td></tr>
              )}
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString("ko-KR")}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-800 font-medium">{log.user?.name ?? "-"}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{log.email}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{log.user?.phone ?? "-"}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {log.user ? (
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${roleColor[log.user.role] ?? "bg-gray-100 text-gray-600"}`}>
                        {roleLabel[log.user.role] ?? log.user.role}
                      </span>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {log.success
                      ? <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium"><CheckCircle className="w-3.5 h-3.5" />성공</span>
                      : <span className="inline-flex items-center gap-1 text-red-500 text-xs font-medium"><AlertCircle className="w-3.5 h-3.5" />실패</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{log.ip ?? "-"}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 max-w-[200px] truncate" title={log.userAgent ?? ""}>
                    {log.userAgent ? log.userAgent.replace(/\(.*?\)/g, "").trim().slice(0, 60) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 mt-4">
            <button onClick={() => { setPage(p => { const np = Math.max(1, p-1); loadLogs(np); return np; })} } disabled={page === 1}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40">이전</button>
            {Array.from({ length: Math.min(10, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 4, totalPages - 9));
              const p = start + i;
              return (
                <button key={p} onClick={() => { setPage(p); loadLogs(p); }}
                  className={`px-2.5 py-1 text-xs border rounded ${p === page ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"}`}>
                  {p}
                </button>
              );
            })}
            <button onClick={() => { setPage(p => { const np = Math.min(totalPages, p+1); loadLogs(np); return np; })}} disabled={page === totalPages}
              className="px-2 py-1 text-xs border rounded disabled:opacity-40">다음</button>
          </div>
        )}
      </div>
    </div>
  );
}

interface MigrationStatus {
  storageEnabled: boolean;
  remaining: { userDocuments: number; userClients: number; filterRequests: number; prescriptionReports: number };
  totalRemaining: number;
}

function FileMigrationTab() {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function loadStatus() {
    const res = await fetch("/api/admin/migrate-files");
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => { loadStatus(); }, []);

  async function runBatch(all: boolean) {
    setRunning(true);
    try {
      // Keep calling until totalRemaining hits 0 or the user stops
      while (true) {
        const res = await fetch("/api/admin/migrate-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch: 50 }),
        });
        const data = await res.json();
        if (!res.ok) {
          setLog((l) => [`오류: ${data.message || data.error || "실패"}`, ...l]);
          break;
        }
        const moved =
          data.userDocuments.migrated + data.userClients.migrated +
          data.filterRequests.migrated + data.prescriptionReports.migrated;
        const failed =
          data.userDocuments.failed + data.userClients.failed +
          data.filterRequests.failed + data.prescriptionReports.failed;
        setLog((l) => [
          `이전 ${moved}건 · 실패 ${failed}건 · 남은 ${data.totalRemaining}건`,
          ...l,
        ].slice(0, 20));
        setStatus({
          storageEnabled: status?.storageEnabled ?? true,
          remaining: {
            userDocuments: data.userDocuments.remaining,
            userClients: data.userClients.remaining,
            filterRequests: data.filterRequests.remaining,
            prescriptionReports: data.prescriptionReports.remaining,
          },
          totalRemaining: data.totalRemaining,
        });
        if (!all) break;
        if (data.totalRemaining === 0) break;
        if (moved === 0 && failed > 0) break; // avoid infinite loop on persistent failures
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">파일 스토리지 이전</h2>
          <p className="text-xs text-gray-500 mt-1">
            DB에 base64로 저장된 파일들을 Supabase Storage로 옮겨 DB 크기·백업·조회 속도를 개선합니다.
          </p>
        </div>

        {!status ? (
          <div className="text-sm text-gray-400">상태 확인 중...</div>
        ) : !status.storageEnabled ? (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            <p className="font-semibold mb-1">Supabase Storage 연결이 설정되지 않았어요.</p>
            <p className="text-xs">
              Vercel 환경변수에 <code className="bg-white px-1 rounded">SUPABASE_URL</code> 과
              {" "}<code className="bg-white px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> 를 추가한 뒤 Redeploy 해주세요.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <Stat label="회원 서류" value={status.remaining.userDocuments} />
              <Stat label="거래처 서류" value={status.remaining.userClients} />
              <Stat label="필터요청 서류" value={status.remaining.filterRequests} />
              <Stat label="처방 이미지" value={status.remaining.prescriptionReports} />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => runBatch(false)} disabled={running || status.totalRemaining === 0}>
                {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                <span className="ml-1">50건 이전</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => runBatch(true)} disabled={running || status.totalRemaining === 0}>
                전부 이전
              </Button>
              <Button size="sm" variant="ghost" onClick={loadStatus} disabled={running}>
                <RefreshCw className="w-4 h-4" /><span className="ml-1">새로고침</span>
              </Button>
              <span className="ml-auto text-xs text-gray-500">
                남은 {status.totalRemaining.toLocaleString()}건
              </span>
            </div>
          </>
        )}

        {log.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 font-mono max-h-48 overflow-auto">
            {log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900">{value.toLocaleString()}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// BannersTab
// ─────────────────────────────────────────────────────
interface Banner {
  id: string; title: string; subtitle: string | null; description: string | null;
  buttonText: string | null; buttonLink: string | null; imageKey: string | null;
  imageUrl: string | null; bgColor: string | null; order: number; active: boolean;
}

const BG_PRESETS = [
  { label: "파랑", value: "from-blue-900 to-blue-700" },
  { label: "남색", value: "from-slate-800 to-blue-900" },
  { label: "보라", value: "from-indigo-900 to-purple-800" },
  { label: "청록", value: "from-blue-800 to-cyan-700" },
  { label: "초록", value: "from-green-800 to-teal-700" },
  { label: "빨강", value: "from-red-900 to-rose-700" },
];

function BannersTab() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Partial<Banner> & { imageDataUri?: string }>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/admin/banners").then(r => r.json()).catch(() => []);
    setBanners(Array.isArray(r) ? r : []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function startNew() {
    setForm({ active: true, order: banners.length, bgColor: BG_PRESETS[0].value });
    setEditing("new");
  }
  function startEdit(b: Banner) {
    setForm({ ...b });
    setEditing(b.id);
  }
  function cancelEdit() { setEditing(null); setForm({}); }

  function pickImage() { fileRef.current?.click(); }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(f => ({ ...f, imageDataUri: reader.result as string }));
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function save() {
    setSaving(true);
    let imageKey = form.imageKey ?? null;
    if (form.imageDataUri) {
      const up = await fetch("/api/upload/banner-image", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUri: form.imageDataUri }),
      }).then(r => r.json()).catch(() => ({}));
      if (up.key) imageKey = up.key;
    }
    const payload = { title: form.title, subtitle: form.subtitle, description: form.description,
      buttonText: form.buttonText, buttonLink: form.buttonLink, imageKey, bgColor: form.bgColor,
      order: form.order ?? 0, active: form.active !== false };

    if (editing === "new") {
      await fetch("/api/admin/banners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await fetch(`/api/admin/banners/${editing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    setSaving(false);
    cancelEdit();
    load();
  }

  async function toggleActive(b: Banner) {
    await fetch(`/api/admin/banners/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !b.active }) });
    load();
  }
  async function remove(id: string) {
    if (!confirm("배너를 삭제할까요?")) return;
    await fetch(`/api/admin/banners/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">메인 배너 관리</h2>
          <Button size="sm" onClick={startNew}><Plus className="w-4 h-4 mr-1" />배너 추가</Button>
        </div>

        {editing && (
          <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-blue-900">{editing === "new" ? "새 배너" : "배너 수정"}</h3>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="제목 *" value={form.title ?? ""} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="부제목" value={form.subtitle ?? ""} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} />
            <textarea className="w-full border rounded-lg px-3 py-2 text-sm resize-none" rows={2} placeholder="설명 텍스트" value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="flex gap-2">
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="버튼 텍스트" value={form.buttonText ?? ""} onChange={e => setForm(f => ({ ...f, buttonText: e.target.value }))} />
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="버튼 링크 (예: /search)" value={form.buttonLink ?? ""} onChange={e => setForm(f => ({ ...f, buttonLink: e.target.value }))} />
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs text-gray-500 mr-1">배경색:</span>
              {BG_PRESETS.map(p => (
                <button key={p.value} onClick={() => setForm(f => ({ ...f, bgColor: p.value }))}
                  className={`px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r ${p.value} text-white border-2 ${form.bgColor === p.value ? "border-blue-600" : "border-transparent"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <button onClick={pickImage} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50">이미지 선택</button>
              {(form.imageDataUri || form.imageUrl) && <span className="text-xs text-green-600">✓ 이미지 선택됨</span>}
              {(form.imageDataUri || form.imageUrl) && <button onClick={() => setForm(f => ({ ...f, imageDataUri: undefined, imageKey: null, imageUrl: null }))} className="text-xs text-red-400 hover:text-red-600">제거</button>}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
            </div>
            <div className="flex gap-2 items-center">
              <input type="number" className="w-20 border rounded-lg px-3 py-2 text-sm" placeholder="순서" value={form.order ?? 0} onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))} />
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={form.active !== false} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                활성화
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving || !form.title?.trim()}>{saving ? "저장 중…" : "저장"}</Button>
              <Button size="sm" variant="outline" onClick={cancelEdit}>취소</Button>
            </div>
          </div>
        )}

        {loading ? <div className="text-sm text-gray-400">불러오는 중…</div> : banners.length === 0 ? (
          <div className="text-sm text-gray-400 py-6 text-center">등록된 배너가 없어요.</div>
        ) : (
          <div className="space-y-2">
            {banners.map((b) => (
              <div key={b.id} className={`flex items-center gap-3 p-3 rounded-xl border ${b.active ? "border-gray-200" : "border-dashed border-gray-200 opacity-60"}`}>
                <div className={`w-14 h-10 rounded-lg bg-gradient-to-r ${b.bgColor || "from-blue-900 to-blue-700"} flex-shrink-0 overflow-hidden`}>
                  {b.imageUrl && <img src={b.imageUrl} alt="" className="w-full h-full object-cover opacity-60" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{b.title}</div>
                  <div className="text-xs text-gray-400 truncate">{b.subtitle}</div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${b.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{b.active ? "활성" : "비활성"}</span>
                <button onClick={() => toggleActive(b)} className="text-xs text-gray-400 hover:text-blue-600">{b.active ? "끄기" : "켜기"}</button>
                <button onClick={() => startEdit(b)} className="text-xs text-gray-400 hover:text-blue-600">수정</button>
                <button onClick={() => remove(b.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// BoardsTab
// ─────────────────────────────────────────────────────
interface BoardRow {
  id: string; slug: string; name: string; description: string | null;
  type: "TEXT" | "IMAGE" | "MIXED"; order: number; active: boolean;
  _count: { posts: number; editors: number };
}
interface EditorRow { id: string; userId: string; user: { id: string; name: string | null; email: string; role: string } }
interface UserOption { id: string; name: string | null; email: string; role: string }

const BOARD_TYPE_LABELS: Record<string, string> = { TEXT: "글자형", IMAGE: "사진형", MIXED: "글자+사진형" };

function BoardsTab() {
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Partial<BoardRow>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorsBoard, setEditorsBoard] = useState<BoardRow | null>(null);
  const [editors, setEditors] = useState<EditorRow[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState<UserOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/admin/boards").then(r => r.json()).catch(() => []);
    setBoards(Array.isArray(r) ? r : []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function loadEditors(b: BoardRow) {
    setEditorsBoard(b);
    const r = await fetch(`/api/admin/boards/${b.id}/editors`).then(r => r.json()).catch(() => []);
    setEditors(Array.isArray(r) ? r : []);
  }

  async function searchUsers(q: string) {
    if (!q.trim()) { setUserResults([]); return; }
    setSearchLoading(true);
    const r = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}&limit=10`).then(r => r.json()).catch(() => ({}));
    setUserResults(Array.isArray(r.users) ? r.users : []);
    setSearchLoading(false);
  }
  useEffect(() => {
    const t = setTimeout(() => searchUsers(userSearch), 300);
    return () => clearTimeout(t);
  }, [userSearch]);

  async function addEditor(userId: string) {
    if (!editorsBoard) return;
    await fetch(`/api/admin/boards/${editorsBoard.id}/editors`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
    });
    loadEditors(editorsBoard);
    load();
    setUserSearch(""); setUserResults([]);
  }
  async function removeEditor(userId: string) {
    if (!editorsBoard) return;
    await fetch(`/api/admin/boards/${editorsBoard.id}/editors/${userId}`, { method: "DELETE" });
    loadEditors(editorsBoard);
    load();
  }

  function startNew() {
    setForm({ active: true, order: boards.length, type: "MIXED" });
    setEditing("new");
  }
  function startEdit(b: BoardRow) { setForm({ ...b }); setEditing(b.id); }
  function cancelEdit() { setEditing(null); setForm({}); }

  async function save() {
    setSaving(true);
    const payload = { name: form.name, slug: form.slug, description: form.description,
      type: form.type || "MIXED", order: form.order ?? 0, active: form.active !== false };
    if (editing === "new") {
      await fetch("/api/admin/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } else {
      await fetch(`/api/admin/boards/${editing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    setSaving(false); cancelEdit(); load();
  }

  async function remove(id: string) {
    if (!confirm("게시판을 삭제하면 모든 글도 삭제됩니다. 계속할까요?")) return;
    await fetch(`/api/admin/boards/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">게시판 관리</h2>
          <Button size="sm" onClick={startNew}><Plus className="w-4 h-4 mr-1" />게시판 추가</Button>
        </div>

        {editing && (
          <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-blue-900">{editing === "new" ? "새 게시판" : "게시판 수정"}</h3>
            <div className="flex gap-2">
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="게시판 이름 *" value={form.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="슬러그 (URL용, 영문·숫자·-) *" value={form.slug ?? ""} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} />
            </div>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="설명 (선택)" value={form.description ?? ""} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            <div className="flex gap-2 items-center">
              <span className="text-xs text-gray-500">타입:</span>
              {(["TEXT", "IMAGE", "MIXED"] as const).map(t => (
                <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={`px-3 py-1 rounded-full text-xs border ${form.type === t ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600"}`}>
                  {BOARD_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <input type="number" className="w-20 border rounded-lg px-3 py-2 text-sm" placeholder="순서" value={form.order ?? 0} onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))} />
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={form.active !== false} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                활성화
              </label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving || !form.name?.trim() || !form.slug?.trim()}>{saving ? "저장 중…" : "저장"}</Button>
              <Button size="sm" variant="outline" onClick={cancelEdit}>취소</Button>
            </div>
          </div>
        )}

        {/* Editor management panel */}
        {editorsBoard && (
          <div className="mb-5 p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">"{editorsBoard.name}" 편집자 관리</h3>
              <button onClick={() => setEditorsBoard(null)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex gap-2">
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="이름·이메일로 회원 검색" value={userSearch} onChange={e => setUserSearch(e.target.value)} />
              {searchLoading && <span className="text-xs text-gray-400 self-center">검색 중…</span>}
            </div>
            {userResults.length > 0 && (
              <div className="border rounded-lg divide-y bg-white">
                {userResults.map(u => (
                  <div key={u.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex-1 text-sm">{u.name || "이름없음"} <span className="text-gray-400 text-xs">{u.email}</span></div>
                    <button onClick={() => addEditor(u.id)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">편집자 추가</button>
                  </div>
                ))}
              </div>
            )}
            {editors.length === 0 ? (
              <div className="text-sm text-gray-400">등록된 편집자가 없어요. ADMIN은 모든 게시판에 글을 쓸 수 있습니다.</div>
            ) : (
              <div className="space-y-1">
                {editors.map(e => (
                  <div key={e.id} className="flex items-center gap-2 px-3 py-2 bg-white border rounded-lg">
                    <div className="flex-1 text-sm">{e.user.name || "이름없음"} <span className="text-gray-400 text-xs">{e.user.email}</span></div>
                    <button onClick={() => removeEditor(e.userId)} className="text-xs text-red-400 hover:text-red-600">제거</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loading ? <div className="text-sm text-gray-400">불러오는 중…</div> : boards.length === 0 ? (
          <div className="text-sm text-gray-400 py-6 text-center">등록된 게시판이 없어요.</div>
        ) : (
          <div className="space-y-2">
            {boards.map((b) => (
              <div key={b.id} className={`flex items-center gap-3 p-3 rounded-xl border ${b.active ? "border-gray-200" : "border-dashed border-gray-200 opacity-60"}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{b.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{BOARD_TYPE_LABELS[b.type]}</span>
                    <span className="text-[10px] text-gray-400">/boards/{b.slug}</span>
                  </div>
                  <div className="text-xs text-gray-400">글 {b._count.posts}개 · 편집자 {b._count.editors}명</div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${b.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{b.active ? "활성" : "비활성"}</span>
                <button onClick={() => loadEditors(b)} className="text-xs text-gray-400 hover:text-blue-600">편집자</button>
                <button onClick={() => startEdit(b)} className="text-xs text-gray-400 hover:text-blue-600">수정</button>
                <button onClick={() => remove(b.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface CorpRow {
  id: string | null;
  userId: string;
  clientName: string | null;
  bizNumber: string | null;
  dealerType: string | null;
  parentCorpId: string | null;
  approved: boolean | null;
  createdAt: string;
  user: { name: string | null; email: string; phone?: string | null };
  isUserOnly: boolean;
  extraBizCount?: number;
}

function CorpRelationTab() {
  const [allClients, setAllClients] = useState<CorpRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/user-clients?allMembers=true")
      .then((r) => r.json())
      .then((data) => setAllClients(data as CorpRow[]))
      .catch(() => setAllClients([]))
      .finally(() => setLoading(false));
  }, []);

  // only UserClient rows (id !== null) can participate in parent/child hierarchy
  const corps = allClients.filter((c) => !c.isUserOnly);

  const filtered = allClients.filter((c) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      (c.clientName ?? "").toLowerCase().includes(q) ||
      (c.bizNumber ?? "").includes(q) ||
      (c.user.name ?? "").toLowerCase().includes(q) ||
      c.user.email.toLowerCase().includes(q)
    );
  });

  async function patchParent(childId: string | null, parentId: string | null) {
    if (!childId) return;
    setSaving(childId);
    try {
      const res = await fetch(`/api/user-clients?id=${childId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorpId: parentId }),
      });
      if (res.ok) {
        setAllClients((prev) =>
          prev.map((c) => (c.id === childId ? { ...c, parentCorpId: parentId } : c))
        );
        const parentName = parentId ? allClients.find((c) => c.id === parentId)?.clientName : null;
        setToast(parentName ? `상위법인 → ${parentName}` : "상위법인 해제");
        setTimeout(() => setToast(null), 2000);
      }
    } finally {
      setSaving(null);
    }
  }

  const dealerLabel: Record<string, string> = {
    UPPER_CORP: "상위법인", LOWER_CORP: "하위법인", CORPORATION: "법인",
    INDIVIDUAL: "개인사업자", SELF: "자사",
  };
  const dealerColor: Record<string, string> = {
    UPPER_CORP: "bg-purple-100 text-purple-700", LOWER_CORP: "bg-blue-100 text-blue-700",
    CORPORATION: "bg-indigo-100 text-indigo-700", INDIVIDUAL: "bg-orange-100 text-orange-700",
    SELF: "bg-gray-100 text-gray-600",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            상위 하위법인 지정{" "}
            <span className="text-base font-normal text-gray-400">({allClients.length}명)</span>
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">회원 1명당 1행. 사업자 등록된 회원만 상위/하위 법인으로 지정할 수 있어요 (사업자 미등록 회원은 드롭다운에서 비활성).</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="거래처명 / 사업자번호 검색"
            className="pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-72"
          />
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: "1100px" }}>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-600" rowSpan={2}>거래처명</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600" rowSpan={2}>사업자번호</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600" rowSpan={2}>유형</th>
              <th className="text-center px-4 py-2 font-medium text-gray-700 border-l border-gray-200" colSpan={2}>상위법인</th>
              <th className="text-center px-4 py-2 font-medium text-gray-700 border-l border-gray-200" colSpan={2}>하위법인</th>
            </tr>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs border-l border-gray-200 w-36">현황</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs w-44">지정 변경</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs border-l border-gray-200 w-40">현황</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs w-44">지정 추가</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-16 text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  불러오는 중...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-16 text-gray-400">
                  {query ? "검색 결과가 없어요." : "등록된 사업자가 없어요."}
                </td>
              </tr>
            ) : (
              filtered.map((c, idx) => {
                const parent = c.id ? corps.find((x) => x.id === c.parentCorpId) : undefined;
                const children = c.id ? corps.filter((x) => x.parentCorpId === c.id) : [];
                const addableChildren = c.id ? corps.filter((x) => x.id !== c.id && x.parentCorpId !== c.id) : [];
                const isSaving = saving === c.id;
                const isChildSaving = children.some((ch) => saving === ch.id);
                const rowKey = c.id ?? `user-${c.userId}-${idx}`;

                if (c.isUserOnly) {
                  return (
                    <tr key={rowKey} className="hover:bg-gray-50 transition-colors align-middle bg-gray-50/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-700">{c.user.name ?? "(이름 없음)"}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{c.user.phone ?? c.user.email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">—</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-400">사업자 미등록</span>
                      </td>
                      <td className="px-4 py-3 border-l border-gray-100 text-xs text-gray-400">—</td>
                      <td className="px-4 py-3 text-xs text-gray-400">—</td>
                      <td className="px-4 py-3 border-l border-gray-100 text-xs text-gray-400">—</td>
                      <td className="px-4 py-3 text-xs text-gray-400">—</td>
                    </tr>
                  );
                }

                return (
                  <tr key={rowKey} className="hover:bg-gray-50 transition-colors align-middle">
                    {/* 거래처명 */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {c.clientName}
                        {c.extraBizCount && c.extraBizCount > 0 ? (
                          <span className="ml-1 text-xs text-gray-400 font-normal">외 {c.extraBizCount}건</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">{c.user.name} · {c.user.phone ?? c.user.email}</div>
                    </td>
                    {/* 사업자번호 */}
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{c.bizNumber}</td>
                    {/* 유형 */}
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dealerColor[c.dealerType ?? ""] ?? "bg-green-100 text-green-700"}`}>
                        {dealerLabel[c.dealerType ?? ""] ?? "병의원(원외)"}
                      </span>
                    </td>

                    {/* 상위법인 현황 */}
                    <td className="px-4 py-3 border-l border-gray-100">
                      {parent ? (
                        <span className="text-sm font-medium text-purple-700">{parent.clientName}</span>
                      ) : (
                        <span className="text-xs text-gray-400">없음</span>
                      )}
                    </td>
                    {/* 상위법인 지정 변경 */}
                    <td className="px-4 py-3">
                      <select
                        value={c.parentCorpId ?? ""}
                        onChange={(e) => patchParent(c.id, e.target.value || null)}
                        disabled={isSaving}
                        className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-wait"
                      >
                        <option value="">없음</option>
                        {allClients.filter((x) => x.userId !== c.userId).map((x) => (
                          <option
                            key={x.id ?? `user-${x.userId}`}
                            value={x.id ?? ""}
                            disabled={x.isUserOnly}
                          >
                            {x.isUserOnly
                              ? `${x.user.name ?? "(이름 없음)"} (사업자 미등록)`
                              : x.clientName}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* 하위법인 현황 */}
                    <td className="px-4 py-3 border-l border-gray-100">
                      {children.length === 0 ? (
                        <span className="text-xs text-gray-400">없음</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {children.map((ch) => (
                            <span key={ch.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                              {ch.clientName}
                              <button
                                onClick={() => patchParent(ch.id, null)}
                                disabled={saving === ch.id}
                                className="text-blue-400 hover:text-red-500 disabled:opacity-50"
                                title="하위법인 해제"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    {/* 하위법인 지정 추가 */}
                    <td className="px-4 py-3">
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) patchParent(e.target.value, c.id); }}
                        disabled={isChildSaving}
                        className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-wait"
                      >
                        <option value="">+ 추가</option>
                        {allClients
                          .filter((x) => x.userId !== c.userId && x.parentCorpId !== c.id)
                          .map((x) => (
                            <option
                              key={x.id ?? `user-${x.userId}`}
                              value={x.id ?? ""}
                              disabled={x.isUserOnly}
                            >
                              {x.isUserOnly
                                ? `${x.user.name ?? "(이름 없음)"} (사업자 미등록)`
                                : x.clientName}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SyncSheetsButton() {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true); setError(null); setUrl(null);
    try {
      const res = await fetch("/api/admin/sync-sheets", { method: "POST" });
      let data: { url?: string; error?: string };
      try {
        data = await res.json();
      } catch {
        data = { error: `HTTP ${res.status} — 응답이 JSON이 아님 (라우트 미배포 가능성)` };
      }
      if (data.url) setUrl(data.url);
      else setError(data.error ?? "오류 발생");
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <button
        onClick={handleSync}
        disabled={loading}
        className="w-full flex items-center gap-2 text-sm text-emerald-700 hover:text-emerald-900 border border-emerald-200 hover:border-emerald-400 rounded-md px-2.5 py-2 transition-colors disabled:opacity-50"
      >
        <FileSpreadsheet className="w-4 h-4" />
        {loading ? "동기화 중…" : "Google Sheets 동기화"}
      </button>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="block text-center text-xs text-emerald-600 underline truncate px-1"
        >
          시트 열기
        </a>
      )}
      {error && <p className="text-xs text-red-500 px-1">{error}</p>}
    </div>
  );
}

// 제출 트리 — SubmissionRoute.parentUserId 기반 상위↔하위 회원 매핑 시각화.
// 상위회원(법인) 카드 안에 하위회원(영업사원/거래처) 카드 + 그 회원의 매핑(거래처×제약사×제출처) 행 표시.
// "미연결" 섹션은 parentUserId=null 인 매핑 모음.
interface TreeUser { id: string; name: string | null; email: string; isBusinessApproved?: boolean | null }
interface TreeRoute { id: string; clientName: string; companyName: string; submissionEntity: string; active: boolean }
interface TreeChild { owner: TreeUser; routes: TreeRoute[] }
interface TreeParent { parent: TreeUser; childCount: number; routeCount: number; children: TreeChild[] }
interface TreeResponse {
  parents: TreeParent[];
  unlinked: { owners: TreeChild[]; routeCount: number };
  totals: { parentCount: number; routeCount: number; unlinkedRouteCount: number };
}

function SubmissionTreeTab() {
  const [data, setData] = useState<TreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  function refresh() {
    setLoading(true);
    setError("");
    fetch("/api/admin/submission-tree")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d: TreeResponse) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "조회 실패"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { refresh(); }, []);

  function toggleParent(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function expandAll() {
    if (!data) return;
    setExpanded(new Set([...data.parents.map((p) => p.parent.id), "__unlinked__"]));
  }
  function collapseAll() { setExpanded(new Set()); }

  // 검색 — 상위회원, 하위회원, 거래처/제약사/제출처명 모두 매칭.
  const filteredParents = useMemo(() => {
    if (!data) return [];
    if (!query.trim()) return data.parents;
    const q = query.trim().toLowerCase();
    return data.parents.filter((p) => {
      if ((p.parent.name || "").toLowerCase().includes(q)) return true;
      if (p.parent.email.toLowerCase().includes(q)) return true;
      return p.children.some((c) => {
        if ((c.owner.name || "").toLowerCase().includes(q)) return true;
        if (c.owner.email.toLowerCase().includes(q)) return true;
        return c.routes.some((r) =>
          r.clientName.toLowerCase().includes(q) ||
          r.companyName.toLowerCase().includes(q) ||
          r.submissionEntity.toLowerCase().includes(q)
        );
      });
    });
  }, [data, query]);

  const filteredUnlinked = useMemo(() => {
    if (!data) return [];
    if (!query.trim()) return data.unlinked.owners;
    const q = query.trim().toLowerCase();
    return data.unlinked.owners.filter((c) => {
      if ((c.owner.name || "").toLowerCase().includes(q)) return true;
      if (c.owner.email.toLowerCase().includes(q)) return true;
      return c.routes.some((r) =>
        r.clientName.toLowerCase().includes(q) ||
        r.companyName.toLowerCase().includes(q) ||
        r.submissionEntity.toLowerCase().includes(q)
      );
    });
  }, [data, query]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Network className="w-5 h-5 text-indigo-500" />
        <h1 className="text-2xl font-bold text-gray-900">제출 트리</h1>
      </div>
      <p className="text-sm text-gray-500">
        상위회원(법인) ↔ 하위회원(영업사원/거래처) ↔ 매핑(거래처×제약사×제출처) 관계를 한눈에 봅니다.
        매핑은 회원 통계제출처에서 등록한 SubmissionRoute 입니다.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={refresh} disabled={loading}
          className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> 새로고침
        </button>
        <button onClick={expandAll} disabled={!data || loading}
          className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
          모두 펼치기
        </button>
        <button onClick={collapseAll} disabled={!data || loading}
          className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
          모두 접기
        </button>
        <div className="relative ml-auto">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="회원/거래처/제약사/제출처 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="text-xs pl-7 pr-2 py-1.5 border border-gray-300 rounded w-64 focus:outline-none focus:border-blue-400"
          />
        </div>
        {data && (
          <div className="text-xs text-gray-500 px-2">
            상위 {data.totals.parentCount}명 · 매핑 {data.totals.routeCount}건
            {data.totals.unlinkedRouteCount > 0 && <span className="text-amber-600"> · 미연결 {data.totals.unlinkedRouteCount}건</span>}
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">{error}</div>}

      {loading && !data ? (
        <div className="text-center py-12 text-gray-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 트리 로딩 중...
        </div>
      ) : !data ? null : (
        <div className="space-y-3">
          {filteredParents.length === 0 && filteredUnlinked.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              {query ? "검색 결과가 없어요." : "등록된 제출처가 없어요."}
            </div>
          )}

          {filteredParents.map((p) => {
            const isOpen = expanded.has(p.parent.id);
            return (
              <div key={p.parent.id} className="bg-white border border-gray-200 rounded-lg">
                <button
                  onClick={() => toggleParent(p.parent.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
                >
                  <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-semibold">상위</span>
                    <span className="text-sm font-bold text-gray-900 truncate">{p.parent.name || p.parent.email.split("@")[0]}</span>
                    <span className="text-xs text-gray-500 truncate">{p.parent.email}</span>
                    {p.parent.isBusinessApproved && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px]">사업자</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
                    <span>하위 {p.childCount}명</span>
                    <span className="text-gray-300">·</span>
                    <span>매핑 {p.routeCount}건</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-gray-50/50">
                    {p.children.map((c) => (
                      <div key={c.owner.id} className="bg-white border border-gray-200 rounded">
                        <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] font-semibold">하위</span>
                          <span className="text-sm font-semibold text-gray-900">{c.owner.name || c.owner.email.split("@")[0]}</span>
                          <span className="text-xs text-gray-500">{c.owner.email}</span>
                          <span className="ml-auto text-[10px] text-gray-400">{c.routes.length}건</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {c.routes.map((r) => (
                            <div key={r.id} className="px-3 py-1.5 grid grid-cols-12 gap-2 text-xs items-center">
                              <span className="col-span-4 text-gray-800 truncate" title={r.clientName}>{r.clientName}</span>
                              <span className="col-span-1 text-gray-300 text-center">→</span>
                              <span className="col-span-3 text-gray-700 truncate" title={r.companyName}>{r.companyName}</span>
                              <span className="col-span-3 text-indigo-700 font-medium truncate" title={r.submissionEntity}>{r.submissionEntity}</span>
                              <span className="col-span-1 text-right">
                                {r.active
                                  ? <span className="px-1 py-0.5 rounded bg-green-50 text-green-700 text-[10px]">활성</span>
                                  : <span className="px-1 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">비활성</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* 미연결 매핑 — parentUserId=null. ADMIN 이 상위 지정을 안 했거나 자유 입력으로만 등록된 케이스. */}
          {filteredUnlinked.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-lg">
              <button
                onClick={() => toggleParent("__unlinked__")}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-50/50 text-left"
              >
                <ChevronRight className={`w-4 h-4 text-amber-500 transition-transform ${expanded.has("__unlinked__") ? "rotate-90" : ""}`} />
                <div className="flex items-center gap-2 flex-1 flex-wrap">
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">미연결</span>
                  <span className="text-sm font-bold text-amber-900">상위회원 미지정</span>
                  <span className="text-xs text-amber-700">— 자유 입력으로만 등록된 매핑</span>
                </div>
                <div className="text-xs text-amber-700 shrink-0">
                  {filteredUnlinked.length}명 · 매핑 {filteredUnlinked.reduce((s, c) => s + c.routes.length, 0)}건
                </div>
              </button>

              {expanded.has("__unlinked__") && (
                <div className="border-t border-amber-100 px-4 py-3 space-y-3 bg-amber-50/30">
                  {filteredUnlinked.map((c) => (
                    <div key={c.owner.id} className="bg-white border border-amber-200 rounded">
                      <div className="px-3 py-2 border-b border-amber-100 flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{c.owner.name || c.owner.email.split("@")[0]}</span>
                        <span className="text-xs text-gray-500">{c.owner.email}</span>
                        <span className="ml-auto text-[10px] text-gray-400">{c.routes.length}건</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {c.routes.map((r) => (
                          <div key={r.id} className="px-3 py-1.5 grid grid-cols-12 gap-2 text-xs items-center">
                            <span className="col-span-4 text-gray-800 truncate" title={r.clientName}>{r.clientName}</span>
                            <span className="col-span-1 text-gray-300 text-center">→</span>
                            <span className="col-span-3 text-gray-700 truncate" title={r.companyName}>{r.companyName}</span>
                            <span className="col-span-3 text-amber-700 truncate" title={r.submissionEntity}>{r.submissionEntity}</span>
                            <span className="col-span-1 text-right">
                              {r.active
                                ? <span className="px-1 py-0.5 rounded bg-green-50 text-green-700 text-[10px]">활성</span>
                                : <span className="px-1 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px]">비활성</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
