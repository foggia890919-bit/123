"use client";

import { useState, useEffect, useRef } from "react";
import { Building2, Filter, X, Upload, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import RequireAuth from "@/components/RequireAuth";
import { useSession } from "next-auth/react";

interface Company { name: string; isSettlement: boolean; count: number; }

export default function FilterPage() {
  const { data: session } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clientName, setClientName] = useState("");
  const [bizNumber, setBizNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/medications/companies").then((r) => r.json()).then(setCompanies);
  }, []);

  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  function toggleCompany(name: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }

  function formatBizNumber(v: string) {
    const d = v.replace(/\D/g, "");
    if (d.length <= 3) return d;
    if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 10)}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (selected.size === 0) { setError("제약사를 1개 이상 선택해주세요."); return; }
    if (!clientName || !bizNumber) { setError("거래처명과 사업자등록번호를 입력해주세요."); return; }

    setLoading(true);
    let bizDocument = null, bizFileName = null;
    if (file) {
      bizDocument = await new Promise<string>((res) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => res(reader.result as string);
      });
      bizFileName = file.name;
    }

    const res = await fetch("/api/filter-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: session!.user.id,
        userName: session!.user.name || session!.user.email,
        clientName, bizNumber, bizDocument, bizFileName,
        companies: Array.from(selected),
      }),
    });

    if (res.ok) {
      setSuccess(true);
      setSelected(new Set()); setClientName(""); setBizNumber(""); setFile(null);
    } else {
      const d = await res.json();
      setError(d.error || "요청 중 오류가 발생했어요.");
    }
    setLoading(false);
  }

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Filter className="w-6 h-6 text-blue-600" />제약사 필터링
          </h1>
          <p className="text-gray-500 text-sm mt-1">제약사를 선택하고 거래처 정보를 입력하면 관리자가 거래 가능 여부를 확인해드립니다</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* 제약사 목록 */}
          <div className="md:col-span-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">제약사 목록 ({companies.length}개)</span>
                {selected.size > 0 && (
                  <button onClick={() => setSelected(new Set())} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                    <X className="w-3 h-3" />선택 해제
                  </button>
                )}
              </div>
              <Input value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} placeholder="제약사 검색..." className="h-8 text-xs" />
            </div>
            <div className="overflow-y-auto max-h-[500px] divide-y divide-gray-50">
              {filteredCompanies.map((company) => (
                <label key={company.name} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selected.has(company.name)} onChange={() => toggleCompany(company.name)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600" />
                  <span className="flex-1 text-sm text-gray-800 truncate">{company.name}</span>
                  {company.isSettlement && <span className="text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded shrink-0">정산</span>}
                </label>
              ))}
            </div>
          </div>

          {/* 거래처 정보 입력 */}
          <div className="md:col-span-2 space-y-4">
            {success ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center space-y-2">
                <p className="text-green-700 font-semibold text-lg">조회 요청이 등록됐어요!</p>
                <p className="text-green-600 text-sm">관리자가 확인 후 회신드릴게요.</p>
                <button onClick={() => setSuccess(false)} className="mt-3 text-sm text-green-700 border border-green-300 px-4 py-2 rounded-lg hover:bg-green-100">
                  새 요청하기
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                <h2 className="font-semibold text-gray-800">거래처 정보 입력</h2>

                {selected.size > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between w-full mb-1">
                    <span className="text-xs text-gray-500">선택된 제약사 ({selected.size}개)</span>
                    <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                      <X className="w-3 h-3" />전체 제거
                    </button>
                  </div>
                    {Array.from(selected).map((name) => (
                      <span key={name} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-full">
                        <Building2 className="w-3 h-3" />{name}
                        <button type="button" onClick={() => toggleCompany(name)} className="hover:text-red-500 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">거래처명 <span className="text-red-500">*</span></label>
                  <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="거래처 상호명" required />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">사업자등록번호 <span className="text-red-500">*</span></label>
                  <Input value={bizNumber} onChange={(e) => setBizNumber(formatBizNumber(e.target.value))}
                    placeholder="000-00-00000" maxLength={12} required />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">사업자등록증 <span className="text-gray-400 font-normal">(선택)</span></label>
                  <div onClick={() => fileRef.current?.click()}
                    className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${file ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}>
                    <Upload className="w-5 h-5 text-gray-400 mx-auto mb-1" />
                    <p className="text-sm text-gray-500">{file ? <span className="font-medium text-gray-800">{file.name}</span> : "클릭해서 파일 첨부"}</p>
                    <p className="text-xs text-gray-400 mt-0.5">JPG, PNG, PDF 지원</p>
                    <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </div>
                </div>

                {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

                <Button type="submit" className="w-full" disabled={loading || selected.size === 0}>
                  <Send className="w-4 h-4 mr-2" />
                  {loading ? "요청 중..." : `${selected.size}개 제약사 조회 등록`}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
