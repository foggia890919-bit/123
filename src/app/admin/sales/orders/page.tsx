"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Item {
  id: string;
  productOrderId: string;
  orderId: string;
  store: string;
  buyerName: string | null;
  paymentDate: string;
  productName: string;
  optionName: string;
  keyword: string;
  quantity: number;
  bottlesPerUnit: number;
  salesAmount: number;
  commission: number;
  status: string | null;
  detailStatus: string | null;
}

interface StoreOption { id: string; storeName: string; code: string }

const won = (n: number) => n.toLocaleString("ko-KR");

export default function OrdersPage() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size] = useState(50);
  const [q, setQ] = useState("");
  const [storeId, setStoreId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    const params = new URLSearchParams({ q, storeId, from, to, page: String(page), size: String(size) });
    const [oRes, sRes] = await Promise.all([
      fetch(`/api/sales/orders?${params}`),
      stores.length === 0 ? fetch("/api/sales/stores") : null,
    ]);
    if (oRes.ok) {
      const d = await oRes.json();
      setItems(d.items ?? []);
      setTotal(d.total ?? 0);
    }
    if (sRes && sRes.ok) setStores((await sRes.json()).stores ?? []);
    setBusy(false);
  }
  useEffect(() => { load(); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function search() {
    setPage(1);
    load();
  }

  const totalPages = Math.max(1, Math.ceil(total / size));
  const sumSales = useMemo(() => items.reduce((a, b) => a + b.salesAmount, 0), [items]);
  const sumQty = useMemo(() => items.reduce((a, b) => a + b.quantity, 0), [items]);

  function isCanceled(it: Item): boolean {
    return /취소|반품|환불|cancel|refund|return/i.test(`${it.status ?? ""} ${it.detailStatus ?? ""}`);
  }

  async function exportCsv() {
    setBusy(true);
    // 모든 페이지 다 가져오기 (최대 5000건)
    const params = new URLSearchParams({ q, storeId, from, to, page: "1", size: "5000" });
    const r = await fetch(`/api/sales/orders?${params}`);
    setBusy(false);
    if (!r.ok) return;
    const d = await r.json();
    const rows: Item[] = d.items ?? [];
    const headers = ["결제일","스토어","상품","옵션","키워드","수량","병수단위","매출","수수료","상태","구매자","주문번호","상품주문번호"];
    const lines = [headers.join(",")];
    for (const it of rows) {
      const cells = [
        new Date(it.paymentDate).toLocaleString("ko-KR", { hour12: false }),
        it.store, it.productName, it.optionName, it.keyword,
        String(it.quantity), String(it.bottlesPerUnit), String(it.salesAmount), String(it.commission),
        `${it.detailStatus || it.status || ""}`, it.buyerName ?? "", it.orderId, it.productOrderId,
      ];
      lines.push(cells.map((v) => v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `주문_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">← 매출 홈</Link>
        <h1 className="text-2xl font-bold">주문 검색</h1>
      </div>

      <section className="rounded-md border bg-white p-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
        <input
          placeholder="검색 (상품/옵션/주문번호/구매자)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          className="border rounded px-2 py-1 col-span-2"
        />
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="border rounded px-2 py-1">
          <option value="">모든 스토어</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.storeName}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1" />
        <button onClick={search} disabled={busy} className="md:col-span-5 px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:opacity-50">
          검색
        </button>
      </section>

      <div className="text-sm text-gray-600 flex gap-4 flex-wrap items-center">
        <span>총 <b>{total.toLocaleString()}</b>건</span>
        <span>현재 페이지 매출: {won(sumSales)}원</span>
        <span>수량: {sumQty}개</span>
        <button onClick={exportCsv} disabled={busy} className="ml-auto px-2 py-1 rounded border text-xs disabled:opacity-50">
          ⬇ CSV 내보내기 (검색결과 최대 5000건)
        </button>
      </div>

      <section className="rounded-md border bg-white overflow-x-auto">
        <table className="text-sm w-full min-w-[1100px]">
          <thead className="text-left text-gray-500 bg-gray-50">
            <tr>
              <th className="py-2 px-2">결제일</th>
              <th>스토어</th>
              <th>상품</th>
              <th>옵션</th>
              <th>키워드</th>
              <th className="text-right">수량</th>
              <th className="text-right">매출</th>
              <th className="text-right">수수료</th>
              <th>상태</th>
              <th>구매자</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const canceled = isCanceled(it);
              return (
                <tr key={it.id} className={`border-t hover:bg-gray-50 ${canceled ? "bg-red-50/40" : ""}`}>
                  <td className="py-1 px-2">{new Date(it.paymentDate).toLocaleString("ko-KR", { hour12: false })}</td>
                  <td>{it.store}</td>
                  <td className={canceled ? "line-through text-gray-500" : ""}>{it.productName}</td>
                  <td className={canceled ? "line-through text-gray-500" : ""}>{it.optionName}</td>
                  <td>
                    {it.keyword ? <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-xs">{it.keyword}</span> : <span className="text-gray-400 text-xs">미매핑</span>}
                  </td>
                  <td className="text-right">{it.quantity}{it.bottlesPerUnit > 1 ? <span className="text-gray-500 text-xs"> ×{it.bottlesPerUnit}</span> : ""}</td>
                  <td className={`text-right ${canceled ? "line-through text-red-700" : ""}`}>{won(it.salesAmount)}</td>
                  <td className="text-right text-gray-600">{won(it.commission)}</td>
                  <td className="text-xs">
                    {canceled ? (
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded">{it.detailStatus || it.status}</span>
                    ) : (
                      <span className="text-gray-600">{it.detailStatus || it.status}</span>
                    )}
                  </td>
                  <td className="text-xs text-gray-600">{it.buyerName ?? "-"}</td>
                </tr>
              );
            })}
            {items.length === 0 && !busy && (
              <tr><td colSpan={10} className="py-4 text-center text-gray-500">결과 없음</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="flex justify-between items-center text-sm">
        <div>{page} / {totalPages} 페이지</div>
        <div className="flex gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1 || busy} className="px-3 py-1 border rounded disabled:opacity-50">이전</button>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages || busy} className="px-3 py-1 border rounded disabled:opacity-50">다음</button>
        </div>
      </div>
    </div>
  );
}
