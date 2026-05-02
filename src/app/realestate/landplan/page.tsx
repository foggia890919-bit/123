"use client";

import { useState } from "react";

interface Parcel {
  pnu: string;
  jibun: string | null;
  sigungu: string | null;
  area: number | null;
  landUse: string | null;
  landUseDistrict: string | null;
  bcrLimit: number | null;
  farLimit: number | null;
  officialPrice: number | null;
  centerLat: number | null;
  centerLng: number | null;
}

interface Building {
  bldgNm: string | null;
  totalFloorArea: number | null;
  buildArea: number | null;
  bcr: number | null;
  far: number | null;
  groundFloors: number | null;
  undergroundFloors: number | null;
  mainPurpose: string | null;
  approvedAt: string | null;
}

interface Massing {
  zoneName: string;
  area: number;
  bcrLimit: number;
  farLimit: number;
  maxBuildArea: number;
  maxFloorArea: number;
  maxFloors: number;
  parkingRequired: number;
  basementFloors: number;
  netRentableArea: number;
  estimatedConstructionCost: number;
  notes: string[];
}

interface Proforma {
  assumedSaleAmount: number;
  saleSource: string;
  estimatedMonthlyRent: number | null;
  estimatedAnnualRent: number | null;
  capRatePct: number;
  loanAmount: number;
  ownEquity: number;
  monthlyInterest: number;
  monthlyNetIncome: number | null;
  cashOnCashRoiPct: number | null;
}

interface Benchmark {
  regionalRentPerM2?: number;
  regionalCapRate?: number;
  benchmarkSourceCount: number;
}

interface AnalyzeResp {
  parcel: Parcel;
  buildings: Building[];
  massing: Massing;
  proforma: Proforma;
  benchmark?: Benchmark | null;
  notes: string[];
}

