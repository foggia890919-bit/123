"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, Check, Search } from "lucide-react";
import type { DealerClient } from "./types";

type SubView = "partners" | "company-match";

const GRADES = [
  { v: "A", label: "A (-0.5%)", desc: "5억↑" },
  { v: "B", label: "B (-1%)", desc: "1억↑" },
  { v: "C", label: "C (-2%)", desc: "5천↑" },
];

interface CompanyMatchItem {
  sheetCompany: string;
  kmdCompany: string | null;
  suggested: string | null;
  candidates: string[];
  matched: boolean;
}

export default function PartnerPromoTab() {
  const [view, setView] = useState<SubView>("partners");

  return (
    <div className="space-y-5">
      <div className="flex gap-2 flex-wrap">
        {([
          { k: "partners", label: "협력법인 지정" },
          { k: "company-match", label: "제약사 매칭" },
        ] as { k: SubView; label: string }[]).map((t) => (
          <button
            key={t.k}
            onClick={() => setView(t.k)}
            className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
              view === t.k
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === "partners" && <PartnersView />}
      {view === "company-match" && <CompanyMatchView />}
    </div>
  );
}

// ── 1. 협력법인 지정 — 법인 리스트 인라인 토글 ──────────────────────
function PartnersView() {
  const [clients, setClients] = useState<DealerClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/dealer").then((r) => r.json())
      .then((d) => setClients(Array.isArray(d) ? d.filter((c: DealerClient) =>
        c.dealerType === "UPPER_CORP" || c.dealerType === "LOWER_CORP" || c.dealerType === "CORPORATION") : []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setSavingId(id);
    await fetch(`/api/dealer?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setClients((prev) => prev.map((c) => c.id === id ? { ...c, ...body } as DealerClient : c));
    setSavingId(null);
  }

  const filtered = query
    ? clients.filter((c) => c.clientName.includes(query) || c.bizNumber.includes(query))
    : clients;

  if (loading) return <div className="flex justify-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="법인명·사업자번호 검색"
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
      </div>
      <p className="text-xs text-gray-500">
        협력법인으로 지정하면 자동으로 우리 프로모션이 적용됩니다. 적용 요율 = 시트 최고요율 − 등급차감.
        제약사별 정산내역서에 이 요율이 반영됩니다.
      </p>

      <div className="overflow-x-auto border rounded-lg bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-xs text-gray-500">
              <th className="text-left px-4 py-3">법인명</th>
              <th className="text-center px-3 py-3">분류</th>
              <th className="text-center px-3 py-3">등급</th>
              <th className="text-left px-3 py-3">프로모션 기준일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((c) => {
              const isPartner = c.corpClassification === "PARTNER";
              return (
                <tr key={c.id} className={`hover:bg-gray-50 ${savingId === c.id ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">{c.clientName}</div>
                    <div className="text-xs text-gray-400">{c.bizNumber}</div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => patch(c.id, {
                        corpClassification: isPartner ? "GENERAL" : "PARTNER",
                        ...(isPartner ? { partnerGrade: null } : {}),
                      })}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                        isPartner
                          ? "bg-amber-50 border-amber-300 text-amber-700"
                          : "bg-gray-50 border-gray-200 text-gray-500"
                      }`}
                    >
                      {isPartner ? "협력법인" : "일반법인"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {isPartner ? (
                      <div className="flex gap-1 justify-center">
                        {GRADES.map((g) => (
                          <button
                            key={g.v}
                            onClick={() => patch(c.id, { partnerGrade: g.v })}
                            title={g.desc}
                            className={`text-xs w-7 h-7 rounded-full border transition-colors ${
                              c.partnerGrade === g.v
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-gray-400 border-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            {g.v}
                          </button>
                        ))}
                      </div>
                    ) : <span className="text-gray-300 text-xs">-</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {isPartner ? (
                      <input
                        type="date"
                        value={c.promotionBaseDate ? c.promotionBaseDate.slice(0, 10) : ""}
                        onChange={(e) => patch(c.id, {
                          promotionBaseDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                        })}
                        className="text-xs border border-gray-300 rounded px-2 py-1"
                      />
                    ) : <span className="text-gray-300 text-xs">-</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">
          법인이 없습니다. 상위법인/하위법인 탭에서 먼저 등록하세요.
        </div>
      )}
    </div>
  );
}


