"use client";

import { useEffect, useState } from "react";

interface Report {
  id: string;
  reportDate: string;
  status: string;
  channel: string;
  recipient: string | null;
  summaryText: string | null;
  error: string | null;
  sentAt: string | null;
}

export default function ReportsPage() {
  const [items, setItems] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const r = await fetch("/api/realestate/reports");
      const j = await r.json();
      setItems(j.reports ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const r = await fetch("/api/realestate/reports", { method: "POST" });
      const j = await r.json();
      alert(j.status === "SENT" ? "발송 완료" : `상태: ${j.status}\n${j.text?.slice(0, 200) ?? ""}`);
      load();
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">일일 다이제스트</h1>
          <p className="text-sm text-gray-500">매일 아침 자동 발송. 점수 Top 5 + 어제 신규 매물·분양.</p>
        </div>
        <button onClick={runNow} disabled={running}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
          {running ? "생성 중…" : "지금 생성"}
        </button>
      </header>

      <div className="space-y-3">
        {items.map(r => (
          <article key={r.id} className="rounded border bg-white p-4">
            <div className="flex justify-between text-sm">
              <div>
                <span className="font-semibold">{new Date(r.reportDate).toISOString().slice(0, 10)}</span>
                <span className="ml-2 text-gray-500">{r.channel} {r.recipient ? `→ ${r.recipient}` : ""}</span>
              </div>
              <Status s={r.status} />
            </div>
            {r.summaryText && (
              <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-700 font-mono bg-gray-50 p-3 rounded">{r.summaryText}</pre>
            )}
            {r.error && <div className="text-xs text-red-600 mt-2">{r.error}</div>}
          </article>
        ))}
        {items.length === 0 && !busy && (
          <div className="text-center text-sm text-gray-400 p-6">보고서 없음 — &quot;지금 생성&quot; 클릭</div>
        )}
      </div>
    </div>
  );
}

function Status({ s }: { s: string }) {
  const cls = s === "SENT" ? "bg-emerald-50 text-emerald-700"
    : s === "FAILED" ? "bg-red-50 text-red-700"
    : "bg-gray-100 text-gray-600";
  return <span className={`px-2 py-0.5 rounded text-xs ${cls}`}>{s}</span>;
}
