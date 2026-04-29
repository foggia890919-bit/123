"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3 | 4 | 5;

interface Workspace { id: string; name: string; reportTime: string; telegramBotToken: string | null; telegramChatId: string | null }

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Step 1: 사업자
  const [wsName, setWsName] = useState("");

  // Step 2: 스토어
  const [storeCode, setStoreCode] = useState("");
  const [storeBizName, setStoreBizName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  // Step 3: 텔레그램
  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");

  // Step 4: 백필 기간
  const [backfillFrom, setBackfillFrom] = useState("");
  const [backfillTo, setBackfillTo] = useState("");

  async function loadCurrent() {
    const r = await fetch("/api/sales/overview");
    if (r.ok) {
      const d = await r.json();
      if (d.workspace) {
        const w = await fetch(`/api/workspaces/${d.workspace.id}`);
        if (w.ok) setWorkspace((await w.json()).workspace);
      }
    }
  }
  useEffect(() => { loadCurrent(); }, []);

  useEffect(() => {
    // 백필 기본값
    const today = new Date();
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    setBackfillTo(ymd(new Date(today.getTime() - 24 * 60 * 60 * 1000)));
    setBackfillFrom(ymd(new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)));
  }, []);

  // ───── Step 1
  async function saveWorkspaceName() {
    if (!workspace || !wsName.trim()) return;
    setBusy(true);
    const r = await fetch(`/api/workspaces/${workspace.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: wsName.trim() }),
    });
    setBusy(false);
    setMsg(r.ok ? "저장됨" : "실패");
    if (r.ok) {
      setWorkspace({ ...workspace, name: wsName.trim() });
      setStep(2);
    }
  }

  // ───── Step 2
  async function addStore() {
    if (!storeCode || !storeName || !clientId || !clientSecret) {
      setMsg("필수 항목 입력");
      return;
    }
    setBusy(true);
    const r = await fetch("/api/sales/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: storeCode,
        bizName: storeBizName || workspace?.name,
        storeName,
        clientId,
        clientSecret,
      }),
    });
    setBusy(false);
    if (r.ok) {
      setMsg("스토어 추가됨");
      setStoreCode(""); setStoreName(""); setClientId(""); setClientSecret(""); setStoreBizName("");
    } else {
      setMsg(`실패: ${await r.text()}`);
    }
  }

  // ───── Step 3
  async function saveTelegram() {
    if (!workspace) return;
    setBusy(true);
    const r = await fetch(`/api/workspaces/${workspace.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telegramBotToken: tgToken, telegramChatId: tgChatId, reportTime: "09:00" }),
    });
    setBusy(false);
    setMsg(r.ok ? "저장됨" : "실패");
  }

  async function testTelegram() {
    if (!workspace) return;
    setBusy(true);
    const r = await fetch(`/api/workspaces/${workspace.id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "telegram" }),
    });
    const d = await r.json();
    setBusy(false);
    setMsg(d.ok ? "✅ 텔레그램 도착 확인하세요" : `❌ ${d.error}`);
  }

  // ───── Step 4 백필
  async function startBackfill() {
    setBusy(true);
    setMsg("백필 잡 생성 중…");
    const sRes = await fetch("/api/sales/stores");
    const stores = sRes.ok ? (await sRes.json()).stores ?? [] : [];
    let created = 0;
    for (const s of stores as { id: string; storeName: string }[]) {
      const r = await fetch("/api/sales/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: s.id, fromDate: backfillFrom, toDate: backfillTo }),
      });
      if (r.ok) created += 1;
    }
    setBusy(false);
    setMsg(`✅ ${created}개 스토어 백필 시작 — 백그라운드 cron 이 자동 진행`);
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">← 매출 홈</Link>
        <h1 className="text-2xl font-bold">초기 설정 (5단계)</h1>
      </div>

      <Stepper step={step} onJump={setStep} />

      {step === 1 && workspace && (
        <Step title="1. 사업자 이름 설정" desc="사업자(법인/개인사업자) 단위로 데이터가 격리됩니다.">
          <Field label="사업자명" value={wsName || workspace.name} onChange={setWsName} placeholder={workspace.name} />
          <div className="flex gap-2">
            <button onClick={saveWorkspaceName} disabled={busy} className="px-3 py-2 rounded bg-blue-600 text-white text-sm">저장 후 다음</button>
            <button onClick={() => setStep(2)} className="px-3 py-2 rounded border text-sm">건너뛰기</button>
          </div>
        </Step>
      )}

      {step === 2 && (
        <Step title="2. 네이버 스토어 등록" desc="커머스 API 센터에서 받은 Client ID / Secret 을 입력하세요. 시크릿은 자동 암호화됩니다.">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="스토어 코드 (영문)" value={storeCode} onChange={setStoreCode} placeholder="VITA" />
            <Field label="사업자명 (선택)" value={storeBizName} onChange={setStoreBizName} placeholder="와이케이홀딩스" />
            <Field label="스토어명" value={storeName} onChange={setStoreName} placeholder="비타앤오리진" />
            <Field label="Client ID" value={clientId} onChange={setClientId} placeholder="6IwR..." />
            <Field label="Client Secret" value={clientSecret} onChange={setClientSecret} placeholder="$2a$04$..." type="password" />
          </div>
          <div className="flex gap-2">
            <button onClick={addStore} disabled={busy} className="px-3 py-2 rounded bg-blue-600 text-white text-sm">추가</button>
            <button onClick={() => setStep(3)} className="px-3 py-2 rounded bg-gray-900 text-white text-sm">완료, 다음 단계</button>
          </div>
          <p className="text-xs text-gray-500">스토어가 여러 개면 위 항목 입력 후 「추가」를 반복하세요. 끝나면 「다음 단계」.</p>
        </Step>
      )}

      {step === 3 && workspace && (
        <Step title="3. 텔레그램 알림 설정" desc="매일 09:00 KST 보고가 텔레그램으로 발송됩니다.">
          <div className="text-xs text-gray-600 bg-gray-50 rounded p-2 space-y-1">
            <div>1) 텔레그램에서 <code>@BotFather</code> 검색 → <code>/newbot</code> → 봇 토큰 복사</div>
            <div>2) <code>@userinfobot</code> 에서 <code>/start</code> 누르면 본인 chat_id 표시</div>
          </div>
          <Field label="Bot Token" value={tgToken} onChange={setTgToken} placeholder="7891234567:AAH..." />
          <Field label="Chat ID" value={tgChatId} onChange={setTgChatId} placeholder="123456789" />
          <div className="flex gap-2">
            <button onClick={saveTelegram} disabled={busy} className="px-3 py-2 rounded bg-blue-600 text-white text-sm">저장</button>
            <button onClick={testTelegram} disabled={busy} className="px-3 py-2 rounded border text-sm">테스트 발송</button>
            <button onClick={() => setStep(4)} className="px-3 py-2 rounded bg-gray-900 text-white text-sm">다음 단계</button>
            <button onClick={() => setStep(4)} className="px-3 py-2 rounded text-sm text-gray-500">건너뛰기</button>
          </div>
        </Step>
      )}

      {step === 4 && (
        <Step title="4. 1년 백필 시작" desc="등록된 모든 스토어의 과거 결제 주문을 끌어와 DB 에 채웁니다 (백그라운드 자동 진행).">
          <div className="grid grid-cols-2 gap-3">
            <Field label="시작일" value={backfillFrom} onChange={setBackfillFrom} type="date" />
            <Field label="종료일" value={backfillTo} onChange={setBackfillTo} type="date" />
          </div>
          <p className="text-xs text-gray-500">
            네이버 IP 화이트리스트가 풀려있어야 동작합니다. 1스토어 1년치 ≒ 4~6시간 (5분마다 7일씩 자동 진행).
          </p>
          <div className="flex gap-2">
            <button onClick={startBackfill} disabled={busy} className="px-3 py-2 rounded bg-purple-600 text-white text-sm">백필 시작</button>
            <button onClick={() => setStep(5)} className="px-3 py-2 rounded bg-gray-900 text-white text-sm">다음</button>
            <button onClick={() => setStep(5)} className="px-3 py-2 rounded text-sm text-gray-500">건너뛰기</button>
          </div>
        </Step>
      )}

      {step === 5 && (
        <Step title="5. 끝!" desc="이제 매일 아침 09:00 텔레그램에 매출 보고가 옵니다.">
          <div className="space-y-2 text-sm">
            <div>✅ 사업자 등록 완료</div>
            <div>✅ 스토어 등록 완료 (입력하신 만큼)</div>
            <div>✅ 텔레그램 보고 09:00 KST</div>
            <div>✅ 1년치 백필 진행 중 (백그라운드)</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push("/admin/sales/dashboard")} className="px-3 py-2 rounded bg-emerald-600 text-white text-sm">📊 대시보드 보러가기</button>
            <button onClick={() => router.push("/admin/sales/keywords")} className="px-3 py-2 rounded border text-sm">키워드 룰 확인</button>
            <button onClick={() => router.push("/admin/sales/backfill")} className="px-3 py-2 rounded border text-sm">백필 진행률 보기</button>
          </div>
        </Step>
      )}

      {msg && <div className="text-sm text-gray-700">{msg}</div>}
    </div>
  );
}

function Stepper({ step, onJump }: { step: Step; onJump: (s: Step) => void }) {
  const labels = ["사업자", "스토어", "텔레그램", "백필", "완료"];
  return (
    <div className="flex gap-1 items-center">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        const active = n === step;
        const done = n < step;
        return (
          <button
            key={n}
            onClick={() => onJump(n)}
            className={`flex-1 px-3 py-2 rounded-md text-xs ${active ? "bg-gray-900 text-white" : done ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-500"}`}
          >
            {n}. {label}
          </button>
        );
      })}
    </div>
  );
}

function Step({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-white p-5 space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-gray-500">{desc}</p>
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, placeholder, type }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input type={type ?? "text"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 block w-full border rounded px-2 py-1" />
    </label>
  );
}