// ── 3. 제약사 매칭 — 시트 제약사명 ↔ 전산 제약사명 ───────────────────
function CompanyMatchView() {
  const [items, setItems] = useState<CompanyMatchItem[]>([]);
  const [kmdCompanies, setKmdCompanies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRunning, setAutoRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/company-mapping").then((r) => r.json())
      .then((d) => { setItems(d.items ?? []); setKmdCompanies(d.kmdCompanies ?? []); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(sheetCompany: string, kmdCompany: string) {
    await fetch("/api/admin/company-mapping", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetCompany, kmdCompany }),
    });
    setItems((prev) => prev.map((it) =>
      it.sheetCompany === sheetCompany ? { ...it, kmdCompany: kmdCompany || null, matched: !!kmdCompany } : it));
  }

  async function autoMatch() {
    setAutoRunning(true);
    await fetch("/api/admin/company-mapping", { method: "PUT" });
    setAutoRunning(false);
    load();
  }

  async function runSheetSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch("/api/admin/sync-yk-rates", { method: "POST" });
      const data = await r.json();
      if (!r.ok || data.error) {
        setSyncMsg({ ok: false, text: data.error ?? `HTTP ${r.status}` });
        return;
      }
      // 동기화 후 매칭 상태 재로딩 → 선택대기 건수 계산
      const mr = await fetch("/api/admin/company-mapping");
      const md = await mr.json();
      const items2 = (md.items ?? []) as CompanyMatchItem[];
      const ambig = items2.filter((it) => !it.matched && it.candidates.length > 0).length;
      const unmatched = items2.filter((it) => !it.matched).length;
      const unmappedCnt = data.unmappedCompanies?.length ?? 0;
      const parts = [`✓ ${data.upserted}건 동기화 (스킵 ${data.skipped})`];
      if (unmappedCnt > 0) parts.push(`미매핑 ${unmappedCnt}건`);
      if (ambig > 0) parts.push(`⚠️ 선택대기 ${ambig}건 — 후보 버튼 확인 필요`);
      if (unmatched > ambig) parts.push(`미매칭 ${unmatched - ambig}건`);
      setSyncMsg({ ok: true, text: parts.join(" · ") });
      setItems(items2);
      setKmdCompanies(md.kmdCompanies ?? []);
    } catch (e) {
      setSyncMsg({ ok: false, text: `네트워크 오류: ${String(e)}` });
    } finally {
      setSyncing(false);
    }
  }

  const filtered = items
    .filter((it) => !onlyUnmatched || !it.matched)
    .filter((it) => !query || it.sheetCompany.includes(query));
  const matchedCount = items.filter((it) => it.matched).length;
  const ambiguousCount = items.filter((it) => !it.matched && it.candidates.length > 0).length;

  if (loading) return <div className="flex justify-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      {syncMsg && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${
          syncMsg.ok
            ? "text-green-700 bg-green-50 border-green-200"
            : "text-red-700 bg-red-50 border-red-200"
        }`}>
          {syncMsg.text}
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={runSheetSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "동기화 중..." : "구글시트 → DB 동기화"}
        </button>
        <button
          onClick={autoMatch}
          disabled={autoRunning}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${autoRunning ? "animate-spin" : ""}`} />
          이름 같은 것 자동매칭
        </button>
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} />
          미매칭만
        </label>
        <div className="relative max-w-xs flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="제약사 검색"
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-gray-300 rounded-lg"
          />
        </div>
        <span className="text-xs text-gray-500 ml-auto">
          {matchedCount}/{items.length} 매칭
          {ambiguousCount > 0 && (
            <span className="ml-2 text-orange-600 font-medium">선택대기 {ambiguousCount}건</span>
          )}
        </span>
      </div>

      <div className="overflow-x-auto border rounded-lg bg-white max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b sticky top-0">
            <tr className="text-xs text-gray-500">
              <th className="text-left px-4 py-2.5">시트 제약사명</th>
              <th className="text-left px-3 py-2.5">전산 제약사명 (KMD)</th>
              <th className="text-center px-3 py-2.5 w-16">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((it) => {
              const hasCandidates = !it.kmdCompany && it.candidates.length > 0;
              return (
                <tr key={it.sheetCompany} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-800">{it.sheetCompany}</td>
                  <td className="px-3 py-2 space-y-1">
                    {hasCandidates && (
                      <div className="flex gap-1 flex-wrap mb-1">
                        <span className="text-[10px] text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 font-medium">
                          후보 {it.candidates.length}개 — 어떤건가요?
                        </span>
                        {it.candidates.map((c) => (
                          <button
                            key={c}
                            onClick={() => save(it.sheetCompany, c)}
                            className="text-[11px] px-2 py-0.5 rounded border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    )}
                    <select
                      value={it.kmdCompany ?? ""}
                      onChange={(e) => save(it.sheetCompany, e.target.value)}
                      className={`w-full text-xs border rounded px-2 py-1.5 ${
                        it.kmdCompany
                          ? "border-green-300 bg-green-50"
                          : hasCandidates
                            ? "border-orange-300 bg-orange-50"
                            : it.suggested
                              ? "border-amber-300 bg-amber-50"
                              : "border-gray-300"
                      }`}
                    >
                      <option value="">-- 미매칭 --</option>
                      {it.suggested && !it.kmdCompany && (
                        <option value={it.suggested}>⭐ {it.suggested} (자동제안)</option>
                      )}
                      {kmdCompanies.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {it.matched
                      ? <Check className="w-4 h-4 text-green-600 inline" />
                      : hasCandidates
                        ? <span className="text-[10px] text-orange-600 font-medium">선택필요</span>
                        : it.suggested
                          ? <span className="text-[10px] text-amber-600">제안有</span>
                          : <span className="text-[10px] text-gray-300">-</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
