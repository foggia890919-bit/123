"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Rule {
  id: string;
  keyword: string;
  patterns: string;
  priority: number;
  bottlesRule: string | null;
  enabled: boolean;
}

const empty: Omit<Rule, "id"> = { keyword: "", patterns: "", priority: 10, bottlesRule: "", enabled: true };

export default function KeywordsPage() {
  const [list, setList] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Omit<Rule, "id">>(empty);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Test 입력
  const [testText, setTestText] = useState("");
  const [testResult, setTestResult] = useState<{ keyword: string; bottlesPerUnit: number; matchedBy?: string } | null>(null);

  async function load() {
    const r = await fetch("/api/sales/keywords");
    if (r.ok) setList((await r.json()).rules ?? []);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!draft.keyword.trim() || !draft.patterns.trim()) {
      setMsg("키워드와 패턴 필수");
      return;
    }
    setBusy(true);
    const r = await fetch("/api/sales/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setBusy(false);
    setMsg(r.ok ? "추가됨" : "실패");
    setDraft(empty);
    load();
  }

  async function save(rule: Rule) {
    setBusy(true);
    const r = await fetch(`/api/sales/keywords/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule),
    });
    setBusy(false);
    setMsg(r.ok ? "저장됨" : "실패");
  }

  async function remove(id: string) {
    if (!confirm("이 룰을 삭제할까요?")) return;
    setBusy(true);
    await fetch(`/api/sales/keywords/${id}`, { method: "DELETE" });
    setBusy(false);
    load();
  }

  async function autoApply(dryRun: boolean) {
    setBusy(true);
    setMsg("적용 중…");
    const r = await fetch("/api/sales/costs/auto-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlyEmpty: true, dryRun, force: false }),
    });
    const d = await r.json();
    setBusy(false);
    if (r.ok) {
      setMsg(`${dryRun ? "🔍 미리보기" : "✅ 적용 완료"} — 총 ${d.total}건 (신규 ${d.created} / 업데이트 ${d.updated})`);
    } else {
      setMsg(`실패: ${d.error}`);
    }
  }

  function update<K extends keyof Rule>(id: string, key: K, value: Rule[K]) {
    setList((rs) => rs.map((x) => (x.id === id ? { ...x, [key]: value } : x)));
  }

  function runTest() {
    // 클라이언트 측 미리보기 — 룰 직접 적용
    const text = testText;
    let matched: { keyword: string; pattern: string } | null = null;
    const sorted = [...list].filter((r) => r.enabled).sort((a, b) => b.priority - a.priority);
    for (const r of sorted) {
      const pats = r.patterns.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
      for (const p of pats) {
        if (text.toLowerCase().includes(p.toLowerCase())) {
          matched = { keyword: r.keyword, pattern: p };
          break;
        }
      }
      if (matched) break;
    }
    const m = text.match(/(\d+)\s*(?:병|개|입|set|세트|팩)/i);
    const bottles = m ? parseInt(m[1], 10) : 1;
    setTestResult({ keyword: matched?.keyword ?? "", bottlesPerUnit: bottles, matchedBy: matched?.pattern });
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">← 매출 홈</Link>
        <h1 className="text-2xl font-bold">키워드 자동매핑 룰</h1>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        옵션명에 패턴이 들어있으면 자동으로 키워드를 부여합니다. 예: <code>옵션명 = &ldquo;피쿠알 1병&rdquo;</code> →
        키워드 <b>피쿠알</b>, 병수 <b>1</b>.
        <br />패턴은 콤마 또는 줄바꿈으로 구분. 정규식 쓰려면 <code>/regex/i</code> 형태로.
      </div>

      <section className="rounded-md border bg-white p-4 space-y-3">
        <h2 className="font-semibold">룰 추가</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="키워드 (정답)" value={draft.keyword} onChange={(v) => setDraft({ ...draft, keyword: v })} placeholder="피쿠알" />
          <Field label="우선순위 (높을수록 먼저)" value={String(draft.priority)} onChange={(v) => setDraft({ ...draft, priority: parseInt(v, 10) || 0 })} />
          <Field label="병수 추출 정규식 (선택)" value={draft.bottlesRule ?? ""} onChange={(v) => setDraft({ ...draft, bottlesRule: v })} placeholder="(\d+)\s*병" />
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">패턴 (콤마/줄바꿈 구분)</span>
          <textarea
            value={draft.patterns}
            onChange={(e) => setDraft({ ...draft, patterns: e.target.value })}
            placeholder="피쿠알, picual, Picual"
            className="mt-1 block w-full border rounded px-2 py-1 h-16 font-mono text-xs"
          />
        </label>
        <div className="flex gap-2">
          <button onClick={create} disabled={busy} className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">추가</button>
          {msg && <span className="self-center text-sm text-gray-700">{msg}</span>}
        </div>
      </section>

      <section className="rounded-md border bg-white p-4 space-y-3">
        <h2 className="font-semibold">패턴 테스트</h2>
        <div className="flex gap-2">
          <input
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="예: 피쿠알 2병 세트"
            className="flex-1 border rounded px-2 py-1 text-sm"
          />
          <button onClick={runTest} className="px-3 py-1 rounded bg-gray-900 text-white text-sm">테스트</button>
        </div>
        {testResult && (
          <div className="text-sm">
            결과 → 키워드: <b>{testResult.keyword || "(매칭 없음)"}</b>, 병수: <b>{testResult.bottlesPerUnit}</b>
            {testResult.matchedBy && <span className="text-gray-500"> · 패턴 「{testResult.matchedBy}」</span>}
          </div>
        )}
      </section>

      <section className="rounded-md border bg-white p-4 overflow-x-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">룰 목록 ({list.length})</h2>
          <div className="flex gap-2">
            <button onClick={() => autoApply(true)} disabled={busy} className="px-2 py-1 rounded border text-xs disabled:opacity-50">
              🔍 미리보기 (적용 안함)
            </button>
            <button onClick={() => autoApply(false)} disabled={busy} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs disabled:opacity-50">
              ✨ 빈 옵션에 자동 채우기
            </button>
          </div>
        </div>
        <table className="w-full text-sm min-w-[900px]">
          <thead className="text-left text-gray-500">
            <tr>
              <th>활성</th>
              <th>키워드</th>
              <th>패턴</th>
              <th className="text-right">우선순위</th>
              <th>병수 정규식</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="py-1.5">
                  <input type="checkbox" checked={r.enabled} onChange={(e) => update(r.id, "enabled", e.target.checked)} />
                </td>
                <td>
                  <input className="border rounded px-1 w-24" value={r.keyword} onChange={(e) => update(r.id, "keyword", e.target.value)} />
                </td>
                <td>
                  <textarea
                    className="border rounded px-1 w-72 h-12 font-mono text-xs"
                    value={r.patterns}
                    onChange={(e) => update(r.id, "patterns", e.target.value)}
                  />
                </td>
                <td className="text-right">
                  <input type="number" className="border rounded px-1 w-16 text-right" value={r.priority} onChange={(e) => update(r.id, "priority", parseInt(e.target.value, 10) || 0)} />
                </td>
                <td>
                  <input className="border rounded px-1 w-32 font-mono text-xs" value={r.bottlesRule ?? ""} onChange={(e) => update(r.id, "bottlesRule", e.target.value)} />
                </td>
                <td className="space-x-1 whitespace-nowrap">
                  <button onClick={() => save(r)} disabled={busy} className="px-2 py-1 rounded bg-gray-900 text-white text-xs disabled:opacity-50">저장</button>
                  <button onClick={() => remove(r.id)} disabled={busy} className="px-2 py-1 rounded bg-red-600 text-white text-xs disabled:opacity-50">삭제</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={6} className="py-3 text-gray-500">룰 없음. 가입 시 자동 시드되는데 안 보이면 위에서 추가하세요.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 block w-full border rounded px-2 py-1" />
    </label>
  );
}
