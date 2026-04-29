"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface StoreLite {
  id: string;
  code: string;
  bizName: string;
  storeName: string;
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

interface Workspace {
  id: string;
  name: string;
  reportTime: string;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  googleSheetsId: string | null;
  googleServiceAccountEmail: string | null;
  googleServiceAccountKey: string | null;
  stores: StoreLite[];
}

export default function WorkspaceSettingsPage() {
  const params = useParams<{ id: string }>();
  const wsId = params.id;
  const [ws, setWs] = useState<Workspace | null>(null);
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await fetch(`/api/workspaces/${wsId}`);
    if (r.ok) setWs((await r.json()).workspace);
  }
  useEffect(() => {
    if (wsId) load();
  }, [wsId]);

  async function save() {
    if (!ws) return;
    const r = await fetch(`/api/workspaces/${wsId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: ws.name,
        reportTime: ws.reportTime,
        telegramBotToken: ws.telegramBotToken,
        telegramChatId: ws.telegramChatId,
        googleSheetsId: ws.googleSheetsId,
        googleServiceAccountEmail: ws.googleServiceAccountEmail,
        googleServiceAccountKey: ws.googleServiceAccountKey,
      }),
    });
    setMsg(r.ok ? "저장됨" : "저장 실패");
    load();
  }

  async function test(kind: "telegram" | "sheet") {
    setMsg(`${kind} 테스트 발송 중…`);
    const r = await fetch(`/api/workspaces/${wsId}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    const d = await r.json();
    setMsg(d.ok ? `✅ ${kind} 테스트 OK` : `❌ ${kind} 실패: ${d.error}`);
  }

  if (!ws) return <div className="p-4">로딩…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/sales/workspaces" className="text-sm text-gray-500 hover:underline">
          ← 사업자 목록
        </Link>
        <h1 className="text-2xl font-bold">{ws.name} — 설정</h1>
      </div>

      <section className="rounded-md border bg-white p-4 space-y-3">
        <h2 className="font-semibold">기본</h2>
        <Field label="사업자명" value={ws.name} onChange={(v) => setWs({ ...ws, name: v })} />
        <Field label="보고 시각 (HH:mm KST)" value={ws.reportTime} onChange={(v) => setWs({ ...ws, reportTime: v })} placeholder="08:00" />
      </section>

      <section className="rounded-md border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">텔레그램</h2>
          <button onClick={() => test("telegram")} className="px-2 py-1 rounded border text-xs">
            테스트 발송
          </button>
        </div>
        <Field
          label="Bot Token"
          value={ws.telegramBotToken ?? ""}
          onChange={(v) => setWs({ ...ws, telegramBotToken: v })}
          placeholder="(바뀌었을 때만 입력) 7891234567:AAH..."
          hint="이미 저장된 값은 *** 로 표시. 변경 시에만 새 값 입력."
        />
        <Field
          label="Chat ID"
          value={ws.telegramChatId ?? ""}
          onChange={(v) => setWs({ ...ws, telegramChatId: v })}
          placeholder="123456789 또는 -1001234567890"
        />
      </section>

      <section className="rounded-md border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">구글시트</h2>
          <button onClick={() => test("sheet")} className="px-2 py-1 rounded border text-xs">
            테스트 쓰기
          </button>
        </div>
        <Field
          label="시트 ID"
          value={ws.googleSheetsId ?? ""}
          onChange={(v) => setWs({ ...ws, googleSheetsId: v })}
          placeholder="docs.google.com/spreadsheets/d/【여기】/edit"
        />
        <Field
          label="Service Account 이메일"
          value={ws.googleServiceAccountEmail ?? ""}
          onChange={(v) => setWs({ ...ws, googleServiceAccountEmail: v })}
          placeholder="sales-bot@xxx.iam.gserviceaccount.com"
        />
        <label className="block text-sm">
          <span className="text-gray-700">Service Account Private Key</span>
          <textarea
            value={ws.googleServiceAccountKey ?? ""}
            onChange={(e) => setWs({ ...ws, googleServiceAccountKey: e.target.value })}
            placeholder="-----BEGIN PRIVATE KEY-----..."
            className="mt-1 block w-full border rounded px-2 py-1 text-xs font-mono h-24"
          />
          <span className="text-xs text-gray-500">JSON 의 private_key 값. 이미 저장된 값은 *** 표시.</span>
        </label>
      </section>

      <section className="rounded-md border bg-white p-4">
        <h2 className="font-semibold mb-2">네이버 스토어</h2>
        <p className="text-xs text-gray-500 mb-2">스토어 추가/수정은 매출 홈에서 진행하세요.</p>
        <ul className="text-sm divide-y">
          {ws.stores.map((s) => (
            <li key={s.id} className="py-1.5 flex items-center justify-between">
              <span>{s.bizName} / {s.storeName} ({s.code})</span>
              <span className="text-xs text-gray-500">{s.enabled ? "ON" : "OFF"}</span>
            </li>
          ))}
          {ws.stores.length === 0 && <li className="py-3 text-gray-500">스토어 없음</li>}
        </ul>
      </section>

      <div className="flex gap-2">
        <button onClick={save} className="px-3 py-2 rounded bg-blue-600 text-white text-sm">
          저장
        </button>
        {msg && <div className="text-sm text-gray-700 self-center">{msg}</div>}
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, hint,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full border rounded px-2 py-1"
      />
      {hint && <span className="text-xs text-gray-500">{hint}</span>}
    </label>
  );
}
