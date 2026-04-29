"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Health {
  env: Record<string, boolean>;
  workspace: { hasTelegram: boolean; hasSheet: boolean; reportTime: string };
  stores: { id: string; storeName: string; code: string; enabled: boolean; naverOk: boolean; naverError: string | null; lastSyncedAt: string | null }[];
  recentReport: { reportDate: string; ok: boolean; sentAt: string; message: string | null } | null;
  runningBackfillJobs: number;
  latestOrderPaymentDate: string | null;
}

const REQUIRED_ENV = ["DATABASE_URL", "NEXTAUTH_SECRET", "ENCRYPTION_KEY", "CRON_SECRET"];

export default function HealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [tgMsg, setTgMsg] = useState("");

  async function load() {
    setBusy(true);
    const r = await fetch("/api/sales/health");
    if (r.ok) setData(await r.json());
    setBusy(false);
  }
  useEffect(() => { load(); }, []);

  async function pingTelegram() {
    setTgMsg("발송 중…");
    const r = await fetch("/api/sales/health", { method: "POST" });
    const d = await r.json();
    setTgMsg(d.ok ? "✅ 도착 확인하세요" : `❌ ${d.error}`);
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">← 매출 홈</Link>
        <h1 className="text-2xl font-bold">시스템 상태</h1>
        <button onClick={load} disabled={busy} className="ml-auto px-3 py-1 rounded border text-sm disabled:opacity-50">
          새로고침
        </button>
      </div>

      {!data ? (
        <div className="text-sm text-gray-500">로딩…</div>
      ) : (
        <>
          <Section title="환경변수">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              {Object.entries(data.env).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className={v ? "text-emerald-600" : REQUIRED_ENV.includes(k) ? "text-red-600" : "text-gray-400"}>
                    {v ? "✅" : REQUIRED_ENV.includes(k) ? "❌" : "○"}
                  </span>
                  <span className="font-mono text-xs">{k}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="워크스페이스 채널">
            <div className="flex flex-wrap gap-3 text-sm">
              <Item ok={data.workspace.hasTelegram} label="텔레그램" />
              <Item ok={data.workspace.hasSheet} label="구글시트" />
              <span className="text-sm text-gray-600">보고시각: <b>{data.workspace.reportTime}</b></span>
              <button onClick={pingTelegram} className="px-2 py-1 rounded border text-xs">텔레그램 핑</button>
              {tgMsg && <span className="text-xs text-gray-700">{tgMsg}</span>}
            </div>
          </Section>

          <Section title={`Naver API 연결 (${data.stores.length} 스토어)`}>
            <table className="w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th>스토어</th>
                  <th>활성</th>
                  <th>Naver OK</th>
                  <th>최근 동기화</th>
                  <th>오류</th>
                </tr>
              </thead>
              <tbody>
                {data.stores.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="py-1.5">{s.storeName} ({s.code})</td>
                    <td>{s.enabled ? "✅" : "❌"}</td>
                    <td>{s.naverOk ? "✅" : "❌"}</td>
                    <td className="text-xs text-gray-600">{s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString("ko-KR") : "-"}</td>
                    <td className="text-xs text-red-700">{s.naverError ?? ""}</td>
                  </tr>
                ))}
                {data.stores.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-500">스토어 없음</td></tr>}
              </tbody>
            </table>
          </Section>

          <Section title="최근 활동">
            <div className="space-y-1 text-sm">
              <div>실행 중인 백필 잡: <b>{data.runningBackfillJobs}개</b></div>
              <div>저장된 가장 최근 결제일: <b>{data.latestOrderPaymentDate ? new Date(data.latestOrderPaymentDate).toLocaleString("ko-KR") : "(없음)"}</b></div>
              <div>
                마지막 텔레그램 보고: {data.recentReport
                  ? `${new Date(data.recentReport.reportDate).toISOString().slice(0, 10)} (${data.recentReport.ok ? "✅" : "❌"} ${new Date(data.recentReport.sentAt).toLocaleString("ko-KR")})`
                  : "(없음)"}
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-white p-4 space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Item({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`px-2 py-1 rounded text-xs ${ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{ok ? "✅" : "❌"} {label}</span>;
}
