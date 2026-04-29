"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Store {
  id: string;
  code: string;
  bizName: string;
  storeName: string;
  enabled: boolean;
}

interface WorkspaceLite {
  id: string;
  name: string;
}

interface KeywordRow {
  storeName: string;
  keyword: string;
  optionUnits: number;
  bottles: number;
  shipments: number;
  salesAmount: number;
  totalCommission: number;
  totalCost: number;
  profit: number;
}

interface DetailRow {
  storeName: string;
  productName: string;
  optionName: string;
  keyword: string;
  bottlesPerUnit: number;
  quantity: number;
  bottles: number;
  salesAmount: number;
  profit: number;
}

interface ReportSummary {
  reportDate: string;
  totals: { optionUnits: number; bottles: number; shipments: number; salesAmount: number; totalCommission: number; totalCost: number; profit: number };
  byStore: { storeName: string; salesAmount: number; profit: number; bottles: number; shipments: number }[];
  byKeyword: KeywordRow[];
  details: DetailRow[];
}

export default function SalesAdminPage() {
  const [workspace, setWorkspace] = useState<WorkspaceLite | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function refresh() {
    const r = await fetch("/api/sales/overview");
    if (r.ok) {
      const data = await r.json();
      setWorkspace(data.workspace ?? null);
      setStores(data.stores ?? []);
      setReport(data.report ?? null);
      setSheetUrl(data.sheetUrl ?? null);
    } else if (r.status === 404) {
      setMsg("등록된 사업자(워크스페이스)가 없습니다. 먼저 사업자를 등록하세요.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function runSync() {
    setBusy(true);
    setMsg("동기화 중…");
    const r = await fetch("/api/sales/sync", { method: "POST" });
    const data = await r.json();
    setMsg(r.ok ? `완료: ${JSON.stringify(data.results)}` : `실패: ${data.error ?? r.status}`);
    setBusy(false);
    refresh();
  }

  async function runReport() {
    setBusy(true);
    setMsg("보고 발송 중…");
    const r = await fetch("/api/sales/report", { method: "POST" });
    const data = await r.json();
    setMsg(r.ok ? `발송 완료 (텔레그램: ${data.telegram?.ok ? "OK" : data.telegram?.error})` : `실패: ${data.error}`);
    setBusy(false);
  }

  const won = (n: number) => n.toLocaleString("ko-KR") + "원";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">네이버 매출 자동화</h1>
          {workspace && <div className="text-sm text-gray-500">사업자: {workspace.name}</div>}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-50"
            >
              📄 구글시트 열기
            </a>
          )}
          <Link href="/admin/sales/dashboard" className="px-3 py-2 rounded-md bg-emerald-600 text-white text-sm">📊 대시보드</Link>
          <Link href="/admin/sales/workspaces" className="px-3 py-2 rounded-md border text-sm">사업자</Link>
          <Link href="/admin/sales/stores" className="px-3 py-2 rounded-md border text-sm">스토어</Link>
          <Link href="/admin/sales/products" className="px-3 py-2 rounded-md border text-sm">상품</Link>
          <Link href="/admin/sales/costs" className="px-3 py-2 rounded-md bg-gray-900 text-white text-sm">원가/키워드</Link>
          <Link href="/admin/sales/backfill" className="px-3 py-2 rounded-md bg-purple-600 text-white text-sm">📥 1년 백필</Link>
          <Link href="/admin/sales/upload" className="px-3 py-2 rounded-md bg-gray-900 text-white text-sm">매출 업로드</Link>
        </div>
      </div>

      {!sheetUrl && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          구글시트가 아직 연결되지 않았습니다. 시트 ID와 Service Account 키를 환경변수에 등록하면 상단 링크가 활성화됩니다.
        </div>
      )}

      <section className="rounded-md border bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">스토어</h2>
        </div>
        <table className="w-full mt-3 text-sm">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="py-1">코드</th>
              <th>사업자</th>
              <th>스토어</th>
              <th>활성</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="py-1">{s.code}</td>
                <td>{s.bizName}</td>
                <td>{s.storeName}</td>
                <td>{s.enabled ? "ON" : "OFF"}</td>
              </tr>
            ))}
            {stores.length === 0 && (
              <tr>
                <td colSpan={4} className="py-3 text-gray-500">
                  등록된 스토어가 없습니다. .env 의 NAVER_STORE_* 값을 채우고 시드를 실행하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-md border bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">수동 실행</h2>
          <div className="flex gap-2">
            <button
              onClick={runSync}
              disabled={busy}
              className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50"
            >
              네이버 주문 동기화
            </button>
            <button
              onClick={runReport}
              disabled={busy}
              className="px-3 py-2 rounded-md bg-emerald-600 text-white text-sm disabled:opacity-50"
            >
              일일 보고 발송
            </button>
          </div>
        </div>
        {msg && <div className="text-sm text-gray-700">{msg}</div>}
      </section>

      <section className="rounded-md border bg-white p-4">
        <h2 className="font-semibold mb-3">최근 일일 요약 — {report?.reportDate}</h2>
        {!report ? (
          <div className="text-sm text-gray-500">데이터 없음</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <Card label="매출" value={won(report.totals.salesAmount)} />
              <Card label="이익" value={won(report.totals.profit)} />
              <Card label="비용" value={won(report.totals.totalCost)} />
              <Card label="배송 건수" value={`${report.totals.shipments}건`} />
              <Card label="출고 병수" value={`${report.totals.bottles}병`} />
            </div>

            <h3 className="text-sm font-semibold mt-4 mb-2">품종(키워드)별</h3>
            <table className="w-full text-sm mb-6">
              <thead className="text-left text-gray-500">
                <tr>
                  <th>스토어</th>
                  <th>키워드</th>
                  <th className="text-right">옵션수</th>
                  <th className="text-right">병수</th>
                  <th className="text-right">배송건수</th>
                  <th className="text-right">매출</th>
                  <th className="text-right">이익</th>
                </tr>
              </thead>
              <tbody>
                {report.byKeyword.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td>{r.storeName}</td>
                    <td className="font-medium">{r.keyword}</td>
                    <td className="text-right">{r.optionUnits}</td>
                    <td className="text-right">{r.bottles}</td>
                    <td className="text-right">{r.shipments}</td>
                    <td className="text-right">{won(r.salesAmount)}</td>
                    <td className="text-right">{won(r.profit)}</td>
                  </tr>
                ))}
                {report.byKeyword.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-3 text-gray-500">집계 대상 매출 없음</td>
                  </tr>
                )}
              </tbody>
            </table>

            <h3 className="text-sm font-semibold mt-4 mb-2">상세 (옵션별)</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th>스토어</th>
                  <th>상품</th>
                  <th>옵션</th>
                  <th>키워드</th>
                  <th className="text-right">병수/단위</th>
                  <th className="text-right">수량</th>
                  <th className="text-right">매출</th>
                  <th className="text-right">이익</th>
                </tr>
              </thead>
              <tbody>
                {report.details.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td>{r.storeName}</td>
                    <td>{r.productName}</td>
                    <td>{r.optionName}</td>
                    <td>{r.keyword}</td>
                    <td className="text-right">{r.bottlesPerUnit}</td>
                    <td className="text-right">{r.quantity}</td>
                    <td className="text-right">{won(r.salesAmount)}</td>
                    <td className="text-right">{won(r.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-gray-50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
