"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeCompanyName } from "@/lib/company-name";
import {
  ArrowUpCircle, UserCheck, UserPlus, Mail, Plus, Pencil, Trash2,
  CheckCircle, Loader2, Inbox, Send, ShieldAlert,
} from "lucide-react";

const ALLOWED_ROLES = ["ADMIN", "BIZ", "BUSINESS", "BASIC"];

interface SubmissionRoute {
  id: string;
  ownerId: string;
  clientName: string;
  companyName: string;
  submissionEntity: string;
  submissionEmail: string | null;
  requestType: string;
  memo: string | null;
  active: boolean;
}

interface ParentInfo { id: string; name: string | null; email: string }
interface MeInfo { id: string; role: string; parent: ParentInfo | null }

interface LinkRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";
  targetEmailSnapshot: string;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  requester: { id: string; name: string | null; email: string; role: string };
  target: { id: string; name: string | null; email: string; role: string };
}

const EMPTY_FORM = { clientName: "", companyName: "", submissionEntity: "", submissionEmail: "", requestType: "신규" as "신규" | "이관", memo: "" };

export default function SubmissionRoutesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [me, setMe] = useState<MeInfo | null>(null);
  const [outgoing, setOutgoing] = useState<LinkRequest[]>([]);
  const [incoming, setIncoming] = useState<LinkRequest[]>([]);
  const [routes, setRoutes] = useState<SubmissionRoute[]>([]);
  const [loading, setLoading] = useState(true);

  const [linkEmail, setLinkEmail] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);

  // 자동완성 후보 (user-scoped — 본인이 등록한 history + 표준 상위법인 list)
  const [clientSugg, setClientSugg] = useState<string[]>([]);
  const [companySugg, setCompanySugg] = useState<string[]>([]);
  const [entitySugg, setEntitySugg] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mr, or, ir, rr, cs, cps, es] = await Promise.all([
        fetch("/api/mypage"),
        fetch("/api/parent-link-requests?box=outgoing"),
        fetch("/api/parent-link-requests?box=incoming"),
        fetch("/api/submission-routes"),
        fetch("/api/submission-routes/suggestions?type=client"),
        fetch("/api/submission-routes/suggestions?type=company"),
        fetch("/api/submission-routes/suggestions?type=submissionEntity"),
      ]);
      if (mr.ok) setMe(await mr.json());
      if (or.ok) setOutgoing(await or.json());
      if (ir.ok) setIncoming(await ir.json());
      if (rr.ok) setRoutes(await rr.json());
      if (cs.ok) setClientSugg(await cs.json());
      if (cps.ok) setCompanySugg(await cps.json());
      if (es.ok) setEntitySugg(await es.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  if (status === "loading") {
    return <div className="py-20 text-center text-gray-400">불러오는 중...</div>;
  }
  if (!session) { router.push("/login"); return null; }

  const role = (session.user as { role?: string }).role ?? "";
  if (!ALLOWED_ROLES.includes(role)) {
    return (
      <div className="max-w-md mx-auto mt-20 p-6 bg-red-50 border border-red-200 rounded-lg text-center">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-2" />
        <h2 className="text-lg font-semibold text-red-800">접근 권한이 없어요</h2>
        <p className="text-sm text-red-700 mt-2">통계제출처 기능은 사업자·비즈·일반회원 전용입니다.</p>
      </div>
    );
  }

  async function submitLink(e: React.FormEvent) {
    e.preventDefault();
    setLinkError("");
    if (!linkEmail.trim()) { setLinkError("이메일을 입력해주세요."); return; }
    setLinkSubmitting(true);
    try {
      const res = await fetch("/api/parent-link-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEmail: linkEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setLinkError(data.error || "요청 실패"); return; }
      setLinkEmail("");
      await refresh();
    } finally {
      setLinkSubmitting(false);
    }
  }

  async function cancelLink(id: string) {
    if (!confirm("요청을 취소할까요?")) return;
    await fetch("/api/parent-link-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "cancel" }),
    });
    await refresh();
  }

  async function decideLink(id: string, action: "approve" | "reject") {
    const verb = action === "approve" ? "승인" : "거절";
    let reason: string | null = null;
    if (action === "reject") {
      const r = prompt("거절 사유 (선택)");
      if (r === null) return;
      reason = r.trim() || null;
    } else if (!confirm("이 요청을 승인할까요? 승인하면 요청자가 본인의 하위로 연결됩니다.")) return;

    const res = await fetch("/api/parent-link-requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, reason }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || `${verb} 실패`);
      return;
    }
    await refresh();
  }

  async function submitRoute(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!form.clientName.trim() || !form.companyName.trim() || !form.submissionEntity.trim()) {
      setFormError("거래처명, 제약사명, 상위법인은 필수예요."); return;
    }
    setFormSubmitting(true);
    try {
      // 표기 변형 통일 — "(주)동구바이오" / "동구바이오제약" 같은 변형으로 중복 row 양산 방지.
      const body = {
        ...form,
        clientName: form.clientName.trim(),
        companyName: normalizeCompanyName(form.companyName),
        submissionEntity: normalizeCompanyName(form.submissionEntity),
        submissionEmail: form.submissionEmail.trim(),
        memo: form.memo.trim(),
      };
      const res = editingId
        ? await fetch("/api/submission-routes", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: editingId, ...body }),
          })
        : await fetch("/api/submission-routes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || "저장 실패"); return; }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await refresh();
    } finally {
      setFormSubmitting(false);
    }
  }

  function startEdit(r: SubmissionRoute) {
    if (r.ownerId !== me?.id && role !== "ADMIN") {
      alert("본인이 등록한 제출처만 수정할 수 있어요.");
      return;
    }
    setEditingId(r.id);
    setForm({
      clientName: r.clientName,
      companyName: r.companyName,
      submissionEntity: r.submissionEntity,
      submissionEmail: r.submissionEmail ?? "",
      requestType: r.requestType === "이관" ? "이관" : "신규",
      memo: r.memo ?? "",
    });
  }

  async function deleteRoute(r: SubmissionRoute) {
    if (r.ownerId !== me?.id && role !== "ADMIN") {
      alert("본인이 등록한 제출처만 삭제할 수 있어요.");
      return;
    }
    if (!confirm(`'${r.clientName} → ${r.companyName}' 제출처를 삭제할까요?`)) return;
    const res = await fetch(`/api/submission-routes?id=${r.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "삭제 실패");
      return;
    }
    await refresh();
  }

  const pendingOutgoing = outgoing.filter((r) => r.status === "PENDING");
  const pendingIncoming = incoming.filter((r) => r.status === "PENDING");
  const historyOutgoing = outgoing.filter((r) => r.status !== "PENDING").slice(0, 5);
  const historyIncoming = incoming.filter((r) => r.status !== "PENDING").slice(0, 5);

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">통계제출처 관리</h1>
        <p className="text-sm text-gray-500 mt-1">거래처 + 제약사 + 상위법인 매핑을 등록하고, 등록된 매핑을 이후 수정·삭제합니다.</p>
      </header>

      {/* 섹션 1: 내 상위 */}
      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-2">
        <div className="flex items-center gap-2">
          <ArrowUpCircle className="w-5 h-5 text-blue-600" />
          <h2 className="text-base font-semibold text-gray-800">내 상위 회원</h2>
        </div>
        {me?.parent ? (
          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-md">
            <UserCheck className="w-5 h-5 text-blue-600" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-900">{me.parent.name || me.parent.email}</p>
              <p className="text-xs text-blue-700">{me.parent.email}</p>
            </div>
            <span className="text-xs text-blue-600">변경 문의: 관리자</span>
          </div>
        ) : (
          <p className="text-sm text-gray-500">아직 상위가 설정되지 않았어요. 아래에서 상위 회원의 이메일로 연결 요청을 보낼 수 있어요.</p>
        )}
      </section>

      {/* 섹션 2: 상위 요청 */}
      {!me?.parent && (
        <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-semibold text-gray-800">상위 회원에게 연결 요청</h2>
          </div>
          {pendingOutgoing.length > 0 ? (
            <div className="space-y-2">
              {pendingOutgoing.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
                  <Send className="w-4 h-4 text-amber-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-amber-900 truncate">{r.targetEmailSnapshot} 에게 요청 중</p>
                    <p className="text-xs text-amber-700">{new Date(r.createdAt).toLocaleString("ko-KR")}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => cancelLink(r.id)}>취소</Button>
                </div>
              ))}
            </div>
          ) : (
            <form onSubmit={submitLink} className="flex gap-2">
              <Input
                type="email" placeholder="상위 회원 이메일"
                value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={linkSubmitting}>
                {linkSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Mail className="w-4 h-4 mr-1" />요청 보내기</>}
              </Button>
            </form>
          )}
          {linkError && <p className="text-xs text-red-600">{linkError}</p>}
          {historyOutgoing.length > 0 && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer hover:text-gray-700">이전 요청 이력 ({historyOutgoing.length})</summary>
              <ul className="mt-2 space-y-1 pl-4">
                {historyOutgoing.map((r) => (
                  <li key={r.id}>
                    {r.targetEmailSnapshot} — {r.status === "APPROVED" ? "승인됨" : r.status === "REJECTED" ? `거절됨${r.reason ? ` (${r.reason})` : ""}` : "취소됨"}
                    <span className="text-gray-400 ml-1">({new Date(r.decidedAt || r.createdAt).toLocaleDateString("ko-KR")})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* 섹션 3: Incoming inbox */}
      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-purple-600" />
          <h2 className="text-base font-semibold text-gray-800">받은 연결 요청 ({pendingIncoming.length})</h2>
        </div>
        {pendingIncoming.length === 0 ? (
          <p className="text-sm text-gray-500">현재 처리할 요청이 없어요.</p>
        ) : (
          <div className="space-y-2">
            {pendingIncoming.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-3 bg-purple-50 border border-purple-200 rounded-md">
                <UserPlus className="w-4 h-4 text-purple-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-purple-900 truncate">{r.requester.name || r.requester.email}</p>
                  <p className="text-xs text-purple-700 truncate">{r.requester.email} · {new Date(r.createdAt).toLocaleString("ko-KR")}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => decideLink(r.id, "reject")}>거절</Button>
                <Button size="sm" onClick={() => decideLink(r.id, "approve")}>
                  <CheckCircle className="w-4 h-4 mr-1" />승인
                </Button>
              </div>
            ))}
          </div>
        )}
        {historyIncoming.length > 0 && (
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-700">이전 처리 이력 ({historyIncoming.length})</summary>
            <ul className="mt-2 space-y-1 pl-4">
              {historyIncoming.map((r) => (
                <li key={r.id}>
                  {r.requester.email} — {r.status === "APPROVED" ? "승인됨" : r.status === "REJECTED" ? `거절됨${r.reason ? ` (${r.reason})` : ""}` : "취소됨"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* 섹션 4: 통계제출처 CRUD */}
      <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-orange-600" />
          <h2 className="text-base font-semibold text-gray-800">제출처 매핑</h2>
        </div>

        <form onSubmit={submitRoute} className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-gray-50 rounded-md">
          {/* datalist 자동완성 — user-scoped 후보. 후보 없으면 자유 입력 가능. */}
          <datalist id="sugg-client">
            {clientSugg.map((v) => <option key={v} value={v} />)}
          </datalist>
          <datalist id="sugg-company">
            {companySugg.map((v) => <option key={v} value={v} />)}
          </datalist>
          <datalist id="sugg-entity">
            {entitySugg.map((v) => <option key={v} value={v} />)}
          </datalist>

          <Input
            placeholder="거래처명 * (목록에서 선택 또는 직접 입력)"
            list="sugg-client"
            value={form.clientName}
            onChange={(e) => setForm({ ...form, clientName: e.target.value })}
          />
          <Input
            placeholder="제약사명 * (목록에서 선택 또는 직접 입력)"
            list="sugg-company"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
          <Input
            placeholder="상위법인 * (목록에서 선택 또는 직접 입력)"
            list="sugg-entity"
            value={form.submissionEntity}
            onChange={(e) => setForm({ ...form, submissionEntity: e.target.value })}
          />
          <Input placeholder="제출 이메일 (선택)" type="email" value={form.submissionEmail} onChange={(e) => setForm({ ...form, submissionEmail: e.target.value })} />
          <select
            value={form.requestType}
            onChange={(e) => setForm({ ...form, requestType: e.target.value as "신규" | "이관" })}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="신규">신규</option>
            <option value="이관">이관</option>
          </select>
          <Input placeholder="메모 (선택)" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          <div className="md:col-span-2 flex gap-2 justify-end">
            {editingId && (
              <Button type="button" variant="outline" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setFormError(""); }}>취소</Button>
            )}
            <Button type="submit" disabled={formSubmitting}>
              {formSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : editingId ? <><Pencil className="w-4 h-4 mr-1" />수정</> : <><Plus className="w-4 h-4 mr-1" />연결 등록</>}
            </Button>
          </div>
          {formError && <p className="md:col-span-2 text-xs text-red-600">{formError}</p>}
        </form>

        {loading ? (
          <p className="text-sm text-gray-400">불러오는 중...</p>
        ) : routes.length === 0 ? (
          <p className="text-sm text-gray-500">등록된 제출처가 없어요. 위 폼에서 추가해주세요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">거래처</th>
                  <th className="text-left px-3 py-2">제약사</th>
                  <th className="text-left px-3 py-2">제출처</th>
                  <th className="text-left px-3 py-2">이메일</th>
                  <th className="text-left px-3 py-2">구분</th>
                  <th className="text-right px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => {
                  const mine = r.ownerId === me?.id;
                  const global = !mine && r.ownerId !== me?.id;
                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2">{r.clientName}</td>
                      <td className="px-3 py-2">{r.companyName}</td>
                      <td className="px-3 py-2">{r.submissionEntity}</td>
                      <td className="px-3 py-2 text-gray-500">{r.submissionEmail || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.requestType === "이관" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{r.requestType}</span>
                        {global && <span className="ml-1 text-[10px] text-gray-400">(공용)</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {mine || role === "ADMIN" ? (
                          <div className="inline-flex gap-1">
                            <button onClick={() => startEdit(r)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => deleteRoute(r)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-400">조회만</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
