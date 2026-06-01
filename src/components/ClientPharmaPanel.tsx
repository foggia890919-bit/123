"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Plus, Lock, Check, X } from "lucide-react";

interface Claim {
  id: string;
  companyName: string;
  claimedBy: string;
  claimedAt: string;
  isMine: boolean;
  memo: string | null;
}

interface Props {
  bizNumber: string;       // 사업자번호 (마스터 조회용)
  clientName: string;      // 표시용
}

// 사용자가 등록한 거래처(병의원)의 제약사 거래 점유 관리 인라인 패널.
// 같은 (병의원, 제약사) 조합은 한 회원만 점유 가능 (선등록자 우선).
export default function ClientPharmaPanel({ bizNumber, clientName }: Props) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newCompany, setNewCompany] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const ensureMaster = useCallback(async () => {
    // 마스터 조회 — 없으면 자동 생성 (사용자가 거래처를 등록한 시점에서는 사업자번호·이름은 있음)
    const digits = bizNumber.replace(/\D/g, "");
    if (digits.length < 10) return null;
    const r = await fetch(`/api/clients-master?bizNumber=${digits}`);
    const d = await r.json();
    if (d.found && d.client) return d.client.id as string;
    // 없으면 생성 시도
    const cr = await fetch("/api/clients-master", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bizNumber: digits, clientName }),
    });
    const cd = await cr.json();
    return (cd.client?.id ?? null) as string | null;
  }, [bizNumber, clientName]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const id = await ensureMaster();
      setClientId(id);
      if (!id) { setClaims([]); return; }
      const r = await fetch(`/api/clients-master/${id}/claims`);
      const d = await r.json();
      setClaims(Array.isArray(d) ? d : []);
    } finally {
      setLoading(false);
    }
  }, [ensureMaster]);

  useEffect(() => { load(); }, [load]);

  async function addClaim() {
    if (!clientId || !newCompany.trim()) return;
    setAdding(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/clients-master/${clientId}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: newCompany.trim() }),
      });
      const d = await r.json();
      if (r.status === 409) {
        setMsg({
          ok: false,
          text: `❌ ${d.message ?? "이미 다른 회원이 점유 중입니다."} 점유자: ${d.claimedBy ?? "?"}`,
        });
        return;
      }
      if (!r.ok || d.error) {
        setMsg({ ok: false, text: `실패: ${d.error ?? `HTTP ${r.status}`}` });
        return;
      }
      setMsg({ ok: true, text: `✓ ${newCompany.trim()} 점유 완료` });
      setNewCompany("");
      load();
    } catch (e) {
      setMsg({ ok: false, text: `네트워크 오류: ${String(e)}` });
    } finally {
      setAdding(false);
    }
  }

  async function removeClaim(companyName: string) {
    if (!clientId) return;
    if (!confirm(`'${companyName}' 점유를 해제할까요?`)) return;
    await fetch(`/api/clients-master/${clientId}/claims?companyName=${encodeURIComponent(companyName)}`, {
      method: "DELETE",
    });
    load();
  }

  if (loading) {
    return (
      <div className="px-4 py-3 text-xs text-gray-400 flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" />점유 정보 로딩...
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 space-y-2">
      <p className="text-xs font-semibold text-gray-700">
        거래 제약사 ({claims.length}건)
        <span className="ml-2 font-normal text-gray-400 text-[10px]">
          선등록자 우선 — 같은 제약사는 1명만 점유 가능
        </span>
      </p>

      {claims.length === 0 ? (
        <p className="text-xs text-gray-400 py-1">아직 등록된 거래 제약사가 없습니다</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {claims.map((c) => (
            <span
              key={c.id}
              className={`text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 ${
                c.isMine
                  ? "bg-green-50 border-green-300 text-green-800"
                  : "bg-gray-100 border-gray-300 text-gray-500"
              }`}
              title={`${c.isMine ? "내 점유" : `${c.claimedBy} 점유`} — ${new Date(c.claimedAt).toLocaleDateString("ko-KR")}`}
            >
              {c.isMine ? <Check className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              <span className="font-medium">{c.companyName}</span>
              {!c.isMine && <span className="text-[10px] text-gray-400">{c.claimedBy}</span>}
              {c.isMine && (
                <button
                  type="button"
                  onClick={() => removeClaim(c.companyName)}
                  className="hover:text-red-600"
                  title="점유 해제"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <input
          value={newCompany}
          onChange={(e) => setNewCompany(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addClaim())}
          placeholder="제약사명 (예: 대웅제약)"
          className="flex-1 text-xs px-2 py-1.5 border border-gray-300 rounded"
          disabled={adding || !clientId}
        />
        <button
          type="button"
          onClick={addClaim}
          disabled={adding || !clientId || !newCompany.trim()}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          점유 추가
        </button>
      </div>

      {msg && (
        <div className={`text-[11px] px-2 py-1 rounded ${
          msg.ok ? "text-green-700 bg-green-50 border border-green-200"
                 : "text-red-700 bg-red-50 border border-red-200"
        }`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
