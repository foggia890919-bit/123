"use client";

import { useState, useEffect, useCallback } from "react";
import { Building2, Loader2, Search } from "lucide-react";

interface HospitalClient {
  id: string;
  clientName: string;
  bizNumber: string;
  address: string | null;
  approved: boolean;
  createdAt: string;
  ownerName?: string | null;
  ownerEmail?: string | null;
}

export default function HospitalsTab() {
  const [list, setList] = useState<HospitalClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    // dealerType IS NULL = 의료기관(병의원). 전체 회원의 등록 거래처 통합 조회.
    fetch("/api/admin/hospitals").then((r) => r.json())
      .then((d) => setList(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = query
    ? list.filter((h) =>
        h.clientName.includes(query) ||
        h.bizNumber.includes(query) ||
        (h.ownerName ?? "").includes(query) ||
        (h.ownerEmail ?? "").includes(query))
    : list;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Building2 className="w-5 h-5 text-amber-600" />병의원관리
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          전체 회원이 등록한 병의원 거래처 (사업자번호 기준 마스터). 다른 모든 메뉴는 여기를 기준으로 데이터를 공유합니다.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="병의원명·사업자번호·등록자 검색"
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-lg bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-xs text-gray-500">
                <th className="text-left px-4 py-3">병의원명</th>
                <th className="text-left px-3 py-3">사업자번호</th>
                <th className="text-left px-3 py-3">주소</th>
                <th className="text-left px-3 py-3">등록자</th>
                <th className="text-center px-3 py-3">상태</th>
                <th className="text-left px-3 py-3">등록일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((h) => (
                <tr key={h.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{h.clientName}</td>
                  <td className="px-3 py-2.5 text-gray-600 tabular-nums">{h.bizNumber}</td>
                  <td className="px-3 py-2.5 text-gray-600 truncate max-w-xs">{h.address ?? "-"}</td>
                  <td className="px-3 py-2.5 text-gray-600">
                    {h.ownerName ?? "-"}
                    {h.ownerEmail && <div className="text-[10px] text-gray-400">{h.ownerEmail}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                      h.approved ? "bg-green-50 border-green-200 text-green-700" : "bg-yellow-50 border-yellow-200 text-yellow-700"
                    }`}>
                      {h.approved ? "승인" : "대기"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs">{new Date(h.createdAt).toLocaleDateString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">등록된 병의원이 없습니다</div>
          )}
        </div>
      )}
    </div>
  );
}
