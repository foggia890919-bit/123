"use client";

import { useState, useEffect, useCallback } from "react";
import { BizLayout } from "@/app/biz/page";
import { Search, Loader2, CheckCircle, XCircle, Hash, Users } from "lucide-react";

interface SalesRep {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  approved: boolean;
  salesCode: string | null;
  createdAt: string;
}

export default function SalesRepsPage() {
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    const res = await fetch(`/api/sales-reps?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setReps(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  async function toggleApproved(rep: SalesRep) {
    const res = await fetch("/api/sales-reps", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rep.id, approved: !rep.approved }),
    });
    if (res.ok) {
      const updated = await res.json();
      setReps((p) => p.map((r) => r.id === rep.id ? { ...r, approved: updated.approved } : r));
    }
  }

  async function generateCode(rep: SalesRep) {
    setGenerating(rep.id);
    try {
      const res = await fetch("/api/generate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "sales", id: rep.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setReps((p) => p.map((r) => r.id === rep.id ? { ...r, salesCode: data.code } : r));
      } else {
        if (data.code) setReps((p) => p.map((r) => r.id === rep.id ? { ...r, salesCode: data.code } : r));
        else alert(data.error ?? "코드 생성 실패");
      }
    } finally {
      setGenerating(null);
    }
  }

  return (
    <BizLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">영업사원 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">영업사원 승인 및 코드 관리</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
            <Users className="w-3.5 h-3.5" />
            총 {reps.length}명
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 이메일, 코드 검색"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : reps.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              {search ? "검색 결과가 없어요." : "등록된 영업사원이 없어요."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <Th>이름</Th>
                    <Th>이메일</Th>
                    <Th>연락처</Th>
                    <Th>영업사원 코드</Th>
                    <Th>승인</Th>
                    <Th>가입일</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {reps.map((rep) => (
                    <tr key={rep.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{rep.name ?? "-"}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{rep.email}</td>
                      <td className="px-4 py-3 text-gray-600">{rep.phone ?? "-"}</td>
                      <td className="px-4 py-3">
                        {rep.salesCode ? (
                          <span className="inline-flex items-center gap-1 text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                            <Hash className="w-3 h-3" />{rep.salesCode}
                          </span>
                        ) : (
                          <button
                            onClick={() => generateCode(rep)}
                            disabled={generating === rep.id}
                            className="flex items-center gap-1 text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                          >
                            {generating === rep.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Hash className="w-3 h-3" />}
                            코드 생성
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleApproved(rep)}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                            rep.approved
                              ? "bg-green-50 text-green-700 hover:bg-green-100"
                              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                          }`}
                        >
                          {rep.approved
                            ? <><CheckCircle className="w-3 h-3" />승인</>
                            : <><XCircle className="w-3 h-3" />미승인</>}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {new Date(rep.createdAt).toLocaleDateString("ko-KR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </BizLayout>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{children}</th>;
}
