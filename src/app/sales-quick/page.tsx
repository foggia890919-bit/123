"use client";

import { useState, useMemo } from "react";

interface Totals { rows: number; quantity: number; salesAmount: number; totalCommission: number }
interface ByDate { date: string; quantity: number; salesAmount: number }
interface ByOption { productName: string; optionName: string; quantity: number; salesAmount: number; totalCommission: number }
interface ByProduct { productName: string; quantity: number; salesAmount: number; totalCommission: number }
interface ByDateOption { date: string; productName: string; optionName: string; quantity: number; salesAmount: number }
interface Result {
  totals: Totals;
  byDate: ByDate[];
  byOption: ByOption[];
  byProduct: ByProduct[];
  byDateOption: ByDateOption[];
}

const won = (n: number) => n.toLocaleString("ko-KR");

export default function SalesQuickPage() {
  const [file, setFile] = useState<File | null>(null);
  const [storeName, setStoreName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [tab, setTab] = useState<"date" | "option" | "product" | "matrix">("option");
  const [filter, setFilter] = useState("");

  async function analyze() {
    if (!file) {
      setMsg("엑셀/CSV 파일을 선택하세요.");
      return;
    }
    setBusy(true);
    setMsg("분석 중…");
    const fd = new FormData();
    fd.append("file", file);
    if (storeName) fd.append("storeName", storeName);
    const r = await fetch("/api/sales-quick", { method: "POST", body: fd });
    const d = await r.json();
    setBusy(false);
    if (r.ok) {
      setData(d);
      setMsg(`완료 — 총 ${d.totals.rows}건 분석`);
    } else {
      setMsg(`실패: ${d.error ?? r.status}`);
    }
  }

  const filteredOption = useMemo(() => {
    if (!data) return [];
    if (!filter) return data.byOption;
    const f = filter.toLowerCase();
    return data.byOption.filter((r) => r.productName.toLowerCase().includes(f) || r.optionName.toLowerCase().includes(f));
  }, [data, filter]);

  function downloadCsv<T extends object>(rows: readonly T[], filename: string) {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(headers.map((h) => {
        const v = String((r as Record<string, unknown>)[h] ?? "");
        return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-5">
      <div>
        <h1 className="text-2xl font-bold">매출 빠른 분석</h1>
        <p className="text-sm text-gray-600 mt-1">
          스마트스토어센터에서 받으신 주문/매출 엑셀을 그대로 올리시면 옵션별·일자별 매출을 즉시 보여드립니다.
          DB 저장 안 함, 로그인 불필요, 화면 새로고침하면 사라짐.
        </p>
      </div>

      <section className="rounded-md border bg-white p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block text-sm md:col-span-2">
            <span className="text-gray-700">엑셀/CSV 파일</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">스토어명 (라벨용)</span>
            <input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="예: 비타앤오리진"
              className="mt-1 block w-full border rounded px-2 py-1"
            />
          </label>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={analyze}
            disabled={!file || busy}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50"
          >
            {busy ? "분석 중…" : "분석 시작"}
          </button>
          {msg && <span className="text-sm text-gray-700">{msg}</span>}
        </div>
      </section>

      {data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="총 주문건" value={`${data.totals.rows}건`} />
            <Stat label="총 수량" value={`${data.totals.quantity}개`} />
            <Stat label="총 매출" value={won(data.totals.salesAmount) + "원"} />
            <Stat label="총 수수료" value={won(data.totals.totalCommission) + "원"} />
          </section>

          <div className="flex gap-2 flex-wrap items-center">
            <Tab active={tab === "option"} onClick={() => setTab("option")}>옵션별</Tab>
            <Tab active={tab === "product"} onClick={() => setTab("product")}>상품별</Tab>
            <Tab active={tab === "date"} onClick={() => setTab("date")}>일자별</Tab>
            <Tab active={tab === "matrix"} onClick={() => setTab("matrix")}>일자×옵션</Tab>
            <input
              placeholder="검색 (상품/옵션)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="ml-auto border rounded px-2 py-1 text-sm w-60"
            />
          </div>

          {tab === "option" && (
            <Section
              title={`옵션별 (${filteredOption.length})`}
              onDownload={() => downloadCsv(filteredOption, "옵션별매출.csv")}
            >
              <Table
                headers={["상품명", "옵션", "수량", "매출", "수수료"]}
                rows={filteredOption.map((r) => [
                  r.productName,
                  r.optionName,
                  r.quantity,
                  won(r.salesAmount),
                  won(r.totalCommission),
                ])}
                rightAlign={[2, 3, 4]}
                bars={filteredOption.map((r) => r.salesAmount)}
              />
            </Section>
          )}

          {tab === "product" && (
            <Section
              title={`상품별 (${data.byProduct.length})`}
              onDownload={() => downloadCsv(data.byProduct, "상품별매출.csv")}
            >
              <Table
                headers={["상품명", "수량", "매출", "수수료"]}
                rows={data.byProduct.map((r) => [
                  r.productName,
                  r.quantity,
                  won(r.salesAmount),
                  won(r.totalCommission),
                ])}
                rightAlign={[1, 2, 3]}
                bars={data.byProduct.map((r) => r.salesAmount)}
              />
            </Section>
          )}

          {tab === "date" && (
            <Section
              title={`일자별 (${data.byDate.length})`}
              onDownload={() => downloadCsv(data.byDate, "일자별매출.csv")}
            >
              <DateChart points={data.byDate} />
              <Table
                headers={["일자", "수량", "매출"]}
                rows={data.byDate.map((r) => [r.date, r.quantity, won(r.salesAmount)])}
                rightAlign={[1, 2]}
                bars={data.byDate.map((r) => r.salesAmount)}
              />
            </Section>
          )}

          {tab === "matrix" && (
            <Section
              title={`일자×옵션 (${data.byDateOption.length})`}
              onDownload={() => downloadCsv(data.byDateOption, "일자옵션별매출.csv")}
            >
              <Table
                headers={["일자", "상품명", "옵션", "수량", "매출"]}
                rows={data.byDateOption.map((r) => [r.date, r.productName, r.optionName, r.quantity, won(r.salesAmount)])}
                rightAlign={[3, 4]}
              />
            </Section>
          )}
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

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-sm border ${active ? "bg-gray-900 text-white border-gray-900" : "bg-white"}`}
    >
      {children}
    </button>
  );
}

function Section({ title, onDownload, children }: { title: string; onDownload: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-white p-4 overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={onDownload} className="px-2 py-1 rounded border text-xs hover:bg-gray-50">
          ⬇ CSV 다운로드
        </button>
      </div>
      {children}
    </section>
  );
}

function Table({
  headers, rows, rightAlign = [], bars = [],
}: { headers: string[]; rows: (string | number)[][]; rightAlign?: number[]; bars?: number[] }) {
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
          <tr><td colSpan={headers.length + (bars.length > 0 ? 1 : 0)} className="py-3 text-gray-500">데이터 없음</td></tr>
        )}
      </tbody>
    </table>
  );
}

function DateChart({ points }: { points: { date: string; salesAmount: number; quantity: number }[] }) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.salesAmount));
  const width = Math.max(600, points.length * 40);
  const height = 220;
  const barW = (width - 40) / points.length;
  return (
    <div className="overflow-x-auto mb-4">
      <svg width={width} height={height} className="block">
        <line x1={30} y1={height - 30} x2={width} y2={height - 30} stroke="#ddd" />
        {points.map((p, i) => {
          const h = ((height - 50) * p.salesAmount) / max;
          const x = 30 + i * barW;
          return (
            <g key={p.date}>
              <rect x={x + 4} y={height - 30 - h} width={barW - 10} height={h} fill="#3b82f6" />
              <text x={x + barW / 2} y={height - 14} fontSize={10} textAnchor="middle" fill="#666">
                {p.date.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
