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
  const [detailId, setDetailId] = useState<string | null>(null);

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
                <tr key={it.id} onClick={() => setDetailId(it.id)} className={`border-t hover:bg-blue-50 cursor-pointer ${canceled ? "bg-red-50/40" : ""}`}>
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

      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

interface DetailItem {
  productOrderId: string;
  productName: string;
  optionName: string;
  channelProductNo: string | null;
  sellerProductCode: string | null;
  quantity: number;
  unitPrice: number;
  optionPrice: number;
  discountAmount: number;
  salesAmount: number;
  payCommission: number;
  channelCommission: number;
  settlementAmount: number;
  deliveryFee: number;
  paymentMethod: string | null;
  status: string | null;
  detailStatus: string | null;
  order: { orderId: string; buyerName: string | null; paymentDate: string; totalAmount: number; store: { storeName: string; bizName: string; code: string } };
}
interface DetailData {
  item: DetailItem;
  raw: unknown;
  cost: { keyword: string; bottlesPerUnit: number; unitCost: number; shippingCost: number; fulfillCost: number; packagingCost: number; etcCost: number } | null;
  computed: { totalCommission: number; perUnitCost: number; totalCost: number; profit: number };
}

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  useEffect(() => {
    fetch(`/api/sales/orders/${id}`).then(async (r) => { if (r.ok) setData(await r.json()); });
  }, [id]);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-md shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b px-4 py-3 flex justify-between items-center">
          <h2 className="font-semibold">주문 상세</h2>
          <button onClick={onClose} className="text-gray-500 text-xl leading-none px-2">×</button>
        </div>
        {!data ? (
          <div className="p-4 text-gray-500 text-sm">로딩…</div>
        ) : (
          <div className="p-4 space-y-4 text-sm">
            <Field2 label="주문번호 / 상품주문번호" value={`${data.item.order.orderId} / ${data.item.productOrderId}`} />
            <Field2 label="결제일" value={new Date(data.item.order.paymentDate).toLocaleString("ko-KR")} />
            <Field2 label="구매자" value={data.item.order.buyerName ?? "-"} />
            <Field2 label="스토어" value={`${data.item.order.store.storeName} (${data.item.order.store.bizName})`} />

            <hr />
            <Field2 label="상품 / 옵션" value={`${data.item.productName} / ${data.item.optionName}`} />
            <Field2 label="채널 상품번호" value={data.item.channelProductNo ?? "-"} />
            <Field2 label="판매자 상품코드" value={data.item.sellerProductCode ?? "-"} />
            <Field2 label="수량 × 단가" value={`${data.item.quantity} × ${data.item.unitPrice.toLocaleString("ko-KR")}원 (옵션가 ${data.item.optionPrice.toLocaleString("ko-KR")}원)`} />
            <Field2 label="할인" value={`${data.item.discountAmount.toLocaleString("ko-KR")}원`} />
            <Field2 label="매출 (총주문금액)" value={`${data.item.salesAmount.toLocaleString("ko-KR")}원`} />
            <Field2 label="결제수단" value={data.item.paymentMethod ?? "-"} />
            <Field2 label="상태" value={`${data.item.status ?? "-"} / ${data.item.detailStatus ?? "-"}`} />

            <hr />
            <h3 className="font-semibold">수수료/정산 (네이버 제공)</h3>
            <Field2 label="결제수수료 (네이버페이)" value={`${data.item.payCommission.toLocaleString("ko-KR")}원`} />
            <Field2 label="채널수수료 (매출연동)" value={`${data.item.channelCommission.toLocaleString("ko-KR")}원`} />
            <Field2 label="정산예정금액" value={`${data.item.settlementAmount.toLocaleString("ko-KR")}원`} />
            <Field2 label="배송비" value={`${data.item.deliveryFee.toLocaleString("ko-KR")}원`} />

            <hr />
            <h3 className="font-semibold">원가 매핑 + 이익 계산</h3>
            {data.cost ? (
              <>
                <Field2 label="키워드 / 병수단위" value={`${data.cost.keyword || "(미매핑)"} / ${data.cost.bottlesPerUnit}`} />
                <Field2 label="단가 합산 (1회 판매당)" value={`${data.computed.perUnitCost.toLocaleString("ko-KR")}원 = 원가 ${data.cost.unitCost} + 물류 ${data.cost.shippingCost} + 입출고 ${data.cost.fulfillCost} + 부자재 ${data.cost.packagingCost} + 기타 ${data.cost.etcCost}`} />
              </>
            ) : (
              <div className="text-gray-500">원가 매핑 안됨 (이익 = 매출 − 수수료 만 반영)</div>
            )}
            <Field2 label="총 비용" value={`${data.computed.totalCost.toLocaleString("ko-KR")}원 (수수료 포함)`} />
            <Field2 label="이익" value={`${data.computed.profit.toLocaleString("ko-KR")}원`} highlight />
          </div>
        )}
      </div>
    </div>
  );
}

function Field2({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-gray-500 text-xs">{label}</div>
      <div className={`col-span-2 ${highlight ? "font-semibold text-emerald-700" : ""}`}>{value}</div>
    </div>
  );
}
