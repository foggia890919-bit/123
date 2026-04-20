"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle, AlertCircle, ShieldCheck, Users, Percent, Download, FileSpreadsheet, Filter, Database, ChevronDown, ChevronUp, Plus, RefreshCw, LogOut, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Tab = "upload" | "members" | "rates" | "filterReqs" | "userClients" | "apiSources";

interface UserDoc { id: string; docType: string; fileName: string; fileData: string; }
interface User {
  id: string; email: string; name: string | null;
  role: string; approved: boolean; createdAt: string;
  phone?: string | null; carrier?: string | null;
  documents?: UserDoc[];
}

const roleLabel: Record<string, string> = {
  ADMIN: "관리자", SALES_REP: "영업사원", DOCTOR: "의사", PHARMACIST: "약사",
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
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-7 h-7 text-gray-800" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">관리자 대시보드</h1>
            <p className="text-gray-500 text-sm">데이터 및 회원 관리</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-red-600 border border-gray-200 hover:border-red-300 rounded-md px-3 py-1.5 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {([
          { key: "upload", label: "요율표 업로드", icon: Upload },
          { key: "apiSources", label: "API 연동관리", icon: Database },
          { key: "members", label: "회원관리", icon: Users },
          { key: "rates", label: "추가수수료 관리", icon: Percent },
          { key: "filterReqs", label: "영업사원 필터링요청", icon: Filter },
          { key: "userClients", label: "담당자별 거래처 등록 현황", icon: Building2 },
        ] as { key: Tab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === "upload" && <UploadTab />}
      {tab === "members" && <MembersTab />}
      {tab === "rates" && <RatesTab />}
      {tab === "filterReqs" && <FilterReqsTab />}
      {tab === "userClients" && <UserClientsTab />}
      {tab === "apiSources" && <ApiSourcesTab />}
    </div>
  );
}

function UploadTab() {
  const [file, setFile] = useState<File | null>(null);
  const [isSettlement, setIsSettlement] = useState(true);
  const [settlementType, setSettlementType] = useState<"원외" | "원내">("원외");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; count?: number; updated?: number; created?: number; skipped?: number; error?: string } | null>(null);
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
        <div className="flex items-center gap-2">
          <input type="checkbox" id="settlement" checked={isSettlement}
            onChange={(e) => setIsSettlement(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
          <label htmlFor="settlement" className="text-sm text-gray-700">정산 가능 제약사 요율표로 등록</label>
        </div>
        {isSettlement && (
          <div className="flex items-center gap-4 pl-6 p-2 bg-gray-50 rounded">
            <span className="text-xs text-gray-600 font-medium">정산 분류:</span>
            {(["원외", "원내"] as const).map((t) => (
              <label key={t} className="flex items-center gap-1.5 cursor-pointer text-sm">
                <input type="radio" name="settlementType" checked={settlementType === t}
                  onChange={() => setSettlementType(t)} className="w-4 h-4 text-blue-600" />
                <span className={settlementType === t ? "font-semibold text-blue-700" : "text-gray-600"}>{t}</span>
              </label>
            ))}
            <span className="text-xs text-gray-400">이 요율표의 약품들을 해당 분류로 저장합니다</span>
          </div>
        )}
      </div>
      <Button onClick={handleUpload} disabled={!file || loading} className="w-full bg-gray-800 hover:bg-gray-700">
        {loading ? "업로드 중..." : "업로드"}
      </Button>
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
                <td className="px-4 py-3 text-center"><Badge variant="secondary">{roleLabel[user.role] || user.role}</Badge></td>
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
  const [loading, setLoading] = useState(true);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => { fetchReqs(); }, []);

  async function fetchReqs() {
    setLoading(true);
    const res = await fetch("/api/filter-request");
    setReqs(await res.json());
    setLoading(false);
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

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-800">영업사원 필터링 요청 ({reqs.length}건)</h2>
        <p className="text-xs text-gray-400 mt-0.5">영업사원이 요청한 제약사 거래 조회 현황입니다.</p>
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
              <th className="px-4 py-3 text-center">요청일</th>
              <th className="px-4 py-3 text-center">상태</th>
              <th className="px-4 py-3 text-left min-w-[280px]">회신</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {reqs.map((req) => {
              const statusOpt = statusOptions.find((s) => s.value === req.status) || statusOptions[0];
              const draft = replyDraft[req.id] ?? "";
              return (
                <tr key={req.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-3 font-medium text-gray-900">{req.user.name || req.userName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{req.user.email}</td>
                  <td className="px-4 py-3 text-gray-700">{req.clientName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">{req.bizNumber}</td>
                  <td className="px-4 py-3 text-gray-800">{req.companyName}</td>
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
            {reqs.length === 0 && <tr><td colSpan={8} className="py-12 text-center text-gray-400 text-sm">요청 내역이 없어요.</td></tr>}
          </tbody>
        </table>
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
