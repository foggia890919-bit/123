"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Building2, Plus, Trash2, FileText, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import RequireRole from "@/components/RequireRole";

interface UserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  bizFileName: string | null;
  approved: boolean | null;
  createdAt: string;
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
  const [file, setFile] = useState<File | null>(null);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [bizError, setBizError] = useState("");
  const [dupChecked, setDupChecked] = useState<"none" | "checking" | "ok" | "dup">("none");

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

    const digits = formatted.replace(/\D/g, "");
    if (digits.length === 10) {
      if (!validateBizNumber(formatted)) {
        setBizError("유효하지 않은 사업자등록번호예요.");
        return;
      }
      setDupChecked("checking");
      const res = await fetch(`/api/user-clients?bizNumber=${digits}`);
      const data = await res.json();
      setDupChecked(data.found ? "dup" : "ok");
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
      body: JSON.stringify({ clientName: name.trim(), bizNumber: digits, bizDocument, bizFileName }),
    });
    if (res.ok) {
      const created: UserClient = await res.json();
      setClients((prev) => [created, ...prev]);
      setName(""); setBiz(""); setFile(null); setDupChecked("none");
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
                  {dupChecked === "checking" && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
                  {dupChecked === "ok" && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />}
                  {dupChecked === "dup" && <XCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />}
                </div>
                {bizError && <p className="text-xs text-red-500">{bizError}</p>}
                {dupChecked === "dup" && !bizError && <p className="text-xs text-red-500">이미 등록된 사업자번호예요.</p>}
                {dupChecked === "ok" && <p className="text-xs text-green-600">사용 가능한 사업자번호예요. ✓</p>}
              </div>
            </div>

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
              disabled={registering || dupChecked === "dup" || !!bizError}
              className="w-full"
            >
              {registering
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />등록 중...</>
                : <><Plus className="w-4 h-4 mr-2" />거래처 등록</>}
            </Button>
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
                  <Building2 className="w-4 h-4 text-gray-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{c.clientName}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{c.bizNumber}</p>
                  </div>
                  {c.bizFileName && (
                    <span className="text-xs text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded shrink-0">
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
