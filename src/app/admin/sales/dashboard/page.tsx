"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Store { id: string; storeName: string; code: string }
interface DayPoint { date: string; sales: number; profit: number; quantity: number; bottles: number; shipments: number }
interface KeywordRow { keyword: string; sales: number; profit: number; bottles: number; shipments: number; quantity: number }
interface StoreRow { storeId: string; storeName: string; sales: number; profit: number; bottles: number; quantity: number; shipments: number }
interface ProductRow { productName: string; sales: number; quantity: number; bottles: number }
interface WeekdayRow { weekday: number; sales: number; quantity: number; shipments: number }
interface HourRow { hour: number; sales: number; shipments: number }
interface Totals { sales: number; profit: number; bottles: number; quantity: number; shipments: number }
interface DashData {
  range: { fromKst: string; toKst: string; days: number };
  totals: Totals;
  compare: null | {
    totals: Totals;
    delta: { sales: number; profit: number; quantity: number; bottles: number; shipments: number; salesPct: number | null; profitPct: number | null };
  };
  daily: DayPoint[];
  byKeyword: KeywordRow[];
  byStore: StoreRow[];
  byProduct: ProductRow[];
  byWeekday: WeekdayRow[];
  byHour: HourRow[];
  stores: Store[];
}

const won = (n: number) => n.toLocaleString("ko-KR");
const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

type Preset = "7" | "14" | "30" | "60" | "90" | "180" | "365" | "custom";

