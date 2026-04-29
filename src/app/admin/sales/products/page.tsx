"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Product {
  id: string;
  storeName: string;
  channelProductNo: string;
  productName: string;
  watched: boolean;
  suggestions: string[];
  optionsMapped: number;
  optionsTotal: number;
  lastImportedAt: string | null;
}

export default function ProductsPage() {
  const [list, setList] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("");

  async function load() {
    const r = await fetch("/api/sales/products");
    if (r.ok) setList((await r.json()).products ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleWatch(id: string, watched: boolean) {
    setBusy(true);
    await fetch(`/api/sales/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watched }),
    });
    setBusy(false);
    load();
  }

  async function syncProducts() {
    setBusy(true);
    setMsg("상품 동기화 중…");
    const r = await fetch("/api/sales/products/sync", { method: "POST" });
    const d = await r.json();
    setMsg(r.ok ? `완료: ${JSON.stringify(d.results)}` : `실패: ${d.error}`);
    setBusy(false);
    load();
  }

  const filtered = filter
    ? list.filter((p) => [p.storeName, p.productName].some((s) => s.toLowerCase().includes(filter.toLowerCase())))
    : list;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">
            ← 매출 홈
          </Link>
          <h1 className="text-2xl font-bold">상품 관리</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={syncProducts}
            disabled={busy}
            className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50"
          >
            네이버에서 상품 가져오기
          </button>
        </div>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        보고 대상으로 켠 상품만 일일 매출 보고에 포함됩니다. 키워드 매핑은 「원가 관리」 페이지에서.
      </div>

      <div className="flex gap-2">
        <input
          placeholder="검색"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 border rounded px-2 py-1 text-sm"
        />
      </div>
      {msg && <div className="text-sm text-gray-700">{msg}</div>}

      <section className="rounded-md border bg-white p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="text-left text-gray-500">
            <tr>
              <th>보고</th>
              <th>스토어</th>
              <th>상품</th>
              <th>키워드 추천</th>
              <th className="text-right">옵션 매핑</th>
              <th>최근 수집</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="py-1.5">
                  <input
                    type="checkbox"
                    checked={p.watched}
                    onChange={(e) => toggleWatch(p.id, e.target.checked)}
                    disabled={busy}
                  />
                </td>
                <td>{p.storeName}</td>
                <td>
                  <div className="font-medium">{p.productName}</div>
                  <div className="text-xs text-gray-500">#{p.channelProductNo}</div>
                </td>
                <td>
                  <div className="flex gap-1 flex-wrap">
                    {p.suggestions.map((s) => (
                      <span key={s} className="px-1.5 py-0.5 rounded bg-gray-100 text-xs">
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="text-right">
                  {p.optionsMapped}/{p.optionsTotal}
                </td>
                <td className="text-xs text-gray-500">
                  {p.lastImportedAt ? new Date(p.lastImportedAt).toLocaleString("ko-KR") : "-"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-gray-500">
                  상품 없음. 「네이버에서 상품 가져오기」 버튼으로 동기화하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
