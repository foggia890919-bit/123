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

interface KeywordAlert {
  keyword: string;
  severity: "DROP" | "SPIKE" | "NEW" | "GONE";
  lastQty: number;
  prevQty: number;
  pct: number | null;
  message: string;
}

interface HomeData {
  today: { sales: number; quantity: number; shipments: number; commission: number; canceledCount: number };
  yesterday: { sales: number; quantity: number; shipments: number };
  last7: { sales: number; quantity: number; shipments: number };
  prev7: { sales: number };
  delta7: { sales: number; salesPct: number | null; shipments: number };
  keywordAlerts: KeywordAlert[];
  backfillJobs: { id: string; storeName: string; status: string; ordersAdded: number; cursor: string; toDate: string }[];
  newProducts: { id: string; productName: string; storeName: string; createdAt: string }[];
  lastReport: { date: string; ok: boolean; sentAt: string; message: string | null } | null;
}

export default function SalesAdminPage() {
  const [workspace, setWorkspace] = useState<WorkspaceLite | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function refresh() {
    const [oR, hR] = await Promise.all([fetch("/api/sales/overview"), fetch("/api/sales/home")]);
    if (oR.ok) {
      const data = await oR.json();
      setWorkspace(data.workspace ?? null);
      setStores(data.stores ?? []);
      setReport(data.report ?? null);
      setSheetUrl(data.sheetUrl ?? null);
    } else if (oR.status === 404) {
      setMsg("등록된 사업자(워크스페이스)가 없습니다. 먼저 사업자를 등록하세요.");
    }
    if (hR.ok) setHome(await hR.json());
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
      <div className="space-y-3">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">네이버 매출 자동화</h1>
            {workspace && <div className="text-sm text-gray-500">사업자: {workspace.name}</div>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/admin/sales/dashboard" className="px-3 py-2 rounded-md bg-emerald-600 text-white text-sm">📊 대시보드</Link>
            <Link href="/admin/sales/orders" className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm">🔍 주문 검색</Link>
            {sheetUrl && (
              <a href={sheetUrl} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-md border bg-white text-sm">📄 시트</a>
            )}
          </div>
        </div>
        <NavMenu />
      </div>

      {stores.length === 0 && (
        <div className="rounded-md border border-blue-300 bg-blue-50 p-4 text-sm text-blue-900 flex items-center justify-between flex-wrap gap-2">
          <div>
            <b>아직 등록된 스토어가 없습니다.</b><br />
            「초기설정」 위저드를 따라 사업자/스토어/텔레그램/백필을 한 번에 셋업하세요.
          </div>
          <Link href="/admin/sales/onboarding" className="px-3 py-2 rounded bg-blue-600 text-white text-sm">초기설정 시작 →</Link>
        </div>
      )}

      {home && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiCard
            title="오늘 매출 (KST 진행 중)"
            primary={won(home.today.sales)}
            sub={`${home.today.shipments}건 / ${home.today.quantity}개${home.today.canceledCount > 0 ? ` · 취소 ${home.today.canceledCount}건 제외` : ""}`}
          />
          <KpiCard
            title="어제 마감"
            primary={won(home.yesterday.sales)}
            sub={`${home.yesterday.shipments}건 / ${home.yesterday.quantity}개`}
          />
          <KpiCard
            title="최근 7일 매출"
            primary={won(home.last7.sales)}
            sub={
              home.delta7.salesPct !== null
                ? `직전 7일 대비 ${home.delta7.salesPct >= 0 ? "▲" : "▼"} ${Math.abs(home.delta7.salesPct).toFixed(1)}%`
                : `${home.last7.shipments}건`
            }
            tone={home.delta7.salesPct !== null ? (home.delta7.salesPct >= 0 ? "up" : "down") : "neutral"}
          />
        </div>
      )}

      {home && home.keywordAlerts.length > 0 && (
        <section className="rounded-md border bg-white p-4">
          <h3 className="font-semibold mb-2 text-sm">📣 키워드 추세 알림 (지난 7일 vs 그 직전 7일)</h3>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            {home.keywordAlerts.map((a) => {
              const color = a.severity === "DROP" || a.severity === "GONE" ? "bg-red-50 border-red-200 text-red-900"
                : a.severity === "SPIKE" || a.severity === "NEW" ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-gray-50 border-gray-200";
              return (
                <li key={a.keyword} className={`rounded px-2 py-1.5 border ${color}`}>
                  <b>{a.keyword}</b> — {a.message}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {home && (home.backfillJobs.length > 0 || home.newProducts.length > 0 || home.lastReport) && (
        <section className="rounded-md border bg-white p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <h3 className="font-semibold mb-2 text-sm">백필 진행</h3>
            {home.backfillJobs.length === 0 ? (
              <div className="text-xs text-gray-500">실행 중인 잡 없음</div>
            ) : (
              <ul className="space-y-1">
                {home.backfillJobs.map((j) => {
                  const total = new Date(j.toDate).getTime() - new Date(home.backfillJobs[0].cursor).getTime();
                  const remain = Math.max(0, new Date(j.toDate).getTime() - new Date(j.cursor).getTime());
                  const pct = total > 0 ? Math.max(0, Math.min(100, ((total - remain) / total) * 100)) : 100;
                  return (
                    <li key={j.id} className="text-xs">
                      <div className="flex justify-between">
                        <span>{j.storeName}</span>
                        <span className={`px-1.5 rounded ${j.status === "DONE" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>{j.status}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded mt-1"><div className="h-1.5 bg-purple-500 rounded" style={{ width: `${pct}%` }} /></div>
                      <div className="text-gray-500 mt-0.5">주문 {j.ordersAdded.toLocaleString()}건 누적</div>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link href="/admin/sales/backfill" className="text-xs text-blue-600 hover:underline mt-2 block">전체 보기 →</Link>
          </div>
          <div>
            <h3 className="font-semibold mb-2 text-sm">신규 상품</h3>
            {home.newProducts.length === 0 ? (
              <div className="text-xs text-gray-500">최근 추가 없음</div>
            ) : (
              <ul className="space-y-1">
                {home.newProducts.map((p) => (
                  <li key={p.id} className="text-xs">
                    <div className="font-medium">{p.productName}</div>
                    <div className="text-gray-500">{p.storeName} · {new Date(p.createdAt).toLocaleDateString("ko-KR")}</div>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/admin/sales/products" className="text-xs text-blue-600 hover:underline mt-2 block">전체 보기 →</Link>
          </div>
          <div>
            <h3 className="font-semibold mb-2 text-sm">최근 텔레그램 보고</h3>
            {home.lastReport ? (
              <div className="text-xs">
                <div className="font-medium">{new Date(home.lastReport.date).toISOString().slice(0, 10)} 보고</div>
                <div className={home.lastReport.ok ? "text-emerald-700" : "text-red-700"}>
                  {home.lastReport.ok ? "✅ 발송 성공" : `❌ 실패: ${home.lastReport.message ?? ""}`}
                </div>
                <div className="text-gray-500">{new Date(home.lastReport.sentAt).toLocaleString("ko-KR")}</div>
              </div>
            ) : (
              <div className="text-xs text-gray-500">발송 이력 없음</div>
            )}
          </div>
        </section>
      )}

      {!sheetUrl && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          구글시트가 아직 연결되지 않았습니다. 워크스페이스 설정에서 시트 ID 와 Service Account 를 등록하세요.
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

function NavMenu() {
  const groups: { label: string; items: { href: string; label: string; emoji?: string; primary?: boolean }[] }[] = [
    {
      label: "설정",
      items: [
        { href: "/admin/sales/onboarding", label: "초기설정", emoji: "⚙️" },
        { href: "/admin/sales/workspaces", label: "사업자" },
        { href: "/admin/sales/stores", label: "스토어" },
      ],
    },
    {
      label: "데이터",
      items: [
        { href: "/admin/sales/products", label: "상품" },
        { href: "/admin/sales/keywords", label: "키워드룰" },
        { href: "/admin/sales/costs", label: "원가/매핑", primary: true },
      ],
    },
    {
      label: "수집",
      items: [
        { href: "/admin/sales/backfill", label: "1년 백필", emoji: "📥", primary: true },
        { href: "/admin/sales/upload", label: "엑셀 업로드" },
      ],
    },
    {
      label: "운영",
      items: [
        { href: "/admin/sales/health", label: "시스템 상태", emoji: "🩺" },
      ],
    },
  ];
  return (
    <details className="rounded-md border bg-gray-50 p-2 group">
      <summary className="cursor-pointer text-sm text-gray-700 px-2 py-1 select-none flex items-center gap-2">
        <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
        전체 메뉴
      </summary>
      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3 px-2 pb-2">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="text-xs text-gray-500 mb-1">{g.label}</div>
            <div className="flex flex-wrap gap-1">
              {g.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className={`px-2 py-1 rounded text-xs ${it.primary ? "bg-gray-900 text-white" : "bg-white border text-gray-700"}`}
                >
                  {it.emoji ? `${it.emoji} ` : ""}{it.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function KpiCard({ title, primary, sub, tone }: { title: string; primary: string; sub: string; tone?: "up" | "down" | "neutral" }) {
  const subColor = tone === "up" ? "text-emerald-700" : tone === "down" ? "text-red-700" : "text-gray-500";
  return (
    <div className="rounded-md border bg-white p-4">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-2xl font-bold mt-1">{primary}</div>
      <div className={`text-xs ${subColor} mt-1`}>{sub}</div>
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
