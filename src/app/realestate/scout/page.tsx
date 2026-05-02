"use client";

import { useEffect, useState } from "react";

interface Match {
  matchType: "parcel" | "listing";
  parcelId: string | null;
  listingId: string | null;
  distanceM: number;
  bearing: number | null;
}

interface Notice {
  id: string;
  noticeName: string;
  source: string;
  region: string | null;
  totalHouseholds: number | null;
  moveInAt: string | null;
  latitude: number | null;
  longitude: number | null;
  matches: Match[];
}

interface ParcelInfo {
  jibun: string | null;
  area: number | null;
  landUse: string | null;
  officialPrice: number | null;
}
interface ListingInfo {
  title: string | null;
  address: string | null;
  tradeType: string;
  propertyType: string;
  priceSale: number | null;
  priceDeposit: number | null;
  priceMonthly: number | null;
  url: string | null;
}
interface Score {
  compositeScore: number | null;
  prescriptionScore: number | null;
  recommendedSpecialties: string[];
  backingHouseholds: number | null;
  competitorClinics: number | null;
}

interface ScoutResp {
  notices: Notice[];
  parcels: Record<string, ParcelInfo>;
  listings: Record<string, ListingInfo>;
  scores: Record<string, Score>;
}

export default function ScoutPage() {
  const [months, setMonths] = useState(24);
  const [region, setRegion] = useState("");
  const [minHH, setMinHH] = useState(500);
  const [data, setData] = useState<ScoutResp | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const p = new URLSearchParams({
        moveInWithinMonths: String(months),
        ...(region ? { region } : {}),
        minHouseholds: String(minHH),
      });
      const r = await fetch(`/api/realestate/scout?${p}`);
      const j = await r.json();
      setData(j);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">입지 스카우팅 (분양·입주 예정지)</h1>
        <p className="text-sm text-gray-500">
          청약홈/LH 분양 공고 → 입주일 임박순 + 인접 매물/필지 + 메디컬 입지 점수.
        </p>
      </header>

      <div className="rounded border bg-white p-3 flex flex-wrap items-end gap-2 text-sm">
        <label>
          <span className="block text-gray-500 mb-0.5">입주 예정 (개월 이내)</span>
          <input type="number" value={months} onChange={e => setMonths(Number(e.target.value))}
            className="border rounded px-2 py-1 w-28" />
        </label>
        <label>
          <span className="block text-gray-500 mb-0.5">지역 필터</span>
          <input value={region} onChange={e => setRegion(e.target.value)}
            placeholder="강남구" className="border rounded px-2 py-1 w-40" />
        </label>
        <label>
          <span className="block text-gray-500 mb-0.5">최소 세대수</span>
          <input type="number" value={minHH} onChange={e => setMinHH(Number(e.target.value))}
            className="border rounded px-2 py-1 w-28" />
        </label>
        <button onClick={load} disabled={busy}
          className="px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50">
          {busy ? "조회…" : "조회"}
        </button>
      </div>

      <div className="space-y-3">
        {data?.notices.map(n => (
          <NoticeCard key={n.id} n={n} parcels={data.parcels} listings={data.listings} scores={data.scores} />
        ))}
        {data && data.notices.length === 0 && (
          <div className="text-sm text-gray-400 p-6 text-center">
            조건에 맞는 분양 공고 없음. 먼저 <code>npm run re:notice -- --source applyhome --sido 서울</code> 으로 동기화하세요.
          </div>
        )}
      </div>
    </div>
  );
}

function NoticeCard({ n, parcels, listings, scores }: {
  n: Notice;
  parcels: Record<string, ParcelInfo>;
  listings: Record<string, ListingInfo>;
  scores: Record<string, Score>;
}) {
  const moveIn = n.moveInAt ? new Date(n.moveInAt) : null;
  return (
    <div className="rounded border bg-white p-4">
      <div className="flex justify-between items-start gap-3">
        <div>
          <div className="font-semibold text-lg">{n.noticeName}</div>
          <div className="text-xs text-gray-500">
            {n.source} · {n.region ?? "-"} · 세대수 {n.totalHouseholds?.toLocaleString() ?? "-"}
            {moveIn && ` · 입주 ${moveIn.getFullYear()}.${String(moveIn.getMonth() + 1).padStart(2, "0")}`}
          </div>
        </div>
        {n.matches.length > 0 && (
          <div className="text-xs text-gray-500">반경 1km 매칭 {n.matches.length}건</div>
        )}
      </div>

      {n.matches.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead className="text-gray-500 text-xs">
            <tr>
              <th className="text-left py-1">유형</th>
              <th className="text-left py-1">대상</th>
              <th className="text-right py-1">거리</th>
              <th className="text-right py-1">메디컬 점수</th>
              <th className="text-left py-1">추천 진료과</th>
            </tr>
          </thead>
          <tbody>
            {n.matches.map(m => (
              <tr key={`${m.matchType}-${m.parcelId ?? m.listingId}`} className="border-t">
                <td className="py-1">{m.matchType === "parcel" ? "토지" : "매물"}</td>
                <td className="py-1">
                  {m.matchType === "parcel" && m.parcelId && (
                    <span>
                      {parcels[m.parcelId]?.jibun ?? m.parcelId.slice(0, 8)} ·
                      {parcels[m.parcelId]?.landUse ?? "-"} ·
                      {parcels[m.parcelId]?.area?.toFixed(0) ?? "-"}㎡
                    </span>
                  )}
                  {m.matchType === "listing" && m.listingId && (
                    <span>
                      {listings[m.listingId]?.title ?? m.listingId.slice(0, 8)} ·
                      {listings[m.listingId]?.tradeType} {listings[m.listingId]?.propertyType}
                    </span>
                  )}
                </td>
                <td className="text-right py-1">{Math.round(m.distanceM)}m</td>
                <td className="text-right py-1 font-semibold text-emerald-700">
                  {m.parcelId && scores[m.parcelId]?.compositeScore != null
                    ? scores[m.parcelId].compositeScore?.toFixed(1)
                    : "-"}
                </td>
                <td className="py-1 text-xs text-gray-500">
                  {m.parcelId && scores[m.parcelId]?.recommendedSpecialties.slice(0, 3).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
