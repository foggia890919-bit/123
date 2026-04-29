"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Store {
  id: string;
  code: string;
  bizName: string;
  storeName: string;
  clientId: string;
  clientSecret: string; // 항상 *** 또는 빈값
  enabled: boolean;
}

const empty: Omit<Store, "id"> & { id?: string } = {
  code: "",
  bizName: "",
  storeName: "",
  clientId: "",
  clientSecret: "",
  enabled: true,
};

export default function StoresPage() {
  const [list, setList] = useState<Store[]>([]);
  const [draft, setDraft] = useState<typeof empty>({ ...empty });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await fetch("/api/sales/stores");
    if (r.ok) setList((await r.json()).stores ?? []);
    else if (r.status === 404) setMsg("워크스페이스가 없습니다. 먼저 사업자를 등록하세요.");
  }
  useEffect(() => {
    load();
  }, []);

  async function create(skipValidation = false) {
    if (!draft.code || !draft.storeName || !draft.clientId || !draft.clientSecret) {
      setMsg("필수 항목 누락");
      return;
    }
    setBusy(true);
    setMsg(skipValidation ? "강제 저장 중…" : "Naver API 검증 중…");
    const r = await fetch("/api/sales/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, skipValidation }),
    });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (r.ok) {
      setDraft({ ...empty });
      setMsg(`✅ 스토어 추가됨${data?.validated ? " (Naver API 인증 OK)" : ""}`);
      load();
    } else {
      const hint = data?.hint ? `\n💡 ${data.hint}` : "";
      const detail = data?.detail ? `\n${data.detail}` : "";
      setMsg(`❌ ${data?.error ?? r.status}${detail}${hint}`);
    }
  }

  async function save(s: Store) {
    setBusy(true);
    const r = await fetch(`/api/sales/stores/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    setBusy(false);
    setMsg(r.ok ? "저장됨" : "저장 실패");
    load();
  }

  async function remove(s: Store) {
    if (!confirm(`${s.storeName} 삭제? (관련 주문/원가도 모두 삭제됩니다)`)) return;
    setBusy(true);
    const r = await fetch(`/api/sales/stores/${s.id}`, { method: "DELETE" });
    setBusy(false);
    setMsg(r.ok ? "삭제됨" : "삭제 실패");
    load();
  }

  function update<K extends keyof Store>(id: string, key: K, value: Store[K]) {
    setList((rs) => rs.map((x) => (x.id === id ? { ...x, [key]: value } : x)));
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">
          ← 매출 홈
        </Link>
        <h1 className="text-2xl font-bold">네이버 스토어 등록</h1>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        커머스 API 센터에서 발급받은 <b>Client ID / Client Secret</b> 을 등록합니다.
        시크릿은 AES-256-GCM 으로 암호화되어 저장됩니다.
      </div>

      <section className="rounded-md border bg-white p-4">
        <h2 className="font-semibold mb-3">새 스토어</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="스토어 코드 (영문)" value={draft.code} onChange={(v) => setDraft({ ...draft, code: v })} placeholder="VITA / YEOGI / FARM" />
          <Field label="사업자명" value={draft.bizName} onChange={(v) => setDraft({ ...draft, bizName: v })} placeholder="와이케이홀딩스" />
          <Field label="스토어명" value={draft.storeName} onChange={(v) => setDraft({ ...draft, storeName: v })} placeholder="비타앤오리진" />
          <Field label="Client ID" value={draft.clientId} onChange={(v) => setDraft({ ...draft, clientId: v })} placeholder="6IwR..." />
          <Field
            label="Client Secret"
            value={draft.clientSecret}
            onChange={(v) => setDraft({ ...draft, clientSecret: v })}
            placeholder="$2a$04$..."
            type="password"
          />
        </div>
        <div className="mt-3 flex gap-2 flex-wrap">
          <button onClick={() => create(false)} disabled={busy} className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">
            추가 (Naver API 검증)
          </button>
          <button onClick={() => create(true)} disabled={busy} className="px-3 py-2 rounded border text-sm disabled:opacity-50">
            검증 없이 강제 저장
          </button>
          {msg && <div className="text-sm text-gray-700 whitespace-pre-line w-full">{msg}</div>}
        </div>
      </section>

      <section className="rounded-md border bg-white p-4 overflow-x-auto">
        <h2 className="font-semibold mb-3">등록된 스토어 ({list.length})</h2>
        <table className="w-full text-sm min-w-[1000px]">
          <thead className="text-left text-gray-500">
            <tr>
              <th>활성</th>
              <th>코드</th>
              <th>사업자</th>
              <th>스토어</th>
              <th>Client ID</th>
              <th>Client Secret</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="py-1.5">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => update(s.id, "enabled", e.target.checked)} />
                </td>
                <td>{s.code}</td>
                <td>
                  <input className="border rounded px-1 w-32" value={s.bizName} onChange={(e) => update(s.id, "bizName", e.target.value)} />
                </td>
                <td>
                  <input className="border rounded px-1 w-40" value={s.storeName} onChange={(e) => update(s.id, "storeName", e.target.value)} />
                </td>
                <td>
                  <input className="border rounded px-1 w-44 font-mono text-xs" value={s.clientId} onChange={(e) => update(s.id, "clientId", e.target.value)} />
                </td>
                <td>
                  <input
                    className="border rounded px-1 w-44 font-mono text-xs"
                    placeholder="(변경 시에만 입력)"
                    value={s.clientSecret}
                    onChange={(e) => update(s.id, "clientSecret", e.target.value)}
                    type="password"
                  />
                </td>
                <td className="space-x-1">
                  <button onClick={() => save(s)} disabled={busy} className="px-2 py-1 rounded bg-gray-900 text-white text-xs disabled:opacity-50">
                    저장
                  </button>
                  <button onClick={() => remove(s)} disabled={busy} className="px-2 py-1 rounded bg-red-600 text-white text-xs disabled:opacity-50">
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-gray-500">등록된 스토어 없음</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input
        type={type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full border rounded px-2 py-1"
      />
    </label>
  );
}
