"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  reportTime: string;
}

export default function WorkspacesPage() {
  const [list, setList] = useState<Workspace[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const router = useRouter();

  async function load() {
    const r = await fetch("/api/workspaces");
    if (r.ok) setList((await r.json()).workspaces ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    const r = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setMsg(r.ok ? "생성됨" : `실패 ${await r.text()}`);
    setName("");
    setBusy(false);
    load();
  }

  async function select(id: string) {
    await fetch("/api/workspaces/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: id }),
    });
    router.push("/admin/sales");
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">
          ← 매출 홈
        </Link>
        <h1 className="text-2xl font-bold">워크스페이스 (사업자)</h1>
      </div>

      <section className="rounded-md border bg-white p-4">
        <h2 className="font-semibold mb-2">새 사업자 등록</h2>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 와이케이홀딩스"
            className="flex-1 border rounded px-2 py-1 text-sm"
          />
          <button onClick={create} disabled={busy || !name.trim()} className="px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:opacity-50">
            추가
          </button>
        </div>
        {msg && <div className="text-sm text-gray-700 mt-2">{msg}</div>}
      </section>

      <section className="rounded-md border bg-white p-4">
        <h2 className="font-semibold mb-3">내 사업자 목록</h2>
        <ul className="divide-y">
          {list.map((w) => (
            <li key={w.id} className="py-2 flex items-center justify-between">
              <div>
                <div className="font-medium">{w.name}</div>
                <div className="text-xs text-gray-500">slug: {w.slug} / 보고 {w.reportTime}</div>
              </div>
              <div className="flex gap-2">
                <Link href={`/admin/sales/workspaces/${w.id}`} className="px-2 py-1 rounded border text-sm">
                  설정
                </Link>
                <button onClick={() => select(w.id)} className="px-2 py-1 rounded bg-gray-900 text-white text-sm">
                  선택
                </button>
              </div>
            </li>
          ))}
          {list.length === 0 && <li className="py-3 text-gray-500 text-sm">등록된 사업자가 없습니다.</li>}
        </ul>
      </section>
    </div>
  );
}
