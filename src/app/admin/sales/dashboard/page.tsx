"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Store { id: string; storeName: string; code: string }
interface DayPoint { date: string; sales: number; profit: number; bottles: number; shipments: number }
interface KeywordRow { keyword: string; sales: number; profit: number; bottles: number; shipments: number }
interface StoreRow { storeId: string; storeName: string; sales: number; profit: number; bottles: number }
interface DashData {
  range: { fromKst: string; toKst: string; days: number };
  totals: { sales: number; profit: number; bottles: number; shipments: number };
  daily: DayPoint[];
  byKeyword: KeywordRow[];
  byStore: StoreRow[];
  stores: Store[];
}

const won = (n: number) => n.toLocaleString("ko-KR");

export default function DashboardPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [days, setDays] = useState(14);
  const [storeId, setStoreId] = useState("");
  const [keyword, setKeyword] = useState("");

  async function load() {
    const params = new URLSearchParams({ days: String(days), storeId, keyword });
    const r = await fetch(`/api/sales/dashboard?${params}`);
    if (r.ok) setData(await r.json());
  }
  useEffect(() => {
    load();
  }, [days, storeId, keyword]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">
            ← 매출 홈
          </Link>
          <h1 className="text-2xl font-bold">대시보드</h1>
        </div>
        <div className="flex gap-2 items-center text-sm">
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} className="border rounded px-2 py-1">
            <option value={7}>최근 7일</option>
            <option value={14}>최근 14일</option>
            <option value={30}>최근 30일</option>
            <option value={60}>최근 60일</option>
            <option value={90}>최근 90일</option>
          </select>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="border rounded px-2 py-1">
            <option value="">모든 스토어</option>
            {data?.stores.map((s) => (
              <option key={s.id} value={s.id}>{s.storeName}</option>
            ))}
          </select>
          <input
            placeholder="키워드 (예: 피쿠알)"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="border rounded px-2 py-1 w-40"
          />
        </div>
      </div>

      {!data ? (
        <div className="text-sm text-gray-500">로딩…</div>
      ) : (
        <>
          <div className="text-xs text-gray-500">{data.range.fromKst} ~ {data.range.toKst}</div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="매출" value={won(data.totals.sales) + "원"} />
            <Stat label="이익" value={won(data.totals.profit) + "원"} />
            <Stat label="배송 건수" value={`${data.totals.shipments}건`} />
            <Stat label="출고 병수" value={`${data.totals.bottles}병`} />
          </div>

          <section className="rounded-md border bg-white p-4">
            <h2 className="font-semibold mb-3">일별 매출/이익</h2>
            <BarChart points={data.daily} />
          </section>

          <section className="rounded-md border bg-white p-4 overflow-x-auto">
            <h2 className="font-semibold mb-3">키워드별 (상위)</h2>
            <table className="w-full text-sm min-w-[700px]">
              <thead className="text-left text-gray-500">
                <tr>
                  <th>키워드</th>
                  <th className="text-right">매출</th>
                  <th className="text-right">이익</th>
                  <th className="text-right">병수</th>
                  <th className="text-right">배송</th>
                  <th>비중</th>
                </tr>
              </thead>
              <tbody>
                {data.byKeyword.slice(0, 20).map((r) => {
                  const ratio = data.totals.sales > 0 ? (r.sales / data.totals.sales) * 100 : 0;
                  return (
                    <tr key={r.keyword} className="border-t">
                      <td className="py-1.5 font-medium">{r.keyword}</td>
                      <td className="text-right">{won(r.sales)}</td>
                      <td className="text-right">{won(r.profit)}</td>
                      <td className="text-right">{r.bottles}</td>
                      <td className="text-right">{r.shipments}</td>
                      <td>
                        <div className="h-2 bg-gray-100 rounded">
                          <div className="h-2 bg-blue-500 rounded" style={{ width: `${ratio}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {data.byKeyword.length === 0 && (
                  <tr><td colSpan={6} className="py-3 text-gray-500">데이터 없음</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="rounded-md border bg-white p-4">
            <h2 className="font-semibold mb-3">스토어별</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th>스토어</th>
                  <th className="text-right">매출</th>
                  <th className="text-right">이익</th>
                  <th className="text-right">병수</th>
                </tr>
              </thead>
              <tbody>
                {data.byStore.map((s) => (
                  <tr key={s.storeId} className="border-t">
                    <td className="py-1.5">{s.storeName}</td>
                    <td className="text-right">{won(s.sales)}</td>
                    <td className="text-right">{won(s.profit)}</td>
                    <td className="text-right">{s.bottles}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-gray-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function BarChart({ points }: { points: DayPoint[] }) {
  if (points.length === 0) return <div className="text-sm text-gray-500">데이터 없음</div>;
  const max = Math.max(1, ...points.map((p) => p.sales));
  const width = Math.max(600, points.length * 40);
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
              <rect x={x + 4} y={height - 30 - salesH} width={(barW - 10) / 2} height={salesH} fill="#3b82f6" />
              <rect x={x + 4 + (barW - 10) / 2} y={height - 30 - profitH} width={(barW - 10) / 2} height={profitH} fill="#10b981" />
              <text x={x + barW / 2} y={height - 14} fontSize={10} textAnchor="middle" fill="#666">
                {p.date.slice(5)}
              </text>
            </g>
          );
        })}
        <text x={5} y={20} fontSize={10} fill="#3b82f6">■ 매출</text>
        <text x={60} y={20} fontSize={10} fill="#10b981">■ 이익</text>
      </svg>
    </div>
  );
}
