"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Building2, Plus, Trash2, FileText, CheckCircle2, XCircle, Loader2, MapPin, Download, Upload, Users, ChevronDown, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import RequireRole from "@/components/RequireRole";
import * as XLSX from "xlsx";

interface UserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  address?: string | null;
  bizFileName: string | null;
  approved: boolean | null;
  createdAt: string;
  dealerType?: string | null;
  isPublic?: boolean;
  parentCorpId?: string | null;
  companies?: string[];
}

interface CorpItem {
  id: string;
  clientName: string;
  bizNumber: string;
}

function validateBizNumber(biz: string): boolean {
  const d = biz.replace(/\D/g, "");
  if (d.length !== 10) return false;
  const n = d.split("").map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += n[i] * w[i];
  sum += Math.floor(n[8] * 5 / 10);
  return (10 - (sum % 10)) % 10 === n[9];
}

function formatBizNumber(v: string) {
  const d = v.replace(/\D/g, "");
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 10)}`;
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["거래처명", "사업자등록번호", "주소"],
    ["용인삼성내과", "3152305342", "경기도 용인시 수지구 풍덕천로 123"],
    ["서울메디컬", "1234567890", "서울시 강남구 테헤란로 456"],
  ]);
  ws["!cols"] = [{ wch: 20 }, { wch: 16 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws, "거래처목록");
  XLSX.writeFile(wb, "거래처_대량등록_템플릿.xlsx");
}

export default function SubClientsPage() {
  const { data: session } = useSession();
  const [clients, setClients] = useState<UserClient[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState<"all" | "upper" | "lower">("all");
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [editingAddressVal, setEditingAddressVal] = useState("");

  // 탭
  const [tab, setTab] = useState<"single" | "bulk">("single");

  // 단일 등록 — 법인구분 + 상대방 법인 선택
  const [dealerType, setDealerType] = useState<"upper" | "lower" | "">("");
  const [counterpartId, setCounterpartId] = useState<string>("");  // 선택된 상대방 법인 ID
  const [isPublic, setIsPublic] = useState<boolean>(true);
  const [name, setName] = useState("");
  const [biz, setBiz] = useState("");
  const [address, setAddress] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [bizError, setBizError] = useState("");
  const [dupChecked, setDupChecked] = useState<"none" | "checking" | "ok" | "dup">("none");

  // 공개 상위법인 목록 (하위법인 등록 시 부모 선택용)
  const [publicUpperCorps, setPublicUpperCorps] = useState<CorpItem[]>([]);

  // 대량 등록
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ created: number; skipped: number; skippedNames: string[]; errors: string[] } | null>(null);
  const [bulkError, setBulkError] = useState("");

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/dealer")
      .then((r) => r.json())
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .finally(() => setListLoading(false));
    fetch("/api/user-clients?publicUpperCorps=true")
      .then((r) => r.json())
      .then((data) => setPublicUpperCorps(Array.isArray(data) ? data : []));
  }, [session?.user?.id]);

  // 법인구분 변경 시 상대방 선택·폼 초기화
  useEffect(() => {
    setCounterpartId("");
    setName("");
    setBiz("");
    setAddress("");
    setBizError("");
    setDupChecked("none");
    setError("");
    // 상위법인은 검색가능(공개) 기본 ON
    setIsPublic(dealerType === "upper");
  }, [dealerType]);

  // 상대방 법인 목록
  // · 하위법인 등록 시 → 공개된 상위법인 목록
  // · 상위법인 등록 시 → 내가 등록한 하위법인 목록
  const counterpartList: CorpItem[] =
    dealerType === "lower"
      ? publicUpperCorps
      : dealerType === "upper"
      ? clients
          .filter((c) => c.dealerType === "LOWER_CORP")
          .map((c) => ({ id: c.id, clientName: c.clientName, bizNumber: c.bizNumber }))
      : [];

  const counterpartLabel = dealerType === "lower" ? "상위법인 선택" : "하위법인 선택";

  // 상대방 드롭다운에서 선택 시 → 폼 자동완성
  async function handleCounterpartSelect(id: string) {
    setCounterpartId(id);
    if (!id) {
      setName("");
      setBiz("");
      setBizError("");
      setDupChecked("none");
      return;
    }
    const corp = counterpartList.find((c) => c.id === id);
    if (!corp) return;
    setName(corp.clientName);
    await handleBizChange(corp.bizNumber);
  }

  async function handleBizChange(val: string) {
    const formatted = formatBizNumber(val);
    setBiz(formatted);
    setBizError("");
    setDupChecked("none");
    const digits = formatted.replace(/\D/g, "");
    if (digits.length === 10) {
      if (!validateBizNumber(formatted)) { setBizError("유효하지 않은 사업자등록번호예요."); return; }
      setDupChecked("checking");
      const res = await fetch(`/api/user-clients?bizNumber=${digits}`);
      const data = await res.json();
      if (data.found) { setDupChecked("dup"); return; }
      setDupChecked("ok");
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!dealerType) { setError("법인 구분을 선택해주세요."); return; }
    if (!name.trim() || !biz.trim()) { setError("거래처명과 사업자번호를 입력해주세요."); return; }
    if (bizError) { setError(bizError); return; }
    if (dupChecked === "dup") { setError("이미 등록된 사업자번호예요."); return; }
    const digits = biz.replace(/\D/g, "");
    if (!validateBizNumber(digits)) { setError("유효하지 않은 사업자등록번호예요."); return; }
    setRegistering(true);
    let bizDocument: string | null = null, bizFileName: string | null = null;
    if (file) {
      bizDocument = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
      });
      bizFileName = file.name;
    }
    const res = await fetch("/api/user-clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientName: name.trim(),
        bizNumber: digits,
        address: address.trim() || null,
        bizDocument,
        bizFileName,
        dealerType: dealerType === "upper" ? "UPPER_CORP" : "LOWER_CORP",
        isPublic: dealerType === "upper" ? isPublic : false,
        parentCorpId: dealerType === "lower" && counterpartId ? counterpartId : null,
      }),
    });
    if (res.ok) {
      const created: UserClient = await res.json();
      setClients((prev) => [created, ...prev]);
      setName(""); setBiz(""); setAddress(""); setFile(null);
      setDupChecked("none"); setDealerType(""); setCounterpartId(""); setIsPublic(true);
      // 공개 상위법인 목록 갱신
      if (dealerType === "upper" && isPublic) {
        fetch("/api/user-clients?publicUpperCorps=true")
          .then((r) => r.json())
          .then((data) => setPublicUpperCorps(Array.isArray(data) ? data : []));
      }
    } else {
      const d = await res.json();
      setError(d.error || "등록 중 오류가 발생했어요.");
    }
    setRegistering(false);
  }

  async function handleBulkUpload() {
    if (!bulkFile) return;
    setBulkUploading(true); setBulkError(""); setBulkResult(null);
    const form = new FormData();
    form.append("file", bulkFile);
    const res = await fetch("/api/user-clients/bulk", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) { setBulkError(data.error ?? "업로드 실패"); }
    else {
      setBulkResult(data);
      setBulkFile(null);
      fetch("/api/dealer").then((r) => r.json()).then((d) => setClients(Array.isArray(d) ? d : []));
    }
    setBulkUploading(false);
  }

  async function handleDelete(id: string, clientName: string) {
    if (!confirm(`"${clientName}" 거래처를 삭제할까요?`)) return;
    const res = await fetch(`/api/user-clients?id=${id}`, { method: "DELETE" });
    if (res.ok) setClients((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleTogglePublic(id: string, current: boolean) {
    const res = await fetch(`/api/dealer?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: !current }),
    });
    if (res.ok) {
      setClients((prev) => prev.map((c) => c.id === id ? { ...c, isPublic: !current } : c));
      fetch("/api/user-clients?publicUpperCorps=true")
        .then((r) => r.json())
        .then((data) => setPublicUpperCorps(Array.isArray(data) ? data : []));
    }
  }

  async function handleSaveAddress(id: string) {
    const res = await fetch(`/api/user-clients?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: editingAddressVal.trim() || null }),
    });
    if (res.ok) {
      setClients((prev) => prev.map((c) => c.id === id ? { ...c, address: editingAddressVal.trim() || null } : c));
      setEditingAddressId(null);
    }
  }

  const filteredClients = clients.filter((c) =>
    clientFilter === "all" ? true :
    clientFilter === "upper" ? c.dealerType === "UPPER_CORP" :
    c.dealerType === "LOWER_CORP"
  );

  const canRegister = !!dealerType && !!name.trim() && !!biz.trim() && !bizError && dupChecked !== "dup" && !registering;

  return (
    <RequireRole minRole="BASIC">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-purple-600" />거래처관리(사업자)
          </h1>
          <p className="text-gray-500 text-sm mt-1">상위법인·하위법인을 등록하고 관리합니다.</p>
        </div>

        {/* 등록 폼 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* 탭 */}
          <div className="flex border-b border-gray-100">
            {(["single", "bulk"] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(""); setBulkResult(null); setBulkError(""); }}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  tab === t ? "text-orange-600 border-b-2 border-orange-500 bg-orange-50/30" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t === "single" ? "단일 등록" : "대량 등록"}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === "single" ? (
              <form onSubmit={handleRegister} className="space-y-3">
                {/* ① 법인구분 + 상대방 법인 선택 (항상 최상단) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-gray-600">법인 구분 <span className="text-red-500">*</span></label>
                  <div className="flex gap-2">
                    {/* 법인 유형 */}
                    <div className="relative flex-1">
                      <select
                        value={dealerType}
                        onChange={(e) => setDealerType(e.target.value as "upper" | "lower" | "")}
                        className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white pr-8"
                      >
                        <option value="">선택해주세요</option>
                        <option value="upper">상위법인</option>
                        <option value="lower">하위법인</option>
                      </select>
                      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>

                    {/* 상대방 법인 선택 (하위법인 → 상위법인 선택 / 상위법인 → 하위법인 선택) */}
                    {dealerType && (
                      <div className="relative flex-1">
                        <select
                          value={counterpartId}
                          onChange={(e) => handleCounterpartSelect(e.target.value)}
                          className="w-full appearance-none border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white pr-8"
                        >
                          <option value="">신규등록</option>
                          {counterpartList.map((c) => (
                            <option key={c.id} value={c.id}>{c.clientName}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {counterpartLabel}
                          {counterpartList.length === 0 && " — 없음"}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 상위법인 공개 여부 토글 */}
                {dealerType === "upper" && (
                  <div className="flex items-center justify-between bg-purple-50 border border-purple-100 rounded-lg px-3 py-2.5">
                    <div>
                      <p className="text-xs font-medium text-purple-800">상위법인 공개여부 (검색가능)</p>
                      <p className="text-[10px] text-purple-500 mt-0.5">공개 시 타 담당자가 하위법인 등록 시 선택 가능합니다</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsPublic((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${isPublic ? "bg-purple-500" : "bg-gray-300"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isPublic ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                )}

                {/* ② 거래처 정보 입력 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">거래처명 <span className="text-red-500">*</span></label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="상호명"
                      disabled={!dealerType}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">사업자등록번호 <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Input
                        value={biz}
                        onChange={(e) => handleBizChange(e.target.value)}
                        placeholder="000-00-00000"
                        maxLength={12}
                        disabled={!dealerType}
                        className={
                          bizError || dupChecked === "dup"
                            ? "border-red-400 pr-9"
                            : dupChecked === "ok"
                            ? "border-green-400 pr-9"
                            : "pr-9"
                        }
                      />
                      {dupChecked === "checking" && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
                      {dupChecked === "ok"  && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
                      {dupChecked === "dup" && <XCircle     className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />}
                    </div>
                    {bizError && <p className="text-xs text-red-500">{bizError}</p>}
                    {dupChecked === "dup" && !bizError && (
                      <div className="flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />기존처 — 이미 등록된 거래처예요
                      </div>
                    )}
                    {dupChecked === "ok" && <p className="text-xs text-green-600">신규 등록 가능 ✓</p>}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">주소 <span className="text-gray-400 font-normal">(선택)</span></label>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="예: 서울시 강남구 테헤란로 123" disabled={!dealerType} />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">사업자등록증 <span className="text-gray-400 font-normal">(선택)</span></label>
                  <label className="flex items-center gap-2 border border-dashed border-gray-300 rounded-lg p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                    <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-500 truncate flex-1">{file ? file.name : "파일 첨부 (JPG, PNG, PDF)"}</span>
                    {file && <button type="button" onClick={(e) => { e.preventDefault(); setFile(null); }} className="text-xs text-gray-400 hover:text-red-500">제거</button>}
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </label>
                </div>

                {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

                <Button type="submit" disabled={!canRegister} className="w-full">
                  {registering ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />등록 중...</> : <><Plus className="w-4 h-4 mr-2" />거래처 등록</>}
                </Button>
                {!dealerType && <p className="text-xs text-center text-gray-400">법인 구분을 선택해야 등록할 수 있어요.</p>}
                {dupChecked === "dup" && <p className="text-xs text-center text-gray-400">기존처는 중복 등록할 수 없어요.</p>}
              </form>
            ) : (
              <div className="space-y-4">
                {/* 템플릿 다운로드 */}
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
                  <Download className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-blue-800">엑셀 템플릿 다운로드</p>
                    <p className="text-xs text-blue-600 mt-0.5">거래처명 · 사업자등록번호 · 주소 컬럼이 포함된 템플릿입니다.</p>
                  </div>
                  <button onClick={downloadTemplate} className="text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-3 py-1.5 transition-colors shrink-0">
                    템플릿 받기
                  </button>
                </div>

                {/* 파일 업로드 */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-600">엑셀 파일 업로드 (.xlsx, .xls)</label>
                  <label className="flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-lg p-5 cursor-pointer hover:border-orange-300 hover:bg-orange-50/30 transition-colors">
                    <Upload className="w-5 h-5 text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      {bulkFile ? (
                        <p className="text-sm text-gray-700 truncate">{bulkFile.name}</p>
                      ) : (
                        <p className="text-sm text-gray-400">파일을 선택하거나 드래그하세요</p>
                      )}
                    </div>
                    {bulkFile && (
                      <button type="button" onClick={(e) => { e.preventDefault(); setBulkFile(null); setBulkResult(null); setBulkError(""); }}
                        className="text-xs text-gray-400 hover:text-red-500 shrink-0">제거</button>
                    )}
                    <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { setBulkFile(e.target.files?.[0] || null); setBulkResult(null); setBulkError(""); }} />
                  </label>
                </div>

                {bulkError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{bulkError}</p>}

                {bulkResult && (
                  <div className="bg-green-50 border border-green-100 rounded-lg p-3 space-y-1">
                    <p className="text-sm font-medium text-green-800">업로드 완료</p>
                    <p className="text-xs text-green-700">신규 등록: {bulkResult.created}개 · 중복 스킵: {bulkResult.skipped}개</p>
                    {bulkResult.skippedNames.length > 0 && (
                      <p className="text-xs text-gray-500">스킵됨: {bulkResult.skippedNames.join(", ")}</p>
                    )}
                    {bulkResult.errors.length > 0 && (
                      <div className="mt-1">
                        {bulkResult.errors.map((e, i) => <p key={i} className="text-xs text-orange-600">{e}</p>)}
                      </div>
                    )}
                  </div>
                )}

                <Button onClick={handleBulkUpload} disabled={!bulkFile || bulkUploading} className="w-full">
                  {bulkUploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />업로드 중...</> : <><Upload className="w-4 h-4 mr-2" />대량 등록</>}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* 등록된 거래처 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">등록된 거래처
              <span className="ml-2 text-sm font-normal text-gray-400">({clients.length}개)</span>
            </h2>
            <div className="flex gap-1">
              {(["all", "upper", "lower"] as const).map((f) => (
                <button key={f} onClick={() => setClientFilter(f)}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${clientFilter === f ? "bg-purple-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                  {f === "all" ? "전체" : f === "upper" ? "상위법인" : "하위법인"}
                </button>
              ))}
            </div>
          </div>

          {listLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : filteredClients.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">아직 등록된 거래처가 없어요</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredClients.map((c) => {
                const parentCorp = c.parentCorpId
                  ? (publicUpperCorps.find((u) => u.id === c.parentCorpId) ?? clients.find((u) => u.id === c.parentCorpId))
                  : null;
                return (
                  <div key={c.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50">
                    {c.dealerType === "UPPER_CORP" ? <Building2 className="w-4 h-4 text-purple-300 shrink-0" /> : <Users className="w-4 h-4 text-blue-300 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{c.clientName}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{c.bizNumber}</p>
                      {parentCorp && (
                        <p className="text-[10px] text-purple-500 mt-0.5 flex items-center gap-0.5">
                          <Building2 className="w-2.5 h-2.5" />{parentCorp.clientName}
                        </p>
                      )}
                      {editingAddressId === c.id ? (
                        <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                          <Input autoFocus value={editingAddressVal} onChange={(e) => setEditingAddressVal(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleSaveAddress(c.id); if (e.key === "Escape") setEditingAddressId(null); }}
                            placeholder="주소 입력" className="h-6 text-xs py-0 px-2" />
                          <button onClick={() => handleSaveAddress(c.id)} className="text-[10px] text-white bg-orange-500 hover:bg-orange-600 rounded px-1.5 py-0.5 shrink-0">저장</button>
                          <button onClick={() => setEditingAddressId(null)} className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0">취소</button>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingAddressId(c.id); setEditingAddressVal(c.address ?? ""); }} className="flex items-center gap-1 mt-0.5 group">
                          <MapPin className="w-3 h-3 text-gray-300 group-hover:text-orange-400 shrink-0" />
                          <span className="text-xs text-gray-500 group-hover:text-orange-500 truncate">
                            {c.address || <span className="text-gray-300">주소 추가</span>}
                          </span>
                        </button>
                      )}
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 border ${c.dealerType === "UPPER_CORP" ? "text-purple-600 bg-purple-50 border-purple-100" : "text-blue-600 bg-blue-50 border-blue-100"}`}>
                      {c.dealerType === "UPPER_CORP" ? "상위법인" : "하위법인"}
                    </span>
                    {c.dealerType === "UPPER_CORP" && (
                      <button
                        onClick={() => handleTogglePublic(c.id, !!c.isPublic)}
                        title={c.isPublic ? "공개 중 — 클릭하면 비공개 전환" : "비공개 — 클릭하면 공개 전환"}
                        className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 transition-colors ${c.isPublic ? "text-green-600 bg-green-50 border-green-200 hover:bg-green-100" : "text-gray-400 bg-gray-50 border-gray-200 hover:bg-gray-100"}`}
                      >
                        {c.isPublic ? "공개 ON" : "공개 OFF"}
                      </button>
                    )}
                    {c.bizFileName && <span className="text-xs text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded shrink-0">서류첨부</span>}
                    <span className="text-xs text-gray-400 shrink-0">{new Date(c.createdAt).toLocaleDateString("ko-KR")}</span>
                    <button onClick={() => handleDelete(c.id, c.clientName)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </RequireRole>
  );
}
