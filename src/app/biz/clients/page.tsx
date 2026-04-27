"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Hospital, Plus, Search, CheckCircle, Clock, Trash2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BizLayout } from "../page";

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
  const [showForm, setShowForm] = useState(false);

  // form state
  const [clientName, setClientName] = useState("");
  const [bizNumber, setBizNumber] = useState("");
  const [bizFile, setBizFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!clientName.trim() || !bizNumber.trim()) {
      setFormError("병의원명과 사업자번호를 입력하세요");
      return;
    }
    setSaving(true);
    let bizDocument: string | null = null;
    let bizFileName: string | null = null;
    if (bizFile) {
      bizFileName = bizFile.name;
      bizDocument = await new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.readAsDataURL(bizFile);
      });
    }
    const res = await fetch("/api/user-clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientName: clientName.trim(), bizNumber: bizNumber.trim(), bizDocument, bizFileName }),
    });
    setSaving(false);
    if (res.ok) {
      const row = await res.json();
      setClients((p) => [row, ...p]);
      setClientName(""); setBizNumber(""); setBizFile(null); setShowForm(false);
      if (fileRef.current) fileRef.current.value = "";
    } else {
      const d = await res.json();
      setFormError(d.error ?? "등록 실패");
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
          <Button size="sm" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            병의원 추가
          </Button>
        </div>

        {showForm && (
          <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-700">신규 병의원 등록</p>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="병의원명"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="text-sm"
              />
              <Input
                placeholder="사업자등록번호 (000-00-00000)"
                value={bizNumber}
                onChange={(e) => setBizNumber(e.target.value)}
                className="text-sm"
              />
            </div>
            <div
              className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-2 cursor-pointer hover:bg-gray-50 text-sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-4 h-4 text-gray-400" />
              <span className={bizFile ? "text-gray-700" : "text-gray-400"}>
                {bizFile ? bizFile.name : "사업자등록증 첨부 (선택)"}
              </span>
              <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
                onChange={(e) => setBizFile(e.target.files?.[0] ?? null)} />
            </div>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving} className="flex-1">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                등록
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>
                취소
              </Button>
            </div>
          </form>
        )}

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
                      {c.bizFileName && (
                        <p className="text-xs text-gray-400">{c.bizFileName}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-sm text-gray-500 w-32 text-center">
                    {formatBiz(c.bizNumber)}
                  </span>
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
    </BizLayout>
  );
}
