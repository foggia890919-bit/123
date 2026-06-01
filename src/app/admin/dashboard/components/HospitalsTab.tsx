"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { Building2, Loader2, Search, ChevronRight, ChevronDown } from "lucide-react";

interface MasterClient {
  id: string;
  clientName: string;
  bizNumber: string;
  address: string | null;
  createdAt: string;
  claimCount: number;
}

interface Claim {
  id: string;
  companyName: string;
  claimedBy: string;
  claimedAt: string;
  isMine: boolean;
}

export default function HospitalsTab() {
  const [list, setList] = useState<MasterClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [claims, setClaims] = useState<Record<string, Claim[]>>({});
  const [claimsLoading, setClaimsLoading] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/hospitals").then((r) => r.json())
      .then((d) => setList(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runMigration() {
    if (!confirm("기존 회원별 거래처(UserClient)를 마스터(Client)로 이전합니다. 사업자번호 중복은 1건으로 합칩니다. 진행할까요?")) return;
    setMigrating(true);
    setMigrateMsg(null);
    try {
      const r = await fetch("/api/admin/migrate-clients", { method: "POST" });
      const data = await r.json();
      if (!r.ok || data.error) {
        setMigrateMsg(`실패: ${data.error ?? `HTTP ${r.status}`}`);
        return;
      }
      setMigrateMsg(`✓ 총 ${data.totalUserClients}건 → 신규 ${data.created} · 이미존재 ${data.skipped}${data.errors?.length ? ` · 에러 ${data.errors.length}` : ""}`);
      load();
    } catch (e) {
      setMigrateMsg(`네트워크 오류: ${String(e)}`);
    } finally {
      setMigrating(false);
    }
  }

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!claims[id]) {
      setClaimsLoading(id);
      const r = await fetch(`/api/clients-master/${id}/claims`);
      const data = await r.json();
      setClaims((prev) => ({ ...prev, [id]: Array.isArray(data) ? data : [] }));
      setClaimsLoading(null);
    }
  }

  const filtered = query
    ? list.filter((h) => h.clientName.includes(query) || h.bizNumber.includes(query))
    : list;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Building2 className="w-5 h-5 text-amber-600" />병의원관리
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          사업자번호 기준 마스터 거래처. 클릭하면 제약사 거래 점유 회원이 표시됩니다.
          같은 (병의원·제약사) 조합은 <strong>선등록자 1명</strong>만 점유 가능합니다.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-md flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="병의원명·사업자번호 검색"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg"
          />
        </div>
        <button
          onClick={runMigration}
          disabled={migrating}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 disabled:opacity-40"
          title="기존 회원별 거래처(UserClient)를 마스터로 일괄 이전"
        >
          {migrating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Building2 className="w-3.5 h-3.5" />}
          {migrating ? "이전 중..." : "기존 거래처 → 마스터 이전"}
        </button>
        <span className="text-xs text-gray-500 ml-auto">총 {list.length}개</span>
      </div>
      {migrateMsg && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${
          migrateMsg.startsWith("✓") ? "text-green-700 bg-green-50 border-green-200" : "text-red-700 bg-red-50 border-red-200"
        }`}>
          {migrateMsg}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto border rounded-lg bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-xs text-gray-500">
                <th className="text-left px-4 py-3 w-6"></th>
                <th className="text-left px-3 py-3">병의원명</th>
                <th className="text-left px-3 py-3">사업자번호</th>
                <th className="text-left px-3 py-3">주소</th>
                <th className="text-center px-3 py-3">점유 제약사</th>
                <th className="text-left px-3 py-3">등록일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((h) => (
                <Fragment key={h.id}>
                  <tr
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleExpand(h.id)}
                  >
                    <td className="px-4 py-2.5">
                      {expanded === h.id
                        ? <ChevronDown className="w-4 h-4 text-gray-400" />
                        : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-900">{h.clientName}</td>
                    <td className="px-3 py-2.5 text-gray-600 tabular-nums">{h.bizNumber}</td>
                    <td className="px-3 py-2.5 text-gray-600 truncate max-w-xs">{h.address ?? "-"}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        h.claimCount > 0 ? "bg-purple-50 border-purple-200 text-purple-700" : "bg-gray-50 border-gray-200 text-gray-400"
                      }`}>
                        {h.claimCount}건
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{new Date(h.createdAt).toLocaleDateString("ko-KR")}</td>
                  </tr>
                  {expanded === h.id && (
                    <tr className="bg-gray-50">
                      <td colSpan={6} className="px-8 py-3">
                        {claimsLoading === h.id ? (
                          <div className="text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />조회 중...</div>
                        ) : (claims[h.id] ?? []).length === 0 ? (
                          <div className="text-xs text-gray-400">아직 점유된 제약사가 없습니다</div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {(claims[h.id] ?? []).map((c) => (
                              <div key={c.id} className="text-xs border border-gray-200 rounded bg-white px-3 py-2 flex items-center justify-between">
                                <span className="font-medium text-gray-800">{c.companyName}</span>
                                <span className="text-gray-500">
                                  {c.claimedBy}
                                  <span className="ml-1 text-[10px] text-gray-400">{new Date(c.claimedAt).toLocaleDateString("ko-KR")}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
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
