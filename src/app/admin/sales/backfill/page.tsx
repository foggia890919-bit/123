"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Store { id: string; code: string; storeName: string }
interface Job {
  id: string;
  store: Store;
  fromDate: string;
  toDate: string;
  cursor: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  ordersAdded: number;
  itemsAdded: number;
  errors: string[] | null;
  createdAt: string;
  updatedAt: string;
}

const statusColor: Record<Job["status"], string> = {
  PENDING: "bg-gray-200 text-gray-700",
  RUNNING: "bg-blue-200 text-blue-900",
  DONE: "bg-emerald-200 text-emerald-900",
  FAILED: "bg-red-200 text-red-900",
};

function fmt(d: string) {
  return new Date(d).toISOString().slice(0, 10);
}

function progress(j: Job): number {
  const total = new Date(j.toDate).getTime() - new Date(j.fromDate).getTime();
  const done = new Date(j.cursor).getTime() - new Date(j.fromDate).getTime();
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, (done / total) * 100));
}

export default function BackfillPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [storeId, setStoreId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const [sR, jR] = await Promise.all([fetch("/api/sales/stores"), fetch("/api/sales/backfill")]);
    if (sR.ok) {
      const ss = (await sR.json()).stores ?? [];
      setStores(ss);
      if (!storeId && ss[0]) setStoreId(ss[0].id);
    }
    if (jR.ok) setJobs((await jR.json()).jobs ?? []);
  }
  useEffect(() => {
    load();
    // 진행 중 잡이 있으면 자동 새로고침
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 기본값: 1년 전 ~ 어제
  useEffect(() => {
    if (!fromDate || !toDate) {
      const today = new Date();
      const ymd = (d: Date) => d.toISOString().slice(0, 10);
      const yest = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
      setFromDate(ymd(yearAgo));
      setToDate(ymd(yest));
    }
  }, [fromDate, toDate]);

  async function createJob() {
    if (!storeId || !fromDate || !toDate) {
      setMsg("스토어/시작일/종료일 모두 입력");
      return;
    }
    setBusy("create");
    const r = await fetch("/api/sales/backfill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, fromDate, toDate }),
    });
    const d = await r.json();
    setBusy(null);
    setMsg(r.ok ? `잡 생성됨 (${d.days}일)` : `실패: ${d.error}`);
    load();
  }

  async function runJob(id: string, days: number) {
    setBusy(id);
    const r = await fetch(`/api/sales/backfill/${id}/run?days=${days}`, { method: "POST" });
    const d = await r.json();
    setBusy(null);
    if (r.ok) {
      setMsg(`✓ ${d.processed}일 처리 — 주문 ${d.ordersAdded} / 품목 ${d.itemsAdded}` +
        (d.errors?.length ? ` / 오류 ${d.errors.length}건` : ""));
    } else {
      setMsg(`실패: ${d.error}`);
    }
    load();
  }

  async function deleteJob(id: string) {
    if (!confirm("이 잡을 삭제하시겠어요? (저장된 데이터는 유지)")) return;
    setBusy(id);
    await fetch(`/api/sales/backfill/${id}`, { method: "DELETE" });
    setBusy(null);
    load();
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">← 매출 홈</Link>
        <h1 className="text-2xl font-bold">과거 매출 백필 (~1년)</h1>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        네이버 API 로 과거 결제완료 주문을 하루씩 끌어와서 DB 에 저장합니다.
        한 번에 많이 받으면 API 제한에 걸리니 7일씩 끊어 처리합니다 (5분마다 자동 진행).
        진행 중에 화면 닫아도 백그라운드 cron 이 이어서 처리합니다.
      </div>

      <section className="rounded-md border bg-white p-4 space-y-3">
        <h2 className="font-semibold">새 백필 잡</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <label className="block text-sm">
            <span className="text-gray-700">스토어</span>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="mt-1 block w-full border rounded px-2 py-1">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.storeName} ({s.code})</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">시작일 (KST)</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 block w-full border rounded px-2 py-1" />
          </label>
          <label className="block text-sm">
            <span className="text-gray-700">종료일 (KST, exclusive)</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 block w-full border rounded px-2 py-1" />
          </label>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={createJob} disabled={busy === "create"} className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">
            잡 생성
          </button>
          {msg && <span className="text-sm text-gray-700">{msg}</span>}
        </div>
      </section>

      <section className="rounded-md border bg-white p-4 overflow-x-auto">
        <h2 className="font-semibold mb-3">진행 중 / 완료된 잡</h2>
        <table className="w-full text-sm min-w-[900px]">
          <thead className="text-left text-gray-500">
            <tr>
              <th>스토어</th>
              <th>기간</th>
              <th>커서</th>
              <th>상태</th>
              <th className="text-right">주문</th>
              <th className="text-right">품목</th>
              <th>진행률</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-t align-top">
                <td className="py-1.5">{j.store.storeName}</td>
                <td>{fmt(j.fromDate)} ~ {fmt(j.toDate)}</td>
                <td>{fmt(j.cursor)}</td>
                <td>
                  <span className={`px-2 py-0.5 rounded text-xs ${statusColor[j.status]}`}>{j.status}</span>
                  {j.errors && j.errors.length > 0 && (
                    <details className="mt-1 text-xs text-red-700">
                      <summary>오류 {j.errors.length}건</summary>
                      <pre className="whitespace-pre-wrap max-w-xs">{j.errors.slice(-5).join("\n")}</pre>
                    </details>
                  )}
                </td>
                <td className="text-right">{j.ordersAdded.toLocaleString()}</td>
                <td className="text-right">{j.itemsAdded.toLocaleString()}</td>
                <td className="w-40">
                  <div className="h-2 bg-gray-100 rounded">
                    <div className="h-2 bg-blue-500 rounded" style={{ width: `${progress(j)}%` }} />
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{progress(j).toFixed(1)}%</div>
                </td>
                <td className="space-x-1 whitespace-nowrap">
                  {j.status !== "DONE" && (
                    <>
                      <button onClick={() => runJob(j.id, 7)} disabled={busy === j.id} className="px-2 py-1 rounded bg-gray-900 text-white text-xs disabled:opacity-50">
                        7일 처리
                      </button>
                      <button onClick={() => runJob(j.id, 30)} disabled={busy === j.id} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs disabled:opacity-50">
                        30일 처리
                      </button>
                    </>
                  )}
                  <button onClick={() => deleteJob(j.id)} disabled={busy === j.id} className="px-2 py-1 rounded bg-red-600 text-white text-xs disabled:opacity-50">
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td colSpan={8} className="py-3 text-gray-500">잡 없음. 위에서 새로 만들어 시작하세요.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
