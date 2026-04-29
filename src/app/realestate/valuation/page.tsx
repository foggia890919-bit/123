"use client";

import { useState } from "react";

interface Valuation {
  saleAmount: number;
  areaM2: number | null;
  region: string;
  buildingType: string;
  capRatePct: number | null;
  yieldPct: number | null;
  roneRentPerM2: number | null;
  vacancyPct: number | null;
  estimatedMonthlyRent: number | null;
  estimatedDeposit: number | null;
  rentBy: "cap-rate" | "rone-rent" | "blended" | "n/a";
  loanAmount: number;
  ownEquity: number;
  monthlyInterest: number;
  monthlyNetIncome: number | null;
  annualNetIncome: number | null;
  cashOnCashRoiPct: number | null;
  notes: string[];
  assumptions: {
    ltv: number;
    loanRatePct: number;
    acquisitionTaxPct: number;
    brokerageFeePct: number;
    monthlyOpex: number;
    depositMultiplier: number;
  };
}

interface RegionalResp {
  regional: {
    count: number;
    medianSale: number | null;
    pricePerM2: number | null;
    estimatedMonthlyRentPerM2: number | null;
  };
  capRatePct: number;
  months: number;
}

export default function ValuationPage() {
  const [mode, setMode] = useState<"listing" | "region">("listing");
  const [listingId, setListingId] = useState("");
  const [lawdCd, setLawdCd] = useState("11680");
  const [cap, setCap] = useState(4);
  const [months, setMonths] = useState(12);
  const [a, setA] = useState({
    ltv: 60, rate: 5.5, tax: 4.6, fee: 0.9, opex: 30, depositMul: 12,
  });
  const [result, setResult] = useState<{ valuation?: Valuation; regional?: RegionalResp["regional"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setResult(null);
    try {
      const params = new URLSearchParams();
      if (mode === "listing") params.set("listingId", listingId);
      else { params.set("lawdCd", lawdCd); params.set("cap", String(cap)); params.set("months", String(months)); }
      Object.entries(a).forEach(([k, v]) => params.set(k, String(v)));
      const res = await fetch(`/api/realestate/valuation?${params}`);
      const j = await res.json();
      if (!res.ok) { setErr(j.error ?? "오류"); return; }
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">매물 평가 / 권역 임대료 추정</h1>
        <p className="text-sm text-gray-500">
          매매가 × 권역 cap rate ÷ 12 → 적정 월세. LTV·금리 가정으로 대출과 자기자본 ROI까지 산정.
        </p>
      </header>

      <div className="flex gap-2">
        <Tab on={mode === "listing"} onClick={() => setMode("listing")}>매물 단건 평가</Tab>
        <Tab on={mode === "region"} onClick={() => setMode("region")}>권역 평균 추정</Tab>
      </div>

      <div className="rounded border bg-white p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        {mode === "listing" ? (
          <Field label="REListing.id">
            <input value={listingId} onChange={e => setListingId(e.target.value)}
              placeholder="매물 뷰에서 복사" className="border rounded px-2 py-1 w-full" />
          </Field>
        ) : (
          <>
            <Field label="LAWD_CD (5자리)">
              <input value={lawdCd} onChange={e => setLawdCd(e.target.value)}
                className="border rounded px-2 py-1 w-full" />
            </Field>
            <Field label="cap rate %">
              <input type="number" step="0.1" value={cap} onChange={e => setCap(Number(e.target.value))}
                className="border rounded px-2 py-1 w-full" />
            </Field>
            <Field label="조회 개월">
              <input type="number" value={months} onChange={e => setMonths(Number(e.target.value))}
                className="border rounded px-2 py-1 w-full" />
            </Field>
          </>
        )}
        <Field label="LTV %"><Num v={a.ltv} on={v => setA(s => ({ ...s, ltv: v }))} /></Field>
        <Field label="대출 금리 %"><Num v={a.rate} on={v => setA(s => ({ ...s, rate: v }))} step={0.1} /></Field>
        <Field label="취득세 %"><Num v={a.tax} on={v => setA(s => ({ ...s, tax: v }))} step={0.1} /></Field>
        <Field label="중개수수료 %"><Num v={a.fee} on={v => setA(s => ({ ...s, fee: v }))} step={0.1} /></Field>
        <Field label="월 관리비(만원)"><Num v={a.opex} on={v => setA(s => ({ ...s, opex: v }))} /></Field>
        <Field label="보증금 배수"><Num v={a.depositMul} on={v => setA(s => ({ ...s, depositMul: v }))} /></Field>
        <button disabled={busy} onClick={run}
          className="col-span-2 md:col-span-4 mt-2 px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {busy ? "계산…" : "계산"}
        </button>
      </div>

      {err && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

      {result?.valuation && <ValuationCard v={result.valuation} />}
      {result?.regional && (
        <div className="rounded border bg-white p-4 text-sm space-y-1">
          <h3 className="font-semibold">권역 추정 (LAWD_CD {lawdCd})</h3>
          <KV k="실거래 건수" v={result.regional.count.toLocaleString()} />
          <KV k="매매가 중간값" v={result.regional.medianSale != null ? `${manwon(result.regional.medianSale)}` : "-"} />
          <KV k="매매 단가 중간값" v={result.regional.pricePerM2 != null ? `${result.regional.pricePerM2}만/㎡` : "-"} />
          <KV k={`추정 월세 단가 (cap ${cap}%)`} v={result.regional.estimatedMonthlyRentPerM2 != null ? `${result.regional.estimatedMonthlyRentPerM2}만/㎡` : "-"} />
        </div>
      )}
    </div>
  );
}

function ValuationCard({ v }: { v: Valuation }) {
  return (
    <div className="rounded border bg-white p-4 text-sm space-y-3">
      <h3 className="font-semibold text-lg">{v.region || "(지역 미상)"} · {v.buildingType}</h3>

      <Section title="매물 기준값">
        <KV k="매매가" v={`${manwon(v.saleAmount)}`} />
        <KV k="면적" v={v.areaM2 != null ? `${v.areaM2}㎡` : "-"} />
      </Section>

      <Section title={`임대료 추정 (${v.rentBy})`}>
        <KV k="권역 cap rate" v={v.capRatePct != null ? `${v.capRatePct.toFixed(2)}%` : "통계 없음"} />
        <KV k="권역 R-ONE 단가" v={v.roneRentPerM2 != null ? `${(v.roneRentPerM2/10000).toFixed(2)}만/㎡` : "-"} />
        <KV k="권역 공실률" v={v.vacancyPct != null ? `${v.vacancyPct.toFixed(1)}%` : "-"} />
        <KV k="추정 월세" v={v.estimatedMonthlyRent != null ? `${manwon(v.estimatedMonthlyRent)}` : "산정 불가"} hi />
        <KV k="추정 보증금" v={v.estimatedDeposit != null ? `${manwon(v.estimatedDeposit)}` : "-"} />
      </Section>

      <Section title="대출 / 자기자본">
        <KV k={`대출 (LTV ${v.assumptions.ltv}%)`} v={`${manwon(v.loanAmount)}`} />
        <KV k="자기자본 (취득세·수수료 포함)" v={`${manwon(v.ownEquity)}`} />
        <KV k={`월 이자 (금리 ${v.assumptions.loanRatePct}%)`} v={`${v.monthlyInterest.toLocaleString()}만`} />
      </Section>

      <Section title="기대 수익">
        <KV k="월 임대료" v={v.estimatedMonthlyRent != null ? `${manwon(v.estimatedMonthlyRent)}` : "-"} />
        <KV k="월 이자" v={`-${v.monthlyInterest.toLocaleString()}만`} />
        <KV k="월 관리비" v={`-${v.assumptions.monthlyOpex.toLocaleString()}만`} />
        <KV k="월 순수익" v={v.monthlyNetIncome != null ? `${v.monthlyNetIncome.toLocaleString()}만` : "-"} hi />
        <KV k="연 순수익" v={v.annualNetIncome != null ? `${manwon(v.annualNetIncome)}` : "-"} />
        <KV k="자기자본 ROI" v={v.cashOnCashRoiPct != null ? `${v.cashOnCashRoiPct.toFixed(2)}%` : "-"} hi />
      </Section>

      {v.notes.length > 0 && (
        <ul className="text-xs text-amber-700 list-disc pl-5 space-y-0.5">
          {v.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded text-sm ${on ? "bg-gray-800 text-white" : "border bg-white"}`}>
      {children}
    </button>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-gray-500 mb-0.5">{label}</span>{children}</label>;
}
function Num({ v, on, step = 1 }: { v: number; on: (v: number) => void; step?: number }) {
  return <input type="number" step={step} value={v} onChange={e => on(Number(e.target.value))} className="border rounded px-2 py-1 w-full" />;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 mb-1">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function KV({ k, v, hi }: { k: string; v: string; hi?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{k}</span>
      <span className={hi ? "font-semibold text-emerald-700" : ""}>{v}</span>
    </div>
  );
}
function manwon(v: number): string {
  if (v >= 10_000) {
    const eok = Math.floor(v / 10_000);
    const rem = v % 10_000;
    return rem ? `${eok}억 ${rem.toLocaleString()}` : `${eok}억`;
  }
  return `${v.toLocaleString()}만`;
}
