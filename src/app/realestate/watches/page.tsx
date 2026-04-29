"use client";

import { useEffect, useState } from "react";

interface Watch {
  id: string;
  name: string;
  enabled: boolean;
  cortarNos: string[];
  propertyTypes: string[];
  tradeTypes: string[];
  priceSaleMax: number | null;
  priceDepositMax: number | null;
  priceMonthlyMax: number | null;
  areaMinM2: number | null;
  areaMaxM2: number | null;
  floorMin: number | null;
  floorMax: number | null;
  keywords: string[];
  excludeKeywords: string[];
  notifySms: boolean;
  notifyTelegram: boolean;
  smsTo: string | null;
  telegramChatId: string | null;
}

const empty: Omit<Watch, "id"> = {
  name: "",
  enabled: true,
  cortarNos: [],
  propertyTypes: ["상가", "사무실"],
  tradeTypes: ["매매", "월세"],
  priceSaleMax: null,
  priceDepositMax: null,
  priceMonthlyMax: null,
  areaMinM2: null,
  areaMaxM2: null,
  floorMin: null,
  floorMax: null,
  keywords: [],
  excludeKeywords: [],
  notifySms: false,
  notifyTelegram: false,
  smsTo: null,
  telegramChatId: null,
};

export default function WatchesPage() {
  const [items, setItems] = useState<Watch[]>([]);
  const [draft, setDraft] = useState<Omit<Watch, "id">>(empty);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/realestate/watches");
    if (!res.ok) return;
    const j = await res.json();
    setItems(j.items ?? []);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/realestate/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        alert(`저장 실패: ${await res.text()}`);
        return;
      }
      setDraft(empty);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(w: Watch) {
    await fetch("/api/realestate/watches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: w.id, enabled: !w.enabled }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm("삭제할까요?")) return;
    await fetch(`/api/realestate/watches?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">알림 조건 (워치)</h1>
        <p className="text-sm text-gray-500">조건에 부합하는 신규 매물이 들어오면 SMS/텔레그램으로 알림.</p>
      </header>

      <section className="rounded border bg-white p-4 space-y-3">
        <h2 className="font-semibold">새 워치 추가</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Field label="이름">
            <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="강남역 2번출구 상가 1층"
              className="border rounded px-2 py-1 w-full" />
          </Field>
          <Field label="cortarNo (쉼표 구분)">
            <input value={draft.cortarNos.join(",")} onChange={e => setDraft(d => ({ ...d, cortarNos: split(e.target.value) }))}
              placeholder="1168010100,1168010300"
              className="border rounded px-2 py-1 w-full" />
          </Field>
          <Field label="매물종류">
            <input value={draft.propertyTypes.join(",")} onChange={e => setDraft(d => ({ ...d, propertyTypes: split(e.target.value) }))}
              className="border rounded px-2 py-1 w-full" />
          </Field>
          <Field label="거래유형">
            <input value={draft.tradeTypes.join(",")} onChange={e => setDraft(d => ({ ...d, tradeTypes: split(e.target.value) }))}
              className="border rounded px-2 py-1 w-full" />
          </Field>
          <Field label="매매가 상한 (만원)">
            <NumInput v={draft.priceSaleMax} onChange={v => setDraft(d => ({ ...d, priceSaleMax: v }))} />
          </Field>
          <Field label="보증금 상한 (만원)">
            <NumInput v={draft.priceDepositMax} onChange={v => setDraft(d => ({ ...d, priceDepositMax: v }))} />
          </Field>
          <Field label="월세 상한 (만원)">
            <NumInput v={draft.priceMonthlyMax} onChange={v => setDraft(d => ({ ...d, priceMonthlyMax: v }))} />
          </Field>
          <Field label="전용 ㎡ 범위 (min,max)">
            <div className="flex gap-1">
              <NumInput v={draft.areaMinM2} onChange={v => setDraft(d => ({ ...d, areaMinM2: v }))} />
              <NumInput v={draft.areaMaxM2} onChange={v => setDraft(d => ({ ...d, areaMaxM2: v }))} />
            </div>
          </Field>
          <Field label="층 범위 (min,max)">
            <div className="flex gap-1">
              <NumInput v={draft.floorMin} onChange={v => setDraft(d => ({ ...d, floorMin: v }))} />
              <NumInput v={draft.floorMax} onChange={v => setDraft(d => ({ ...d, floorMax: v }))} />
            </div>
          </Field>
          <Field label="키워드 포함 (쉼표)">
            <input value={draft.keywords.join(",")} onChange={e => setDraft(d => ({ ...d, keywords: split(e.target.value) }))}
              placeholder="대로변,코너,1층"
              className="border rounded px-2 py-1 w-full" />
          </Field>
          <Field label="키워드 제외">
            <input value={draft.excludeKeywords.join(",")} onChange={e => setDraft(d => ({ ...d, excludeKeywords: split(e.target.value) }))}
              placeholder="지하,권리금"
              className="border rounded px-2 py-1 w-full" />
          </Field>
          <Field label="SMS 수신번호">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={draft.notifySms}
                onChange={e => setDraft(d => ({ ...d, notifySms: e.target.checked }))} />
              <input value={draft.smsTo ?? ""} onChange={e => setDraft(d => ({ ...d, smsTo: e.target.value }))}
                placeholder="010-0000-0000" className="border rounded px-2 py-1 flex-1" />
            </div>
          </Field>
          <Field label="텔레그램 chat_id">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={draft.notifyTelegram}
                onChange={e => setDraft(d => ({ ...d, notifyTelegram: e.target.checked }))} />
              <input value={draft.telegramChatId ?? ""} onChange={e => setDraft(d => ({ ...d, telegramChatId: e.target.value }))}
                placeholder="123456789" className="border rounded px-2 py-1 flex-1" />
            </div>
          </Field>
        </div>
        <button disabled={busy || !draft.name} onClick={save}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
          {busy ? "저장…" : "추가"}
        </button>
      </section>

      <section className="rounded border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left px-3 py-2">사용</th>
              <th className="text-left px-3 py-2">이름</th>
              <th className="text-left px-3 py-2">cortarNos</th>
              <th className="text-left px-3 py-2">조건 요약</th>
              <th className="text-left px-3 py-2">알림</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map(w => (
              <tr key={w.id}>
                <td className="px-3 py-2"><input type="checkbox" checked={w.enabled} onChange={() => toggle(w)} /></td>
                <td className="px-3 py-2 font-medium">{w.name}</td>
                <td className="px-3 py-2 text-gray-500">{w.cortarNos.join(",") || "-"}</td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {w.tradeTypes.join("/")} · {w.propertyTypes.join("/")} ·
                  {w.priceSaleMax ? ` 매매≤${w.priceSaleMax}` : ""}
                  {w.priceDepositMax ? ` 보증금≤${w.priceDepositMax}` : ""}
                  {w.priceMonthlyMax ? ` 월세≤${w.priceMonthlyMax}` : ""}
                  {w.areaMinM2 || w.areaMaxM2 ? ` 면적${w.areaMinM2 ?? ""}~${w.areaMaxM2 ?? ""}㎡` : ""}
                </td>
                <td className="px-3 py-2 text-xs">
                  {w.notifySms && `SMS→${w.smsTo}`}
                  {w.notifyTelegram && ` TG→${w.telegramChatId}`}
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => remove(w.id)} className="text-red-600 text-xs">삭제</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">워치 없음</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-gray-500 mb-0.5">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ v, onChange }: { v: number | null; onChange: (v: number | null) => void }) {
  return (
    <input
      type="number"
      value={v ?? ""}
      onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="border rounded px-2 py-1 w-full"
    />
  );
}

function split(v: string): string[] {
  return v.split(",").map(s => s.trim()).filter(Boolean);
}