export default function DashboardPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<Preset>("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [storeId, setStoreId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [compare, setCompare] = useState(true);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ storeId, keyword, compare: compare ? "1" : "0" });
    if (preset === "custom" && from && to) {
      params.set("from", from);
      params.set("to", to);
    } else if (preset !== "custom") {
      params.set("days", preset);
    }
    const r = await fetch(`/api/sales/dashboard?${params}`);
    if (r.ok) setData(await r.json());
    setLoading(false);
  }
  useEffect(() => { load(); }, [preset, storeId, keyword, compare, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">← 매출 홈</Link>
          <h1 className="text-2xl font-bold">대시보드</h1>
        </div>
        <div className="flex gap-2 items-center text-sm flex-wrap">
          <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="border rounded px-2 py-1">
            <option value="7">최근 7일</option>
            <option value="14">최근 14일</option>
            <option value="30">최근 30일</option>
            <option value="60">최근 60일</option>
            <option value="90">최근 90일</option>
            <option value="180">최근 180일</option>
            <option value="365">최근 1년</option>
            <option value="custom">사용자 지정</option>
          </select>
          {preset === "custom" && (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1" />
              <span>~</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1" />
            </>
          )}
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="border rounded px-2 py-1">
            <option value="">모든 스토어</option>
            {data?.stores.map((s) => <option key={s.id} value={s.id}>{s.storeName}</option>)}
          </select>
          <input
            placeholder="키워드 (예: 피쿠알)"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="border rounded px-2 py-1 w-36"
          />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            전기간 비교
          </label>
        </div>
      </div>

      {loading && <div className="text-sm text-gray-500">불러오는 중…</div>}

      {data && (
        <>
          <div className="text-xs text-gray-500">
            {data.range.fromKst} ~ {data.range.toKst} ({data.range.days}일)
            {data.compare && <span className="ml-2 text-gray-400">vs 직전 {data.range.days}일</span>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="매출" value={won(data.totals.sales) + "원"} delta={data.compare?.delta.sales} pct={data.compare?.delta.salesPct ?? null} />
            <Stat label="이익" value={won(data.totals.profit) + "원"} delta={data.compare?.delta.profit} pct={data.compare?.delta.profitPct ?? null} />
            <Stat label="배송 건수" value={`${data.totals.shipments}건`} delta={data.compare?.delta.shipments ?? null} />
            <Stat label="수량" value={`${data.totals.quantity}개`} delta={data.compare?.delta.quantity ?? null} />
            <Stat label="출고 병수" value={`${data.totals.bottles}병`} delta={data.compare?.delta.bottles ?? null} />
          </div>

          <section className="rounded-md border bg-white p-4">
            <h2 className="font-semibold mb-3">일별 매출/이익</h2>
            <BarChart points={data.daily} />
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="rounded-md border bg-white p-4">
              <h2 className="font-semibold mb-3">요일별 (KST)</h2>
              <WeekdayBar rows={data.byWeekday} total={data.totals.sales} />
            </section>
            <section className="rounded-md border bg-white p-4">
              <h2 className="font-semibold mb-3">시간대별 (KST)</h2>
              <HourBar rows={data.byHour} />
            </section>
          </div>

          <section className="rounded-md border bg-white p-4 overflow-x-auto">
            <h2 className="font-semibold mb-3">키워드별 (상위)</h2>
            <Table
              headers={["키워드", "수량", "병수", "배송", "매출", "이익"]}
              rows={data.byKeyword.slice(0, 30).map((r) => [
                r.keyword, r.quantity, r.bottles, r.shipments, won(r.sales) + "원", won(r.profit) + "원",
              ])}
              rightAlign={[1, 2, 3, 4, 5]}
              bars={data.byKeyword.slice(0, 30).map((r) => r.sales)}
            />
          </section>

          <section className="rounded-md border bg-white p-4 overflow-x-auto">
            <h2 className="font-semibold mb-3">상품별 베스트셀러 TOP 20</h2>
            <Table
              headers={["상품명", "수량", "매출"]}
              rows={data.byProduct.map((r) => [r.productName, r.quantity, won(r.sales) + "원"])}
              rightAlign={[1, 2]}
              bars={data.byProduct.map((r) => r.sales)}
            />
          </section>

          <section className="rounded-md border bg-white p-4">
            <h2 className="font-semibold mb-3">스토어별</h2>
            <Table
              headers={["스토어", "수량", "병수", "배송", "매출", "이익"]}
              rows={data.byStore.map((r) => [r.storeName, r.quantity, r.bottles, r.shipments, won(r.sales) + "원", won(r.profit) + "원"])}
              rightAlign={[1, 2, 3, 4, 5]}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, delta, pct }: { label: string; value: string; delta?: number | null; pct?: number | null }) {
  const positive = (delta ?? 0) > 0;
  const negative = (delta ?? 0) < 0;
  return (
    <div className="rounded-md border bg-gray-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {delta !== undefined && delta !== null && delta !== 0 && (
        <div className={`text-xs ${positive ? "text-emerald-700" : negative ? "text-red-700" : "text-gray-500"}`}>
          {positive ? "▲" : negative ? "▼" : ""} {Math.abs(delta).toLocaleString("ko-KR")}
          {pct !== null && pct !== undefined && Number.isFinite(pct) && ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`}
        </div>
      )}
    </div>
  );
}

function BarChart({ points }: { points: DayPoint[] }) {
  if (points.length === 0) return <div className="text-sm text-gray-500">데이터 없음</div>;
  const max = Math.max(1, ...points.map((p) => p.sales));
  const width = Math.max(600, points.length * 28);
  const height = 220;
  const barW = (width - 40) / points.length;
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="block">
        <line x1={30} y1={height - 30} x2={width} y2={height - 30} stroke="#ddd" />
        {points.map((p, i) => {
          const salesH = ((height - 50) * p.sales) / max;
          const profitH = ((height - 50) * Math.max(0, p.profit)) / max;
          const x = 30 + i * barW;
          return (
            <g key={p.date}>
              <title>{`${p.date} 매출 ${p.sales.toLocaleString()}원 / 이익 ${p.profit.toLocaleString()}원 / ${p.shipments}건`}</title>
              <rect x={x + 2} y={height - 30 - salesH} width={Math.max(2, (barW - 6) / 2)} height={salesH} fill="#3b82f6" />
              <rect x={x + 2 + (barW - 6) / 2} y={height - 30 - profitH} width={Math.max(2, (barW - 6) / 2)} height={profitH} fill="#10b981" />
              {(i % Math.max(1, Math.floor(points.length / 14)) === 0 || i === points.length - 1) && (
                <text x={x + barW / 2} y={height - 14} fontSize={10} textAnchor="middle" fill="#666">
                  {p.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
        <text x={5} y={20} fontSize={10} fill="#3b82f6">■ 매출</text>
        <text x={60} y={20} fontSize={10} fill="#10b981">■ 이익</text>
      </svg>
    </div>
  );
}

function WeekdayBar({ rows, total }: { rows: WeekdayRow[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.sales));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const pct = (r.sales / max) * 100;
        const share = total > 0 ? (r.sales / total) * 100 : 0;
        return (
          <div key={r.weekday} className="flex items-center gap-2 text-sm">
            <span className="w-6 text-gray-500">{WEEKDAY_KO[r.weekday]}</span>
            <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
              <div className="h-4 bg-blue-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-32 text-right text-xs text-gray-600">{won(r.sales)}원 ({share.toFixed(1)}%)</span>
          </div>
        );
      })}
    </div>
  );
}

function HourBar({ rows }: { rows: HourRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.sales));
  return (
    <div className="grid grid-cols-12 gap-1">
      {rows.map((r) => {
        const h = max > 0 ? (r.sales / max) * 60 : 0;
        return (
          <div key={r.hour} className="flex flex-col items-center" title={`${r.hour}시: ${won(r.sales)}원`}>
            <div className="w-full bg-gray-100 rounded-sm flex items-end" style={{ height: 60 }}>
              <div className="w-full bg-blue-500 rounded-sm" style={{ height: h }} />
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">{r.hour}</div>
          </div>
        );
      })}
    </div>
  );
}

function Table({ headers, rows, rightAlign = [], bars = [] }: { headers: string[]; rows: (string | number)[][]; rightAlign?: number[]; bars?: number[] }) {
  const max = bars.length > 0 ? Math.max(1, ...bars) : 0;
  return (
    <table className="w-full text-sm min-w-[700px]">
      <thead className="text-left text-gray-500">
        <tr>
          {headers.map((h, i) => (
            <th key={h} className={rightAlign.includes(i) ? "text-right" : ""}>{h}</th>
          ))}
          {bars.length > 0 && <th>비중</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-t">
            {row.map((c, j) => (
              <td key={j} className={`py-1 ${rightAlign.includes(j) ? "text-right" : ""}`}>{c}</td>
            ))}
            {bars.length > 0 && (
              <td className="w-32">
                <div className="h-2 bg-gray-100 rounded">
                  <div className="h-2 bg-blue-500 rounded" style={{ width: `${(bars[i] / max) * 100}%` }} />
                </div>
              </td>
            )}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={headers.length + (bars.length > 0 ? 1 : 0)} className="py-3 text-gray-500 text-center">데이터 없음</td></tr>
        )}
      </tbody>
    </table>
  );
}