export default function LandPlanPage() {
  const [jibun, setJibun] = useState("");
  const [salePrice, setSalePrice] = useState<number | "">("");
  const [cap, setCap] = useState(4);
  const [ltv, setLtv] = useState(60);
  const [rate, setRate] = useState(5.5);
  const [floorHeight, setFloorHeight] = useState(4.2);
  const [unitCost, setUnitCost] = useState(850);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzeResp | null>(null);

  async function run() {
    if (!jibun.trim()) { setErr("지번을 입력하세요"); return; }
    setBusy(true); setErr(null); setData(null);
    try {
      const res = await fetch("/api/realestate/land", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jibun: jibun.trim(),
          assumedSaleAmount: salePrice === "" ? null : Number(salePrice),
          capRatePct: cap,
          ltv,
          loanRatePct: rate,
          scenario: {
            buildingType: "medical",
            floorHeight,
            efficiency: 0.7,
            parkingRule: "medical",
            constructionUnitCost: unitCost,
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error?.message ?? j.error ?? "오류"); return; }
      setData(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">토지·가설계·수지 통합 분석</h1>
        <p className="text-sm text-gray-500">
          지번 입력 → 용도지역 + 공시지가 + 기존 건물 + 메디컬 빌딩 매싱 + 대출/ROI 한 번에 산출.
        </p>
      </header>

      <section className="rounded border bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
          <label className="md:col-span-2">
            <span className="block text-gray-500 mb-0.5">지번 또는 도로명</span>
            <input value={jibun} onChange={e => setJibun(e.target.value)}
              placeholder="서울특별시 강남구 역삼동 825-22"
              className="border rounded px-2 py-1.5 w-full" />
          </label>
          <NumF label="매매 가정가 (만원, 비우면 공시지가×1.5)" v={salePrice} on={v => setSalePrice(v === null ? "" : v)} allowEmpty />
          <NumF label="cap rate %" v={cap} on={v => setCap(v ?? 4)} step={0.1} />
          <NumF label="LTV %" v={ltv} on={v => setLtv(v ?? 60)} />
          <NumF label="대출금리 %" v={rate} on={v => setRate(v ?? 5.5)} step={0.1} />
          <NumF label="층고 m" v={floorHeight} on={v => setFloorHeight(v ?? 4.2)} step={0.1} />
          <NumF label="평당 공사비 (만원)" v={unitCost} on={v => setUnitCost(v ?? 850)} />
        </div>
        <button disabled={busy} onClick={run}
          className="w-full md:w-auto px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
          {busy ? "분석 중…" : "분석"}
        </button>
      </section>

      {err && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ParcelCard p={data.parcel} />
          <BuildingsCard items={data.buildings} />
          <MassingCard m={data.massing} />
          <ProformaCard p={data.proforma} bench={data.benchmark ?? null} />
          {data.notes.length > 0 && (
            <div className="lg:col-span-2 rounded border bg-amber-50 p-3 text-sm">
              <div className="font-semibold mb-1">메모</div>
              <ul className="list-disc pl-5 space-y-0.5">
                {data.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ParcelCard({ p }: { p: Parcel }) {
  return (
    <Card title="필지 정보">
      <KV k="PNU" v={p.pnu} />
      <KV k="지번" v={p.jibun ?? "-"} />
      <KV k="시군구" v={p.sigungu ?? "-"} />
      <KV k="면적" v={p.area != null ? `${p.area.toFixed(1)}㎡ (${(p.area / 3.3058).toFixed(1)}평)` : "-"} />
      <KV k="용도지역" v={p.landUse ?? "-"} hi />
      <KV k="용도지구" v={p.landUseDistrict ?? "-"} />
      <KV k="법정 BCR/FAR" v={`${p.bcrLimit ?? "-"}% / ${p.farLimit ?? "-"}%`} />
      <KV k="공시지가" v={p.officialPrice != null ? `${p.officialPrice.toLocaleString()} 원/㎡` : "-"} />
    </Card>
  );
}

function BuildingsCard({ items }: { items: Building[] }) {
  return (
    <Card title={`기존 건축물 (${items.length}동)`}>
      {items.length === 0 ? (
        <div className="text-sm text-gray-400">건물 없음 (나대지 또는 미등록)</div>
      ) : items.map((b, i) => (
        <div key={i} className="border-t first:border-t-0 pt-2 first:pt-0 mt-2 first:mt-0">
          <div className="font-medium">{b.bldgNm ?? "(이름 없음)"}</div>
          <KV k="주용도" v={b.mainPurpose ?? "-"} />
          <KV k="연면적" v={b.totalFloorArea != null ? `${b.totalFloorArea.toFixed(1)}㎡` : "-"} />
          <KV k="건폐율/용적률" v={`${b.bcr ?? "-"}% / ${b.far ?? "-"}%`} />
          <KV k="층수" v={`지상 ${b.groundFloors ?? "-"} / 지하 ${b.undergroundFloors ?? "-"}`} />
          <KV k="사용승인" v={b.approvedAt ? new Date(b.approvedAt).toISOString().slice(0,10) : "-"} />
        </div>
      ))}
    </Card>
  );
}

function MassingCard({ m }: { m: Massing }) {
  const py = m.maxFloorArea / 3.3058;
  return (
    <Card title="메디컬 빌딩 가설계">
      <KV k="적용 BCR/FAR" v={`${m.bcrLimit}% / ${m.farLimit}%`} />
      <KV k="최대 건축면적 (1층)" v={`${m.maxBuildArea.toFixed(1)}㎡`} />
      <KV k="최대 연면적" v={`${m.maxFloorArea.toFixed(1)}㎡ (${py.toFixed(1)}평)`} hi />
      <KV k="최대 지상층수" v={`${m.maxFloors}층`} />
      <KV k="법정 주차대수" v={`${m.parkingRequired}대`} />
      <KV k="필요 지하층수" v={`${m.basementFloors}층`} />
      <KV k="임대가능면적 (전용 70%)" v={`${m.netRentableArea.toFixed(1)}㎡`} />
      <KV k="추정 공사비" v={`${m.estimatedConstructionCost.toLocaleString()}만원`} hi />
      {m.notes.length > 0 && (
        <ul className="text-xs text-gray-500 list-disc pl-5 mt-2">
          {m.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </Card>
  );
}

function ProformaCard({ p, bench }: { p: Proforma; bench: Benchmark | null }) {
  return (
    <Card title="사업 수지">
      <KV k={`매매 가정가 (${p.saleSource})`} v={`${manwon(p.assumedSaleAmount)}`} />
      <KV k={`적정 월세 (cap ${p.capRatePct}%)`} v={p.estimatedMonthlyRent != null ? `${manwon(p.estimatedMonthlyRent)}` : "-"} hi />
      <KV k="대출가능액" v={`${manwon(p.loanAmount)}`} />
      <KV k="자기자본 (취득세·수수료 포함)" v={`${manwon(p.ownEquity)}`} />
      <KV k="월 이자" v={`-${p.monthlyInterest.toLocaleString()}만`} />
      <KV k="월 순수익" v={p.monthlyNetIncome != null ? `${p.monthlyNetIncome.toLocaleString()}만` : "-"} hi />
      <KV k="자기자본 ROI" v={p.cashOnCashRoiPct != null ? `${p.cashOnCashRoiPct.toFixed(2)}%` : "-"} hi />
      {bench && bench.benchmarkSourceCount > 0 && (
        <div className="text-xs text-gray-500 mt-2 pt-2 border-t">
          벤치마크: cap {bench.regionalCapRate?.toFixed(2) ?? "-"}% · 권역 단가 {bench.regionalRentPerM2 != null ? `${(bench.regionalRentPerM2/10000).toFixed(2)}만/㎡` : "-"} (R-ONE+MOLIT)
        </div>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border bg-white p-4 text-sm space-y-1">
      <h3 className="font-semibold mb-2">{title}</h3>
      {children}
    </div>
  );
}
function KV({ k, v, hi }: { k: string; v: string; hi?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{k}</span>
      <span className={`text-right ${hi ? "font-semibold text-emerald-700" : ""}`}>{v}</span>
    </div>
  );
}
function NumF({ label, v, on, step = 1, allowEmpty }: {
  label: string; v: number | ""; on: (v: number | null) => void; step?: number; allowEmpty?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-gray-500 mb-0.5">{label}</span>
      <input
        type="number" step={step} value={v}
        onChange={e => on(e.target.value === "" ? (allowEmpty ? null : 0) : Number(e.target.value))}
        className="border rounded px-2 py-1.5 w-full"
      />
    </label>
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
