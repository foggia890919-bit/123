"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Hospital, Plus, Search, CheckCircle, Clock, Trash2, Loader2, Upload, X, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BizLayout } from "../page";

type ModalStep = "biz" | "checking" | "found" | "form" | "saving";

interface Client {
  id: string;
  clientName: string;
  bizNumber: string;
  bizFileName?: string;
  approved: boolean;
  createdAt: string;
}

function formatBiz(n: string) {
  const d = n.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  return n;
}

export default function BizClientsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  // modal
  const [modal, setModal] = useState(false);
  const [step, setStep] = useState<ModalStep>("biz");
  const [bizNumberInput, setBizNumberInput] = useState("");
  const [foundClient, setFoundClient] = useState<{ clientName: string } | null>(null);
  const [clientName, setClientName] = useState("");
  const [bizFile, setBizFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") { router.push("/"); return; }
    fetch("/api/user-clients")
      .then((r) => r.json())
      .then((d) => setClients(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, [session, status, router]);

  function openModal() {
    setStep("biz"); setBizNumberInput(""); setFoundClient(null);
    setClientName(""); setBizFile(null); setFormError(""); setModal(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleBizCheck() {
    const raw = bizNumberInput.replace(/\D/g, "");
    if (raw.length < 10) { setFormError("사업자번호 10자리를 입력해주세요."); return; }
    setFormError(""); setStep("checking");
    const res = await fetch(`/api/user-clients?bizNumber=${raw}`);
    const d = await res.json();
    if (d.found) {
      setFoundClient(d.client);
      setStep("found");
    } else {
      setStep("form");
    }
  }

  async function handleAdd() {
    setFormError("");
    if (!clientName.trim()) { setFormError("병의원명을 입력해주세요."); return; }
    setStep("saving");
    let bizDocument: string | null = null;
    let bizFileName: string | null = null;
    if (bizFile) {
      bizFileName = bizFile.name;
      bizDocument = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.readAsDataURL(bizFile!);
      });
    }
    const res = await fetch("/api/user-clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientName: clientName.trim(), bizNumber: bizNumberInput.trim(), bizDocument, bizFileName }),
    });
    if (res.ok) {
      const row = await res.json();
      setClients((p) => [row, ...p]);
      setModal(false);
    } else {
      const d = await res.json();
      setFormError(d.error ?? "등록 실패");
      setStep("form");
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`"${name}"을(를) 삭제할까요?`)) return;
    await fetch(`/api/user-clients?id=${id}`, { method: "DELETE" });
    setClients((p) => p.filter((c) => c.id !== id));
  }

  const filtered = clients.filter(
    (c) => c.clientName.includes(query) || c.bizNumber.includes(query)
  );

  return (
    <BizLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">병·의원 등록/관리</h2>
            <p className="text-xs text-gray-500 mt-0.5">거래처 병의원을 등록하고 관리합니다</p>
          </div>
          <button
            onClick={openModal}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            병의원 추가
          </button>
        </div>

        {/* 검색 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="병의원명 또는 사업자번호 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>

        {/* 목록 */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
            {query ? "검색 결과가 없습니다" : "등록된 병의원이 없습니다"}
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto] text-xs font-semibold text-gray-500 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <span>병의원명</span>
              <span className="text-center w-32">사업자번호</span>
              <span className="text-center w-20">상태</span>
              <span className="w-8" />
            </div>
            <div className="divide-y divide-gray-50">
              {filtered.map((c) => (
                <div key={c.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                      <Hospital className="w-4 h-4 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                      {c.bizFileName && <p className="text-xs text-gray-400">{c.bizFileName}</p>}
                    </div>
                  </div>
                  <span className="text-sm text-gray-500 w-32 text-center">{formatBiz(c.bizNumber)}</span>
                  <div className="w-20 flex justify-center">
                    {c.approved ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                        <CheckCircle className="w-3.5 h-3.5" /> 승인
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-yellow-600 font-medium">
                        <Clock className="w-3.5 h-3.5" /> 대기
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(c.id, c.clientName)}
                    className="w-8 flex justify-end text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 text-right">
          총 {filtered.length}개 {query && `(전체 ${clients.length}개 중)`}
        </p>
      </div>

      {/* 등록 모달 */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">병의원 등록</h2>
              <button onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-600">사업자번호 *</label>
                <div className="flex gap-2">
                  <input
                    value={bizNumberInput}
                    onChange={(e) => {
                      setBizNumberInput(e.target.value);
                      if (step === "found" || step === "form") setStep("biz");
                      setFormError("");
                    }}
                    placeholder="000-00-00000"
                    disabled={step === "checking" || step === "saving"}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                    onKeyDown={(e) => e.key === "Enter" && step === "biz" && handleBizCheck()}
                  />
                  <button
                    onClick={handleBizCheck}
                    disabled={step === "checking" || step === "saving" || !bizNumberInput.trim()}
                    className="px-3 py-2 text-sm font-medium bg-gray-800 hover:bg-gray-700 text-white rounded-lg disabled:opacity-40 whitespace-nowrap flex items-center gap-1.5"
                  >
                    {step === "checking" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    조회
                  </button>
                </div>
                {formError && step !== "form" && <p className="text-xs text-red-600">{formError}</p>}
              </div>

              {step === "found" && foundClient && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800">이미 등록된 사업자번호입니다</p>
                    <p className="text-xs text-amber-700 mt-0.5">{foundClient.clientName}</p>
                  </div>
                </div>
              )}

              {(step === "form" || step === "saving") && (
                <>
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    <p className="text-xs text-green-700">등록 가능한 사업자번호입니다</p>
                  </div>

                  {formError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{formError}</p>}

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-600">병의원명 *</label>
                    <input
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="병의원명 입력"
                      disabled={step === "saving"}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-600">사업자등록증 (선택)</label>
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="flex items-center gap-2.5 border border-dashed border-gray-300 rounded-lg px-3 py-2.5 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
                    >
                      <Upload className="w-4 h-4 text-gray-400 shrink-0" />
                      <p className={`text-xs truncate ${bizFile ? "text-blue-600 font-medium" : "text-gray-400"}`}>
                        {bizFile ? bizFile.name : "파일 선택 (PDF, 이미지)"}
                      </p>
                      {bizFile && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setBizFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                          className="ml-auto text-gray-300 hover:text-red-400 shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
                        onChange={(e) => setBizFile(e.target.files?.[0] ?? null)} />
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button onClick={() => setModal(false)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                취소
              </button>
              {(step === "form" || step === "saving") && (
                <button onClick={handleAdd} disabled={step === "saving"}
                  className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                  {step === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  등록
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </BizLayout>
  );
}
