"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle, AlertCircle, ShieldCheck, Users, Percent, Download, FileSpreadsheet, Filter, Database, ChevronDown, ChevronUp, Plus, RefreshCw, LogOut, Building2, Search, X, Mail, Phone, Send, Inbox, Copy, MessageCircle } from "lucide-react";
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

type Tab = "upload" | "submissionUpload" | "members" | "rates" | "filterReqs" | "userClients" | "apiSources" | "notices" | "companySubmissions" | "bulkSubmit" | "submissionEntities";

interface MenuItem { key: Tab; label: string; icon: React.ElementType }
interface MenuGroup { title: string; items: MenuItem[] }

const MENU_GROUPS: MenuGroup[] = [
  {
    title: "데이터 관리",
    items: [
      { key: "upload", label: "요율표 업로드", icon: Upload },
      { key: "submissionUpload", label: "제출처 일괄 업로드", icon: FileSpreadsheet },
      { key: "apiSources", label: "API 연동관리", icon: Database },
    ],
  },
  {
    title: "회원 & 거래처",
    items: [
      { key: "members", label: "회원관리", icon: Users },
      { key: "rates", label: "추가수수료 관리", icon: Percent },
      { key: "userClients", label: "담당자별 거래처", icon: Building2 },
      { key: "submissionEntities", label: "제출처(법인) 관리", icon: Inbox },
    ],
  },
  {
    title: "필터링 요청",
    items: [
      { key: "filterReqs", label: "요청 내역", icon: Filter },
      { key: "bulkSubmit", label: "제약사별 일괄제출", icon: Send },
      { key: "companySubmissions", label: "제약사 제출처 관리", icon: Inbox },
    ],
  },
  {
    title: "콘텐츠",
    items: [
      { key: "notices", label: "공지사항 관리", icon: FileSpreadsheet },
    ],
  },
];

interface UserDoc { id: string; docType: string; fileName: string; fileData: string; }
interface User {
  id: string; email: string; name: string | null;
  role: string; approved: boolean; createdAt: string;
  phone?: string | null; carrier?: string | null;
  documents?: UserDoc[];
}

