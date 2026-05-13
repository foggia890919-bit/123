"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Building2, Plus, Trash2, FileText, CheckCircle2, XCircle, Loader2, AlertCircle, Stethoscope, Briefcase } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import RequireRole from "@/components/RequireRole";

interface UserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  address?: string | null;
  bizFileName: string | null;
  approved: boolean | null;
  createdAt: string;
  dealerType?: string | null;
  companies?: string[];
}

interface BizVerifyResult {
  valid: boolean | null;
  closed?: boolean;
  statusText?: string;
  taxType?: string;
  taxTypeCd?: string;
  isMedicalLikely?: boolean;
  error?: string;
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

export default function ClientsPage() {
  const { data: session } = useSession();
  const [clients, setClients] = useState<UserClient[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const [name, setName] = useState("");
  const [biz, setBiz] = useState("");
  const [address, setAddress] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dealerType, setDealerType] = useState<"medical" | "business" | null>(null);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [bizError, setBizError] = useState("");
  const [dupChecked, setDupChecked] = useState<"none" | "checking" | "ok" | "dup">("none");
  const [ntsResult, setNtsResult] = useState<BizVerifyResult | null>(null);
  const [ntsLoading, setNtsLoading] = useState(false);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/user-clients")
      .then((r) => r.json())
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .finally(() => setListLoading(false));
  }, [session?.user?.id]);

  async function handleBizChange(val: string) {
    const formatted = formatBizNumber(val);
    setBiz(formatted);
    setBizError("");
    setDupChecked("none");
    setNtsResult(null);
    setDealerType(null);

    const digits = formatted.replace(/\D/g, "");
    if (digits.length === 10) {
      if (!validateBizNumber(formatted)) {
        setBizError("유효하지 않은 사업자등록번호예요.");
        return;
      }

      // Dup check
      setDupChecked("checking");
      const res = await fetch(`/api/user-clients?bizNumber=${digits}`);
      const data = await res.json();
      if (data.found) {
        setDupChecked("dup");
        return;
      }
      setDupChecked("ok");

      // NTS verification
      setNtsLoading(true);
      try {
        const ntsRes = await fetch("/api/biz-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bizNumber: digits }),
        });
        const ntsData: BizVerifyResult = await ntsRes.json();
        setNtsResult(ntsData);
        // Auto-suggest type based on NTS result
        if (ntsData.valid === true) {
          setDealerType(ntsData.isMedicalLikely ? "medical" : "business");
        }
      } catch {
        setNtsResult({ valid: null, error: "국세청 조회 실패" });
      } finally {
        setNtsLoading(false);
      }
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
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
        dealerType: dealerType === "business" ? "BUSINESS" : null,
      }),
    });
    if (res.ok) {
      const created: UserClient = await res.json();
      setClients((prev) => [created, ...prev]);
      setName(""); setBiz(""); setAddress(""); setFile(null); setDupChecked("none");
      setNtsResult(null); setDealerType(null);
    } else {
      const d = await res.json();
      setError(d.error || "등록 중 오류가 발생했어요.");
    }
    setRegistering(false);
  }

  async function handleDelete(id: string, clientName: string) {
    if (!confirm(`"${clientName}" 거래처를 삭제할까요?`)) return;
    const res = await fetch(`/api/user-clients?id=${id}`, { method: "DELETE" });
    if (res.ok) setClients((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <RequireRole minRole="BASIC">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-600" />내 거래처 관리
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            거래처를 등록하면 제약사 필터링·제안서 등 모든 서비스에서 바로 사용할 수 있습니다.
          </p>
        </div>

        {/* 등록 폼 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">새 거래처 등록</h2>
          <form onSubmit={handleRegister} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">
                  거래처명 <span className="text-red-500">*</span>
                </label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="상호명" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">
                  사업자등록번호 <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Input
                    value={biz}
                    onChange={(e) => handleBizChange(e.target.value)}
                    placeholder="000-00-00000"
                    maxLength={12}
                    className={bizError || dupChecked === "dup" ? "border-red-400 pr-9" : dupChecked === "ok" ? "border-green-400 pr-9" : "pr-9"}
                  />
                  {(dupChecked === "checking" || ntsLoading) && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
                  {dupChecked === "ok" && !ntsLoading && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
                  {dupChecked === "dup" && <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />}
                </div>
                {bizError && <p className="text-xs text-red-500">{bizError}</p>}
                {dupChecked === "dup" && !bizError && <p className="text-xs text-red-500">이미 등록된 사업자번호예요.</p>}
                {dupChecked === "ok" && !ntsLoading && !ntsResult && <p className="text-xs text-green-600">사용 가능한 사업자번호예요. ✓</p>}
              </div>
            </div>

            {/* 주소 */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">
                주소 <span className="text-gray-400 font-normal">(선택)</span>
              </label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="예: 서울시 강남구 테헤란로 123" />
            </div>

            {/* NTS 조회 결과 */}
            {ntsResult && dupChecked === "ok" && (
              <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${
                ntsResult.valid === null ? "bg-gray-50 text-gray-500 border border-gray-200" :
                ntsResult.valid === false ? "bg-red-50 text-red-700 border border-red-200" :
                "bg-green-50 text-green-800 border border-green-200"
              }`}>
                {ntsResult.valid === null && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                {ntsResult.valid === false && <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                {ntsResult.valid === true && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
                <div>
                  {ntsResult.valid === null && <p>국세청 조회 불가 — 수동으로 거래처 유형을 선택해주세요.</p>}
                  {ntsResult.valid === false && (
                    <p>
                      {ntsResult.closed ? "폐업된 사업자입니다." : `사업자 상태: ${ntsResult.statusText || "확인 불가"}`}
                    </p>
                  )}
                  {ntsResult.valid === true && (
                    <div>
                      <p className="font-medium">국세청 조회 완료 ✓</p>
                      <p className="text-xs mt-0.5 opacity-80">
                        상태: {ntsResult.statusText} · 과세유형: {ntsResult.taxType}
                        {ntsResult.isMedicalLikely && " · 면세사업자 (의료기관 가능성 높음)"}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 거래처 유형 선택 */}
            {dupChecked === "ok" && !bizError && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">
                  거래처 유형 <span className="text-red-500">*</span>
                  {ntsResult?.isMedicalLikely && <span className="ml-1 text-green-600 font-normal">(국세청 조회 기준 자동 선택됨)</span>}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDealerType("medical")}
                    className={`flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors ${
                      dealerType === "medical"
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 hover:border-gray-300 text-gray-600"
                    }`}
                  >
                    <Stethoscope className="w-4 h-4 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">의료기관</p>
                      <p className="text-xs opacity-70">병의원·약국</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDealerType("business")}
                    className={`flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors ${
                      dealerType === "business"
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 hover:border-gray-300 text-gray-600"
                    }`}
                  >
                    <Briefcase className="w-4 h-4 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">사업자</p>
                      <p className="text-xs opacity-70">도매·법인·기타</p>
                    </div>
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">
                사업자등록증 <span className="text-gray-400 font-normal">(선택)</span>
              </label>
              <label className="flex items-center gap-2 border border-dashed border-gray-300 rounded-lg p-3 cursor-pointer hover:bg-gray-50 transition-colors">
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-sm text-gray-500 truncate flex-1">
                  {file ? file.name : "파일 첨부 (JPG, PNG, PDF)"}
                </span>
                {file && (
                  <button type="button" onClick={(e) => { e.preventDefault(); setFile(null); }}
                    className="text-xs text-gray-400 hover:text-red-500">제거</button>
                )}
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

            <Button
              type="submit"
              disabled={registering || dupChecked === "dup" || !!bizError || !dealerType}
              className="w-full"
            >
              {registering
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />등록 중...</>
                : <><Plus className="w-4 h-4 mr-2" />거래처 등록</>}
            </Button>
            {dupChecked === "ok" && !dealerType && (
              <p className="text-xs text-center text-gray-400">거래처 유형을 선택해야 등록할 수 있어요.</p>
            )}
          </form>
        </div>

        {/* 등록된 거래처 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">등록된 거래처
              <span className="ml-2 text-sm font-normal text-gray-400">({clients.length}개)</span>
            </h2>
          </div>

          {listLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : clients.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">아직 등록된 거래처가 없어요</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {clients.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50">
                  {c.dealerType ? (
                    <Briefcase className="w-4 h-4 text-gray-300 shrink-0" />
                  ) : (
                    <Stethoscope className="w-4 h-4 text-gray-300 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{c.clientName}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{c.bizNumber}</p>
                    {c.address && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{c.address}</p>
                    )}
                    {c.companies && c.companies.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.companies.map((co) => (
                          <span key={co} className="text-[10px] bg-orange-50 text-orange-600 border border-orange-200 rounded-full px-1.5 py-0.5 leading-none">
                            {co}
                          </span>
                        ))}
                      </div>
                    )}
                    {c.companies && c.companies.length === 0 && (
                      <p className="text-[10px] text-gray-300 mt-1">거래 제약사 없음</p>
                    )}
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 border ${
                    c.dealerType
                      ? "text-purple-600 bg-purple-50 border-purple-100"
                      : "text-blue-600 bg-blue-50 border-blue-100"
                  }`}>
                    {c.dealerType ? "사업자" : "의료기관"}
                  </span>
                  {c.bizFileName && (
                    <span className="text-xs text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded shrink-0">
                      서류첨부
                    </span>
                  )}
                  <span className="text-xs text-gray-400 shrink-0">
                    {new Date(c.createdAt).toLocaleDateString("ko-KR")}
                  </span>
                  <button
                    onClick={() => handleDelete(c.id, c.clientName)}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </RequireRole>
  );
}
