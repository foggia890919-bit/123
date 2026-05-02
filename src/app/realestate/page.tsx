"use client";

import { useEffect, useMemo, useState } from "react";

interface Agent {
  id: string;
  name: string;
  phone: string | null;
  representative: string | null;
  registrationNo: string | null;
  address: string | null;
}

interface Listing {
  id: string;
  externalId: string;
  url: string | null;
  tradeType: string;
  propertyType: string;
  title: string | null;
  cortarNo: string | null;
  address: string | null;
  priceSale: number | null;
  priceDeposit: number | null;
  priceMonthly: number | null;
  areaSupply: number | null;
  areaExclusive: number | null;
  floor: string | null;
  description: string | null;
  features: string[];
  firstSeenAt: string;
  closedAt: string | null;
  agent: Agent | null;
}

const TRADE_TYPES = ["", "매매", "전세", "월세"];
const PROPERTY_TYPES = ["", "상가", "사무실", "빌딩", "오피스텔", "토지"];

export default function RealEstatePage() {
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    cortarNo: "",
    propertyType: "",
    tradeType: "",
    onlyOpen: true,
  });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.cortarNo) params.set("cortarNo", filters.cortarNo);
      if (filters.propertyType) params.set("propertyType", filters.propertyType);
      if (filters.tradeType) params.set("tradeType", filters.tradeType);
      params.set("onlyOpen", String(filters.onlyOpen));
      const res = await fetch(`/api/realestate/listings?${params}`);
      const j = await res.json();
      setItems(j.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => {
    const newToday = items.filter(i => isToday(i.firstSeenAt)).length;
    return { total: items.length, newToday };
  }, [items]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">매물 모니터</h1>
          <p className="text-sm text-gray-500">
            네이버부동산 수집 + 국토부 실거래 — 개인 사용 전용. 수집한 중개사 연락처는 동의 없는 광고/마케팅 발송에 사용 금지.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/realestate/landplan" className="px-3 py-1.5 rounded border text-sm hover:bg-gray-50">
            토지·가설계
          </a>
          <a href="/realestate/valuation" className="px-3 py-1.5 rounded border text-sm hover:bg-gray-50">
            평가/시세 추정
          </a>
          <a href="/realestate/watches" className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">
            알림 조건 관리
          </a>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <div className="p-3 rounded border bg-white">
          <div className="text-gray-500">현재 보고 있는 매물</div>
          <div className="text-xl font-semibold">{summary.total.toLocaleString()}</div>
        </div>
        <div className="p-3 rounded border bg-white">
          <div className="text-gray-500">오늘 신규</div>
          <div className="text-xl font-semibold text-emerald-600">{summary.newToday}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end p-3 rounded border bg-white">
        <label className="text-sm">
          <span className="block text-gray-500">행정동(cortarNo)</span>
          <input
            value={filters.cortarNo}
            onChange={e => setFilters(f => ({ ...f, cortarNo: e.target.value }))}
            placeholder="1168010100"
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-500">매물종류</span>
          <select
            value={filters.propertyType}
            onChange={e => setFilters(f => ({ ...f, propertyType: e.target.value }))}
            className="border rounded px-2 py-1"
          >
            {PROPERTY_TYPES.map(p => <option key={p} value={p}>{p || "전체"}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-500">거래유형</span>
          <select
            value={filters.tradeType}
            onChange={e => setFilters(f => ({ ...f, tradeType: e.target.value }))}
            className="border rounded px-2 py-1"
          >
            {TRADE_TYPES.map(p => <option key={p} value={p}>{p || "전체"}</option>)}
          </select>
        </label>
        <label className="text-sm flex items-center gap-1">
          <input
            type="checkbox"
            checked={filters.onlyOpen}
            onChange={e => setFilters(f => ({ ...f, onlyOpen: e.target.checked }))}
          />
          <span>거래중만</span>
        </label>
        <button onClick={load} className="px-3 py-1.5 bg-gray-800 text-white rounded text-sm">
          {loading ? "로딩…" : "조회"}
        </button>
      </div>

      <div className="rounded border bg-white overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left px-3 py-2">신규</th>
              <th className="text-left px-3 py-2">유형</th>
              <th className="text-left px-3 py-2">제목/주소</th>
              <th className="text-right px-3 py-2">가격</th>
              <th className="text-right px-3 py-2">면적</th>
              <th className="text-left px-3 py-2">층</th>
              <th className="text-left px-3 py-2">중개사</th>
              <th className="text-left px-3 py-2">바로가기</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className={isToday(it.firstSeenAt) ? "bg-emerald-50" : ""}>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(it.firstSeenAt)}</td>
                <td className="px-3 py-2">{it.tradeType} · {it.propertyType}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{it.title ?? "(제목 없음)"}</div>
                  <div className="text-gray-500">{it.address}</div>
                  {it.features.length > 0 && (
                    <div className="text-xs text-gray-400 mt-0.5">{it.features.slice(0, 4).join(" · ")}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{fmtPrice(it)}</td>
                <td className="px-3 py-2 text-right">{fmtArea(it)}</td>
                <td className="px-3 py-2">{it.floor}</td>
                <td className="px-3 py-2">
                  {it.agent ? (
                    <div>
                      <div className="font-medium">{it.agent.name}</div>
                      {it.agent.phone && <div className="text-xs text-gray-500">{it.agent.phone}</div>}
                    </div>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {it.url && (
                    <a href={it.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">열기</a>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">매물 없음 — 먼저 `npm run re:scrape` 으로 수집하세요.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtPrice(l: Listing): string {
  if (l.priceSale != null) return `매매 ${manwon(l.priceSale)}`;
  if (l.priceDeposit != null && l.priceMonthly != null) return `${manwon(l.priceDeposit)} / ${l.priceMonthly}`;
  if (l.priceDeposit != null) return `전세 ${manwon(l.priceDeposit)}`;
  return "-";
}
function manwon(v: number): string {
  if (v >= 10_000) {
    const eok = Math.floor(v / 10_000);
    const rem = v % 10_000;
    return rem ? `${eok}억 ${rem.toLocaleString()}` : `${eok}억`;
  }
  return `${v.toLocaleString()}`;
}
function fmtArea(l: Listing): string {
  const a = l.areaExclusive ?? l.areaSupply;
  return a ? `${a.toFixed(1)}㎡` : "-";
}
function fmtDate(s: string): string {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function isToday(s: string): boolean {
  const d = new Date(s);
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}