const roleLabel: Record<string, string> = {
  ADMIN: "관리자", SALES_REP: "영맨회원", BIZ: "비즈회원", BASIC: "일반회원", DOCTOR: "의사", PHARMACIST: "약사",
};
const roleColor: Record<string, string> = {
  BASIC: "bg-gray-100 text-gray-600",
  SALES_REP: "bg-blue-100 text-blue-700",
  BIZ: "bg-purple-100 text-purple-700",
  ADMIN: "bg-red-100 text-red-700",
  DOCTOR: "bg-green-100 text-green-700",
  PHARMACIST: "bg-teal-100 text-teal-700",
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("upload");

  useEffect(() => {
    if (localStorage.getItem("isAdmin") !== "true") router.push("/admin/login");
  }, [router]);

  function handleLogout() {
    localStorage.removeItem("isAdmin");
    router.push("/admin/login");
  }

  return (
    <div className="flex gap-6 max-w-7xl mx-auto">
      <aside className="w-56 shrink-0 space-y-6 sticky top-4 self-start">
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
                    onClick={() => setTab(key)}
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
      </aside>

      <main className="flex-1 min-w-0 space-y-4">
        {tab === "upload" && <UploadTab />}
        {tab === "submissionUpload" && <SubmissionUploadTab />}
        {tab === "notices" && <NoticesTab />}
        {tab === "members" && <MembersTab />}
        {tab === "rates" && <RatesTab />}
        {tab === "filterReqs" && <FilterReqsTab />}
        {tab === "bulkSubmit" && <BulkSubmissionTab />}
        {tab === "companySubmissions" && <CompanySubmissionsTab />}
        {tab === "userClients" && <UserClientsTab />}
        {tab === "submissionEntities" && <SubmissionEntityTab />}
        {tab === "apiSources" && <ApiSourcesTab />}
      </main>
    </div>
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

  async function handleIngredientSync() {
    setMapLoading(true); setMapResult(null);
    try {
      const res = await fetch("/api/medications/sync-ingredient-codes", { method: "POST" });
      setMapResult(await res.json());
    } catch { setMapResult({ error: "동기화 중 오류가 발생했어요." }); }
    finally { setMapLoading(false); }
  }

  useEffect(() => {
    fetch("/api/medications/sync-ingredient-codes")
      .then((r) => r.json())
      .then((d) => setMapResult(d))
      .catch(() => null);
  }, []);

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
      if (data.success) setFile(null);
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
        <div className="flex gap-2">
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

function SubmissionUploadTab() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SubUploadRow[]>([]);
  const [savedSet, setSavedSet] = useState<Set<number>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"preview" | "current">("preview");
  const [current, setCurrent] = useState<CompanySubmission[]>([]);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [previewQuery, setPreviewQuery] = useState("");
  const [currentQuery, setCurrentQuery] = useState("");
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [currentEdits, setCurrentEdits] = useState<Record<string, CompanySubmission>>({});
  const [currentSavingName, setCurrentSavingName] = useState<string | null>(null);
  const [currentSavedSet, setCurrentSavedSet] = useState<Set<string>>(new Set());
  const [newCurrentRow, setNewCurrentRow] = useState<CompanySubmission | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadCurrent(); }, []);

  async function loadCurrent() {
    setLoadingCurrent(true);
    try {
      const res = await fetch("/api/admin/company-submissions");
      const data = await res.json();
      setCurrent(Array.isArray(data) ? data : []);
    } finally { setLoadingCurrent(false); }
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
        setViewTab("preview");
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
        const saved: CompanySubmission = await res.json();
        setSavedSet((prev) => new Set([...prev, idx]));
        setCurrent((prev) => {
          const i = prev.findIndex((s) => s.companyName === saved.companyName);
          return i >= 0 ? prev.map((r, j) => j === i ? saved : r) : [...prev, saved].sort((a, b) => a.companyName.localeCompare(b.companyName));
        });
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
      loadCurrent();
    }
    setBatchSaving(false);
  }

  async function deleteCurrent(companyName: string) {
    if (!confirm(`"${companyName}" 제출처 정보를 삭제할까요?`)) return;
    setDeletingName(companyName);
    await fetch("/api/admin/company-submissions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName }),
    });
    setCurrent((prev) => prev.filter((r) => r.companyName !== companyName));
    setDeletingName(null);
  }

  function updateCurrentField(companyName: string, field: keyof CompanySubmission, value: string) {
    const base = currentEdits[companyName] ?? current.find((r) => r.companyName === companyName) ?? { companyName, submissionEntity: null, contactName: null, email: null, phone: null, fax: null, defaultAdditionalRate: null, notes: null };
    setCurrentEdits((prev) => ({ ...prev, [companyName]: { ...base, [field]: value } }));
    setCurrentSavedSet((prev) => { const n = new Set(prev); n.delete(companyName); return n; });
  }

  function updateNewCurrentField(field: keyof CompanySubmission, value: string) {
    setNewCurrentRow((prev) => prev ? { ...prev, [field]: value } : prev);
  }

  async function saveCurrentRow(companyName: string) {
    const edited = currentEdits[companyName];
    if (!edited) return;
    const name = edited.companyName.trim();
    if (!name) { alert("제약사명은 필수에요."); return; }
    setCurrentSavingName(companyName);
    const res = await fetch("/api/admin/company-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: name,
        submissionEntity: edited.submissionEntity || null,
        contactName: edited.contactName || null,
        email: edited.email || null,
        phone: edited.phone || null,
        fax: edited.fax || null,
        defaultAdditionalRate: edited.defaultAdditionalRate != null && String(edited.defaultAdditionalRate) !== "" ? Number(edited.defaultAdditionalRate) : null,
        notes: edited.notes || null,
      }),
    });
    if (res.ok) {
      const saved: CompanySubmission = await res.json();
      setCurrent((prev) => {
        const idx = prev.findIndex((r) => r.companyName === saved.companyName);
        return idx >= 0 ? prev.map((r, i) => i === idx ? saved : r) : [...prev, saved].sort((a, b) => a.companyName.localeCompare(b.companyName));
      });
      setCurrentEdits((prev) => { const n = { ...prev }; delete n[companyName]; return n; });
      setCurrentSavedSet((prev) => new Set([...prev, name]));
    } else {
      const data = await res.json().catch(() => ({}));
      alert(`저장 실패: ${data.error || "알 수 없는 오류"}`);
    }
    setCurrentSavingName(null);
  }

  async function saveNewCurrentRow() {
    if (!newCurrentRow) return;
    const name = newCurrentRow.companyName.trim();
    if (!name) { alert("제약사명은 필수에요."); return; }
    setCurrentSavingName("__new__");
    const res = await fetch("/api/admin/company-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: name,
        submissionEntity: newCurrentRow.submissionEntity || null,
        contactName: newCurrentRow.contactName || null,
        email: newCurrentRow.email || null,
        phone: newCurrentRow.phone || null,
        fax: newCurrentRow.fax || null,
        defaultAdditionalRate: newCurrentRow.defaultAdditionalRate != null && String(newCurrentRow.defaultAdditionalRate) !== "" ? Number(newCurrentRow.defaultAdditionalRate) : null,
        notes: newCurrentRow.notes || null,
      }),
    });
    if (res.ok) {
      const saved: CompanySubmission = await res.json();
      setCurrent((prev) => [...prev, saved].sort((a, b) => a.companyName.localeCompare(b.companyName)));
      setNewCurrentRow(null);
      setCurrentSavedSet((prev) => new Set([...prev, name]));
    } else {
      const data = await res.json().catch(() => ({}));
      alert(`저장 실패: ${data.error || "알 수 없는 오류"}`);
    }
    setCurrentSavingName(null);
  }

  function downloadTemplate() {
    const sample = [
      { 제약사명: "동아ST", 제출처법인명: "동아쏘시오홀딩스", 담당자: "홍길동", 이메일: "contact@donga.com", 전화번호: "02-1234-5678", 팩스: "02-1234-5679", 추가수수료: "2.5", 비고: "" },
      { 제약사명: "한미약품", 제출처법인명: "", 담당자: "", 이메일: "", 전화번호: "", 팩스: "", 추가수수료: "", 비고: "" },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
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
    ? current.filter((r) => {
        const q = currentQuery.toLowerCase();
        return r.companyName.toLowerCase().includes(q) ||
          (r.submissionEntity || "").toLowerCase().includes(q) ||
          (r.contactName || "").toLowerCase().includes(q) ||
          (r.email || "").toLowerCase().includes(q);
      })
    : current;

  const inputCls = "w-full bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 focus:bg-white rounded px-1.5 py-1 text-xs focus:outline-none transition-colors";

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">제출처 일괄 업로드</h2>
            <p className="text-xs text-gray-400 mt-0.5">엑셀로 업로드한 내용은 아래 미리보기에서 템플릿처럼 수정·저장할 수 있어요.</p>
          </div>
          <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 rounded px-3 py-2">
            <Download className="w-3.5 h-3.5" />양식 내려받기
          </button>
        </div>

        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            file ? "border-blue-400 bg-blue-50/40" : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
          }`}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = ""; }} />
          {file ? (
            <div className="flex items-center justify-center gap-3 text-sm">
              <FileSpreadsheet className="w-6 h-6 text-blue-500" />
              <div className="text-left">
                <div className="font-medium text-blue-700">{file.name}</div>
                <div className="text-xs text-gray-400">{preview.length}행 · 유효 {validCount}{errorRows.length > 0 ? ` · 오류 ${errorRows.length}` : ""} · 저장됨 {savedCount}</div>
              </div>
              <button
                type="button"
                onClick={(ev) => { ev.stopPropagation(); setFile(null); setPreview([]); setResult(null); setSavedSet(new Set()); }}
                className="text-xs text-red-500 hover:text-red-700 ml-2"
              >파일 제거</button>
            </div>
          ) : (
            <div className="space-y-1">
              <Upload className="w-7 h-7 text-gray-300 mx-auto" />
              <p className="text-sm text-gray-500">엑셀 파일을 클릭하거나 끌어다 놓으세요 (.xlsx / .xls)</p>
              <p className="text-[11px] text-gray-400">헤더: 제약사명 · 제출처법인명 · 담당자 · 이메일 · 전화번호 · 팩스 · 추가수수료 · 비고</p>
            </div>
          )}
        </div>

        {parseError && <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2">{parseError}</p>}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 pt-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1">
            <button
              onClick={() => setViewTab("preview")}
              className={`text-sm px-4 py-2 border-b-2 font-medium transition-colors ${
                viewTab === "preview" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              미리보기 <span className="text-xs opacity-70">({preview.length})</span>
            </button>
            <button
              onClick={() => setViewTab("current")}
              className={`text-sm px-4 py-2 border-b-2 font-medium transition-colors ${
                viewTab === "current" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              현재 현황 <span className="text-xs opacity-70">({current.length})</span>
            </button>
          </div>
          {viewTab === "preview" ? (
            <div className="flex items-center gap-2 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  value={previewQuery}
                  onChange={(e) => setPreviewQuery(e.target.value)}
                  placeholder="미리보기 내 검색"
                  className="h-8 w-52 border border-gray-200 rounded pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <button
                onClick={addBlankRow}
                className="text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 rounded px-2 py-1.5 flex items-center gap-1"
              ><Plus className="w-3 h-3" />행 추가</button>
              <button
                onClick={saveAll}
                disabled={batchSaving || validCount === savedCount}
                className="h-8 px-3 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 flex items-center gap-1.5"
              >
                {batchSaving ? <><RefreshCw className="w-3 h-3 animate-spin" />업로드 중...</> : <><Upload className="w-3 h-3" />{Math.max(0, validCount - savedCount)}행 일괄 저장</>}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  value={currentQuery}
                  onChange={(e) => setCurrentQuery(e.target.value)}
                  placeholder="DB 현황 내 검색"
                  className="h-8 w-52 border border-gray-200 rounded pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <button
                onClick={() => { setNewCurrentRow({ companyName: "", submissionEntity: null, contactName: null, email: null, phone: null, fax: null, defaultAdditionalRate: null, notes: null }); setViewTab("current"); }}
                className="text-xs text-gray-600 border border-gray-200 hover:bg-gray-50 rounded px-2 py-1.5 flex items-center gap-1"
              ><Plus className="w-3 h-3" />행 추가</button>
              <button onClick={loadCurrent} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />새로고침
              </button>
            </div>
          )}
        </div>

        {viewTab === "preview" && (
          preview.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">
              엑셀을 업로드하면 이 곳에 템플릿 형태로 표시됩니다. 행마다 바로 수정하고 저장할 수 있어요.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-xs min-w-[1180px]">
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
                          <button
                            onClick={() => saveOne(i)}
                            disabled={hasError || isSaving}
                            className={`text-[11px] px-2 py-1 rounded font-medium ${
                              isSaved
                                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                                : "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"
                            }`}
                          >
                            {isSaving ? "..." : isSaved ? "저장됨 ↻" : "저장"}
                          </button>
                        </td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button onClick={() => deleteRow(i)} className="text-gray-300 hover:text-red-500" title="행 제거">
                            <X className="w-3.5 h-3.5" />
                          </button>
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

        {viewTab === "current" && (
          loadingCurrent ? (
            <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
          ) : current.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">
              아직 등록된 제출처가 없어요. 위에서 엑셀을 업로드하거나 미리보기 탭에서 행을 추가해 주세요.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-xs min-w-[1200px]">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr className="text-gray-500 font-semibold">
                    <th className="px-2 py-2.5 text-left w-[160px]">제약사명 *</th>
                    <th className="px-2 py-2.5 text-left w-[150px]">제출처법인명</th>
                    <th className="px-2 py-2.5 text-left w-[100px]">담당자</th>
                    <th className="px-2 py-2.5 text-left w-[190px]">이메일</th>
                    <th className="px-2 py-2.5 text-left w-[120px]">전화</th>
                    <th className="px-2 py-2.5 text-left w-[110px]">팩스</th>
                    <th className="px-2 py-2.5 text-right w-[80px]">수수료%</th>
                    <th className="px-2 py-2.5 text-left">비고</th>
                    <th className="px-2 py-2.5 text-center w-[90px]">저장</th>
                    <th className="px-2 py-2.5 text-center w-[50px]">삭제</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {newCurrentRow && (
                    <tr className="bg-blue-50/60">
                      <td className="px-1 py-1 align-middle">
                        <input value={newCurrentRow.companyName} onChange={(e) => updateNewCurrentField("companyName", e.target.value)} className={`${inputCls} font-medium text-gray-900`} placeholder="제약사명 (필수)" />
                      </td>
                      <td className="px-1 py-1 align-middle"><input value={newCurrentRow.submissionEntity || ""} onChange={(e) => updateNewCurrentField("submissionEntity", e.target.value)} className={inputCls} /></td>
                      <td className="px-1 py-1 align-middle"><input value={newCurrentRow.contactName || ""} onChange={(e) => updateNewCurrentField("contactName", e.target.value)} className={inputCls} /></td>
                      <td className="px-1 py-1 align-middle"><input type="email" value={newCurrentRow.email || ""} onChange={(e) => updateNewCurrentField("email", e.target.value)} className={inputCls} /></td>
                      <td className="px-1 py-1 align-middle"><input value={newCurrentRow.phone || ""} onChange={(e) => updateNewCurrentField("phone", e.target.value)} className={inputCls} /></td>
                      <td className="px-1 py-1 align-middle"><input value={newCurrentRow.fax || ""} onChange={(e) => updateNewCurrentField("fax", e.target.value)} className={inputCls} /></td>
                      <td className="px-1 py-1 align-middle"><input value={String(newCurrentRow.defaultAdditionalRate ?? "")} onChange={(e) => updateNewCurrentField("defaultAdditionalRate", e.target.value)} className={`${inputCls} text-right font-mono`} placeholder="0" /></td>
                      <td className="px-1 py-1 align-middle"><input value={newCurrentRow.notes || ""} onChange={(e) => updateNewCurrentField("notes", e.target.value)} className={inputCls} /></td>
                      <td className="px-1 py-1 text-center align-middle">
                        <button
                          onClick={saveNewCurrentRow}
                          disabled={currentSavingName === "__new__" || !newCurrentRow.companyName.trim()}
                          className="text-[11px] px-2 py-1 rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400"
                        >{currentSavingName === "__new__" ? "..." : "저장"}</button>
                      </td>
                      <td className="px-1 py-1 text-center align-middle">
                        <button onClick={() => setNewCurrentRow(null)} className="text-gray-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  )}
                  {currentFiltered.map((r) => {
                    const display = currentEdits[r.companyName] ?? r;
                    const hasPending = !!currentEdits[r.companyName];
                    const isSaved = currentSavedSet.has(r.companyName) && !hasPending;
                    const isSaving = currentSavingName === r.companyName;
                    return (
                      <tr key={r.companyName} className={hasPending ? "bg-amber-50/40" : isSaved ? "bg-emerald-50/40" : "hover:bg-gray-50"}>
                        <td className="px-1 py-1 align-middle">
                          <input value={display.companyName} onChange={(e) => updateCurrentField(r.companyName, "companyName", e.target.value)} className={`${inputCls} font-medium text-gray-900`} />
                        </td>
                        <td className="px-1 py-1 align-middle"><input value={display.submissionEntity || ""} onChange={(e) => updateCurrentField(r.companyName, "submissionEntity", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={display.contactName || ""} onChange={(e) => updateCurrentField(r.companyName, "contactName", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input type="email" value={display.email || ""} onChange={(e) => updateCurrentField(r.companyName, "email", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={display.phone || ""} onChange={(e) => updateCurrentField(r.companyName, "phone", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={display.fax || ""} onChange={(e) => updateCurrentField(r.companyName, "fax", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 align-middle"><input value={display.defaultAdditionalRate != null ? String(display.defaultAdditionalRate) : ""} onChange={(e) => updateCurrentField(r.companyName, "defaultAdditionalRate", e.target.value)} className={`${inputCls} text-right font-mono`} placeholder="0" /></td>
                        <td className="px-1 py-1 align-middle"><input value={display.notes || ""} onChange={(e) => updateCurrentField(r.companyName, "notes", e.target.value)} className={inputCls} /></td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button
                            onClick={() => saveCurrentRow(r.companyName)}
                            disabled={!hasPending || isSaving}
                            className={`text-[11px] px-2 py-1 rounded font-medium ${
                              isSaved ? "bg-emerald-100 text-emerald-700" :
                              hasPending ? "bg-blue-600 text-white hover:bg-blue-700" :
                              "bg-gray-100 text-gray-400 cursor-default"
                            }`}
                          >{isSaving ? "..." : isSaved ? "저장됨 ✓" : hasPending ? "저장" : "—"}</button>
                        </td>
                        <td className="px-1 py-1 text-center align-middle">
                          <button
                            onClick={() => deleteCurrent(r.companyName)}
                            disabled={deletingName === r.companyName}
                            className="text-gray-300 hover:text-red-500 disabled:opacity-40"
                          >{deletingName === r.companyName ? <RefreshCw className="w-3 h-3 animate-spin" /> : <X className="w-3.5 h-3.5" />}</button>
                        </td>
                      </tr>
                    );
                  })}
                  {currentFiltered.length === 0 && currentQuery && (
                    <tr><td colSpan={10} className="py-10 text-center text-gray-400 text-sm">검색 결과가 없어요.</td></tr>
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

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    setUsers(await res.json());
    setLoading(false);
  }

  async function changeRole(userId: string, role: string) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, role }) });
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role } : u));
  }

  async function toggleApproval(userId: string, approved: boolean) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, approved }) });
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, approved } : u));
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

  function downloadDoc(doc: UserDoc) {
    const a = document.createElement("a");
    a.href = doc.fileData;
    a.download = doc.fileName;
    a.click();
  }

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">회원 목록 ({users.length}명)</h2>
          <p className="text-xs text-gray-400 mt-0.5">가입 승인 후 서비스를 이용할 수 있어요.</p>
        </div>
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
                <td className="px-4 py-3 font-medium text-gray-900">{user.name || "-"}</td>
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
                    <option value="SALES_REP">영맨회원</option>
                    <option value="BIZ">비즈회원</option>
                    <option value="ADMIN">관리자</option>
                    <option value="DOCTOR">의사</option>
                    <option value="PHARMACIST">약사</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-center text-gray-400 text-xs">{new Date(user.createdAt).toLocaleDateString("ko-KR")}</td>
                <td className="px-4 py-3 text-center">
                  <Badge variant={user.approved ? "success" : "warning"}>{user.approved ? "승인됨" : "대기중"}</Badge>
                </td>
                <td className="px-4 py-3 text-center">
                  {user.documents && user.documents.length > 0 ? (
                    <button onClick={() => setDocUser(user)} className="text-xs text-blue-600 hover:underline">
                      보기 ({user.documents.length})
                    </button>
                  ) : <span className="text-xs text-gray-300">없음</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleApproval(user.id, !user.approved)}
                    className={`text-xs px-2.5 py-1.5 rounded font-medium transition-colors ${user.approved ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>
                    {user.approved ? "취소" : "승인"}
                  </button>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => { setResetUserId(user.id); setNewPw(""); }}
                    className="text-xs px-2.5 py-1.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">
                    초기화
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={9} className="py-12 text-center text-gray-400 text-sm">가입 회원이 없어요.</td></tr>}
          </tbody>
        </table>
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
    fetch("/api/admin/users").then((r) => r.json()).then(setUsers);
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
      fetch("/api/filter-request").then((r) => r.json()),
      fetch("/api/admin/company-submissions").then((r) => r.json()),
    ]);
    setReqs(Array.isArray(r1) ? r1 : []);
    setSubs(new Map(Array.isArray(r2) ? r2.map((s: CompanySubmission) => [s.companyName, s]) : []));
    setLoading(false);
  }

  async function fetchReqs() {
    const res = await fetch("/api/filter-request");
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
        "제출처 담당자": sub?.contactName || "",
        "제출처 이메일": sub?.email || "",
        "제출처 전화": sub?.phone || "",
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
      { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 12 },
      { wch: 18 }, { wch: 10 }, { wch: 40 }, { wch: 18 },
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
      fetch("/api/filter-request").then((r) => r.json()),
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
    const data = rows.map((r) => ({
      거래처명: r.clientName,
      사업자번호: r.bizNumber,
      영업사원명: r.user.name || r.userName,
      아이디: r.user.email,
      요청일: new Date(r.createdAt).toLocaleDateString("ko-KR"),
      상태: statusOptions.find((s) => s.value === r.status)?.label || r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 24 }, { wch: 14 }, { wch: 10 }];
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
  const [rows, setRows] = useState<CompanySubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editRow, setEditRow] = useState<(CompanySubmission & { isNew?: boolean }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/company-submissions");
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function save() {
    if (!editRow) return;
    const name = editRow.companyName.trim();
    if (!name) return;
    setSaving(true);
    const res = await fetch("/api/admin/company-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editRow),
    });
    if (res.ok) {
      const saved: CompanySubmission = await res.json();
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.companyName === saved.companyName);
        return idx >= 0 ? prev.map((r, i) => i === idx ? saved : r) : [...prev, saved].sort((a, b) => a.companyName.localeCompare(b.companyName));
      });
      setEditRow(null);
    }
    setSaving(false);
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

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">제약사 제출처 관리 ({filtered.length}/{rows.length}개)</h2>
            <p className="text-xs text-gray-400 mt-0.5">필터링 요청 시 제약사별 담당자·연락처를 관리합니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="제약사·담당자·이메일·전화번호"
                className="h-9 w-60 border border-gray-200 rounded pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => setEditRow({ ...emptySubmission(), isNew: true })}
              className="h-9 px-3 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />제약사 추가
            </button>
            <button onClick={load} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />새로고침
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <th className="px-4 py-3 text-left">제약사명</th>
                <th className="px-4 py-3 text-left">제출처 법인명</th>
                <th className="px-4 py-3 text-left">담당자명</th>
                <th className="px-4 py-3 text-right">추가수수료</th>
                <th className="px-4 py-3 text-left">이메일</th>
                <th className="px-4 py-3 text-left">전화번호</th>
                <th className="px-4 py-3 text-left">팩스</th>
                <th className="px-4 py-3 text-left">비고</th>
                <th className="px-4 py-3 text-center w-20">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((row) => (
                <tr key={row.companyName} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.companyName}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{row.submissionEntity || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-3 text-gray-700">{row.contactName || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-3 text-right text-xs font-mono text-emerald-600 font-medium">
                    {row.defaultAdditionalRate != null ? `${row.defaultAdditionalRate}%` : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {row.email ? (
                      <a href={`mailto:${row.email}`} className="flex items-center gap-1 text-blue-600 hover:underline">
                        <Mail className="w-3 h-3" />{row.email}
                      </a>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {row.phone ? (
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-gray-400" />{row.phone}</span>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{row.fax || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-[180px] truncate">{row.notes || <span className="text-gray-300">-</span>}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setEditRow({ ...row })}
                        className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
                      >수정</button>
                      <button
                        onClick={() => deleteRow(row.companyName)}
                        disabled={deletingName === row.companyName}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 disabled:opacity-40"
                      >{deletingName === row.companyName ? "..." : "삭제"}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="py-12 text-center text-gray-400 text-sm">
                  {query ? "검색 결과가 없어요." : "등록된 제출처 정보가 없어요. 제약사를 추가해 주세요."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editRow && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{editRow.isNew ? "제약사 제출처 추가" : `${editRow.companyName} 수정`}</h3>
              <button onClick={() => setEditRow(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">제약사명 <span className="text-red-500">*</span></label>
                <input
                  value={editRow.companyName}
                  onChange={(e) => setEditRow((p) => p ? { ...p, companyName: e.target.value } : p)}
                  disabled={!editRow.isNew}
                  placeholder="예) 동아ST"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">제출처 법인명</label>
                <input
                  value={editRow.submissionEntity || ""}
                  onChange={(e) => setEditRow((p) => p ? { ...p, submissionEntity: e.target.value } : p)}
                  placeholder="예) 동아쏘시오홀딩스 (제약사와 다를 때만)"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                  <label className="block text-xs font-medium text-gray-700 mb-1">기본 추가수수료 (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editRow.defaultAdditionalRate ?? ""}
                    onChange={(e) => setEditRow((p) => p ? { ...p, defaultAdditionalRate: e.target.value !== "" ? Number(e.target.value) : null } : p)}
                    placeholder="예) 2.5"
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
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
                    placeholder="예) 02-1234-5679"
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
                <textarea
                  value={editRow.notes || ""}
                  onChange={(e) => setEditRow((p) => p ? { ...p, notes: e.target.value } : p)}
                  placeholder="메모 (선택)"
                  rows={2}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setEditRow(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50">취소</button>
              <button
                onClick={save}
                disabled={saving || !editRow.companyName.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
              >{saving ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        </div>
      )}
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
  approved: boolean;
  createdAt: string;
  userId: string;
  user: { name: string | null; email: string };
}

function UserClientsTab() {
  const [rows, setRows] = useState<AdminUserClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/user-clients?all=true");
    const data = await res.json();
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  const filtered = rows.filter((r) => {
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

  function downloadDoc(row: AdminUserClient) {
    if (!row.bizDocument) return;
    const a = document.createElement("a");
    a.href = row.bizDocument;
    a.download = row.bizFileName || "bizDocument";
    a.click();
  }

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
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

      {rows.length === 0 ? (
        <p className="py-12 text-center text-gray-400 text-sm">등록된 거래처가 없어요.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <th className="px-4 py-3 text-left">담당자</th>
                <th className="px-4 py-3 text-left">아이디(이메일)</th>
                <th className="px-4 py-3 text-left">거래처명</th>
                <th className="px-4 py-3 text-left">사업자번호</th>
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
                      {c.bizDocument ? (
                        <button onClick={() => downloadDoc(c)} className="text-blue-600 hover:underline">
                          {c.bizFileName || "다운로드"}
                        </button>
                      ) : <span className="text-gray-300">없음</span>}
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
                        {approvingId === c.id ? "..." : c.approved ? "취소" : "승인"}
                      </button>
                    </td>
                  </tr>
                ))
              ))}
              {filtered.length === 0 && query && (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400 text-sm">검색 결과가 없어요.</td></tr>
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
interface Notice { id: string; title: string; content: string; category: string; isPinned: boolean; createdAt: string; }

function NoticesTab() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("공지");
  const [isPinned, setIsPinned] = useState(false);
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
      body: JSON.stringify({ title, content, category, isPinned }),
    });
    if (r.ok) {
      setTitle(""); setContent(""); setIsPinned(false); setCategory("공지");
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

  return (
    <div className="space-y-6">
      {/* 등록 폼 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="font-semibold text-gray-800 mb-4">공지사항 등록</h3>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-3">
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28">
              {["공지", "업데이트", "안내", "이벤트"].map((c) => <option key={c}>{c}</option>)}
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <label className="flex items-center gap-1.5 text-sm text-gray-600 whitespace-nowrap cursor-pointer">
              <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} className="rounded" />
              필독 고정
            </label>
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="내용"
            rows={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
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
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{n.category}</span>
                  {n.isPinned && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-medium">필독</span>}
                  <span className="text-sm font-medium text-gray-800 truncate">{n.title}</span>
                </div>
                <p className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleDateString("ko-KR")}</p>
              </div>
              <button onClick={() => remove(n.id)}
                className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-2 py-1 flex-shrink-0">
                삭제
              </button>
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
