"use client";

import { useState, useEffect } from "react";
import { CheckCircle, AlertCircle, Download, ChevronDown, ChevronUp, Plus, RefreshCw, Search, X, Mail, Inbox, Copy, MessageCircle } from "lucide-react";
import * as XLSX from "xlsx";
import { CompanySubmission, SubmissionEntity, FilterReq, EditSub, statusOptions } from "./types";

declare global {
  interface Window {
    Kakao: {
      isInitialized(): boolean;
      init(key: string): void;
      Share: {
        sendDefault(params: {
          objectType: string;
          text?: string;
          link: { webUrl: string; mobileWebUrl: string };
          buttonTitle?: string;
        }): void;
      };
    };
  }
}

export default function BulkSubmissionTab() {
  const [reqs, setReqs] = useState<FilterReq[]>([]);
  const [subs, setSubs] = useState<CompanySubmission[]>([]);
  const [entities, setEntities] = useState<SubmissionEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusScope, setStatusScope] = useState<"PENDING" | "ALL" | "OPEN">("PENDING");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editSub, setEditSub] = useState<EditSub | null>(null);
  const [savingSub, setSavingSub] = useState(false);
  const [editSubEntityMode, setEditSubEntityMode] = useState<"select" | "new">("select");
  const [newEntityForm, setNewEntityForm] = useState<SubmissionEntity | null>(null);
  const [savingEntity, setSavingEntity] = useState(false);
  const [bulkingName, setBulkingName] = useState<string | null>(null);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [kakaoReady, setKakaoReady] = useState(false);
  const [kakaoModal, setKakaoModal] = useState<{ companyName: string; rows: FilterReq[]; sub: CompanySubmission; editMsg: string; editContact: string; editPhone: string } | null>(null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const KAKAO_APP_KEY = process.env.NEXT_PUBLIC_KAKAO_APP_KEY;
    if (!KAKAO_APP_KEY) return;
    const initKakao = () => {
      if (window.Kakao && !window.Kakao.isInitialized()) window.Kakao.init(KAKAO_APP_KEY);
      setKakaoReady(true);
    };
    if (typeof window !== "undefined" && window.Kakao) { initKakao(); return; }
    const script = document.createElement("script");
    script.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js";
    script.async = true;
    script.onload = initKakao;
    document.head.appendChild(script);
  }, []);

  async function load() {
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      fetch("/api/filter-request?all=true").then((r) => r.json()),
      fetch("/api/admin/company-submissions").then((r) => r.json()),
      fetch("/api/admin/submission-entities").then((r) => r.json()),
    ]);
    setReqs(Array.isArray(r1) ? r1 : []);
    setSubs(Array.isArray(r2) ? r2 : []);
    setEntities(Array.isArray(r3) ? r3 : []);
    setLoading(false);
  }

  const subsByCompany = new Map<string, CompanySubmission>(subs.map((s) => [s.companyName, s]));

  const filtered = reqs.filter((r) => {
    if (statusScope === "PENDING" && r.status !== "PENDING") return false;
    if (statusScope === "OPEN" && r.status !== "PENDING" && r.status !== "REVIEWING") return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        r.companyName.toLowerCase().includes(q) ||
        r.clientName.toLowerCase().includes(q) ||
        r.bizNumber.includes(query)
      );
    }
    return true;
  });

  const groups = new Map<string, FilterReq[]>();
  for (const r of filtered) {
    const arr = groups.get(r.companyName) || [];
    arr.push(r);
    groups.set(r.companyName, arr);
  }
  const groupEntries = Array.from(groups.entries()).sort((a, b) => {
    const aHas = subsByCompany.has(a[0]) ? 1 : 0;
    const bHas = subsByCompany.has(b[0]) ? 1 : 0;
    if (aHas !== bHas) return aHas - bHas; // 제출처 없는 곳을 위로
    return a[0].localeCompare(b[0]);
  });

  const withSubCount = groupEntries.filter(([name]) => subsByCompany.has(name)).length;

  function toggle(name: string) {
    setCollapsed((p) => ({ ...p, [name]: !p[name] }));
  }

  function composeMail(companyName: string, rows: FilterReq[], sub: CompanySubmission | undefined) {
    if (!sub?.email) {
      alert("이 제약사의 이메일 제출처가 등록되지 않았어요. 먼저 제출처를 등록해 주세요.");
      return;
    }
    const subject = `[필터링 요청] ${companyName} - 거래가능 여부 확인 (${rows.length}건)`;
    const body = `안녕하세요, ${sub.contactName || "담당자"}님.\n\n아래 ${rows.length}개 거래처에 대해 거래 가능 여부 확인 부탁드립니다.\n\n` +
      rows.map((r, i) => `${i + 1}. ${r.clientName} (사업자번호 ${r.bizNumber})`).join("\n") +
      `\n\n회신은 본 메일로 부탁드리며, 각 거래처별 가능/불가 여부 표시해 주시면 감사하겠습니다.\n\n감사합니다.`;
    window.location.href = `mailto:${sub.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  async function copyList(companyName: string, rows: FilterReq[]) {
    const text = rows.map((r, i) => `${i + 1}. ${r.clientName} / ${r.bizNumber}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedName(companyName);
      setTimeout(() => setCopiedName((n) => n === companyName ? null : n), 1500);
    } catch {
      alert("복사에 실패했어요.");
    }
  }

  function exportCompanyExcel(companyName: string, rows: FilterReq[]) {
    const sub = subsByCompany.get(companyName);
    const data = rows.map((r) => ({
      거래처명: r.clientName,
      사업자번호: r.bizNumber,
      영업사원명: r.user.name || r.userName,
      아이디: r.user.email,
      "제출처 법인명": sub?.submissionEntity || "",
      요청일: new Date(r.createdAt).toLocaleDateString("ko-KR"),
      상태: statusOptions.find((s) => s.value === r.status)?.label || r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 10 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, companyName.slice(0, 30) || "Sheet1");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `필터링요청_${companyName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function markAllReviewing(companyName: string, rows: FilterReq[]) {
    const pendingIds = rows.filter((r) => r.status === "PENDING").map((r) => r.id);
    if (pendingIds.length === 0) return;
    if (!confirm(`${companyName}의 대기 ${pendingIds.length}건을 "확인중"으로 변경할까요?`)) return;
    setBulkingName(companyName);
    await Promise.all(pendingIds.map((id) => fetch("/api/filter-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "REVIEWING" }),
    })));
    setReqs((prev) => prev.map((r) => pendingIds.includes(r.id) ? { ...r, status: "REVIEWING" } : r));
    setBulkingName(null);
  }

  async function saveNewEntity() {
    if (!newEntityForm) return;
    const name = newEntityForm.name.trim();
    if (!name) { alert("법인명은 필수에요."); return; }
    setSavingEntity(true);
    const res = await fetch("/api/admin/submission-entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newEntityForm),
    });
    if (res.ok) {
      const saved: SubmissionEntity = await res.json();
      setEntities((prev) => [...prev.filter((e) => e.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setEditSub((p) => p ? { ...p, submissionEntity: saved.name, contactName: saved.contactName || p.contactName, email: saved.email || p.email, phone: saved.phone || p.phone, fax: saved.fax || p.fax } : p);
      setEditSubEntityMode("select");
      setNewEntityForm(null);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(`저장 실패: ${data.error || "알 수 없는 오류"}`);
    }
    setSavingEntity(false);
  }

  async function saveSubmission() {
    if (!editSub) return;
    const name = editSub.companyName.trim();
    if (!name) return;
    setSavingSub(true);
    const res = await fetch("/api/admin/company-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editSub),
    });
    if (res.ok) {
      const saved: CompanySubmission = await res.json();
      setSubs((prev) => {
        const idx = prev.findIndex((s) => s.companyName === saved.companyName);
        return idx >= 0 ? prev.map((s, i) => i === idx ? saved : s) : [...prev, saved];
      });
      setEditSub(null);
    }
    setSavingSub(false);
  }

  function sendKakao() {
    if (!kakaoModal) return;
    if (!window.Kakao?.Share) { alert("카카오 SDK가 아직 로드되지 않았어요. 잠시 후 다시 시도해 주세요."); return; }
    const text = kakaoModal.editMsg.slice(0, 200);
    window.Kakao.Share.sendDefault({
      objectType: "text",
      text,
      link: { webUrl: window.location.href, mobileWebUrl: window.location.href },
      buttonTitle: "확인하기",
    });
    setKakaoModal(null);
  }

  function buildKakaoPreview(companyName: string, rows: FilterReq[]) {
    const listText = rows.slice(0, 6).map((r, i) => `${i + 1}. ${r.clientName} (${r.bizNumber})`).join("\n");
    const suffix = rows.length > 6 ? `\n...외 ${rows.length - 6}건` : "";
    return `[필터링 요청] ${companyName}\n${rows.length}개 거래처 거래가능 여부 확인 요청드립니다.\n\n${listText}${suffix}`.slice(0, 200);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">제약사별 일괄제출</h2>
            <p className="text-xs text-gray-400 mt-0.5">여러 거래처의 필터링 요청을 제약사 단위로 묶어 제출처(필터링요청처)에 한 번에 보냅니다.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusScope}
              onChange={(e) => setStatusScope(e.target.value as "PENDING" | "ALL" | "OPEN")}
              className="h-9 border border-gray-200 rounded px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="PENDING">대기 상태만</option>
              <option value="OPEN">대기 + 확인중</option>
              <option value="ALL">전체 상태</option>
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="제약사 / 거래처 / 사업자번호"
                className="h-9 w-60 border border-gray-200 rounded pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button onClick={load} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1.5 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />새로고침
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 border border-blue-100 rounded-md px-3 py-2.5">
            <div className="text-[11px] text-blue-700 font-medium">대상 제약사</div>
            <div className="text-xl font-bold text-blue-900 mt-0.5">{groupEntries.length}곳</div>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-md px-3 py-2.5">
            <div className="text-[11px] text-amber-700 font-medium">총 요청 건수</div>
            <div className="text-xl font-bold text-amber-900 mt-0.5">{filtered.length}건</div>
          </div>
          <div className={`${withSubCount === groupEntries.length ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"} border rounded-md px-3 py-2.5`}>
            <div className={`text-[11px] font-medium ${withSubCount === groupEntries.length ? "text-emerald-700" : "text-red-700"}`}>제출처 등록됨</div>
            <div className={`text-xl font-bold mt-0.5 ${withSubCount === groupEntries.length ? "text-emerald-900" : "text-red-900"}`}>{withSubCount}/{groupEntries.length}곳</div>
          </div>
        </div>
      </div>

      {loading && <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>}

      {!loading && groupEntries.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg py-16 text-center text-gray-400 text-sm">
          {query || statusScope !== "PENDING" ? "조건에 맞는 요청이 없어요." : "대기 중인 필터링 요청이 없어요."}
        </div>
      )}

      {!loading && groupEntries.map(([companyName, rows]) => {
        const sub = subsByCompany.get(companyName);
        const isCollapsed = collapsed[companyName] ?? false;
        const pendingCount = rows.filter((r) => r.status === "PENDING").length;
        return (
          <div key={companyName} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <button onClick={() => toggle(companyName)} className="text-gray-400 hover:text-gray-700 shrink-0">
                  {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
                <h3 className="text-base font-semibold text-gray-900 truncate">{companyName}</h3>
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">{rows.length}건</span>
                {sub ? (
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1 shrink-0">
                    <CheckCircle className="w-3 h-3" />제출처 등록됨
                  </span>
                ) : (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1 shrink-0">
                    <AlertCircle className="w-3 h-3" />제출처 없음
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {sub?.email && (
                  <button onClick={() => composeMail(companyName, rows, sub)} className="text-xs bg-blue-600 text-white hover:bg-blue-700 rounded px-2.5 py-1.5 flex items-center gap-1">
                    <Mail className="w-3 h-3" />이메일 작성
                  </button>
                )}
                {kakaoReady && sub && (
                  <button
                    onClick={() => setKakaoModal({ companyName, rows, sub, editMsg: buildKakaoPreview(companyName, rows), editContact: sub.contactName || "", editPhone: sub.phone || "" })}
                    className="text-xs rounded px-2.5 py-1.5 flex items-center gap-1 font-medium"
                    style={{ background: "#FEE500", color: "#3C1E1E" }}
                  >
                    <MessageCircle className="w-3 h-3" />카카오톡
                  </button>
                )}
                <button onClick={() => copyList(companyName, rows)} className="text-xs bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 rounded px-2.5 py-1.5 flex items-center gap-1">
                  <Copy className="w-3 h-3" />{copiedName === companyName ? "복사됨!" : "목록 복사"}
                </button>
                <button onClick={() => exportCompanyExcel(companyName, rows)} className="text-xs bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50 rounded px-2.5 py-1.5 flex items-center gap-1">
                  <Download className="w-3 h-3" />엑셀
                </button>
                {pendingCount > 0 && (
                  <button
                    onClick={() => markAllReviewing(companyName, rows)}
                    disabled={bulkingName === companyName}
                    className="text-xs bg-white text-blue-700 border border-blue-200 hover:bg-blue-50 rounded px-2.5 py-1.5 flex items-center gap-1 disabled:opacity-50"
                  >{bulkingName === companyName ? "처리중..." : `${pendingCount}건 확인중 표시`}</button>
                )}
                <button
                  onClick={() => { setEditSub(sub ? { ...sub } : { companyName, submissionEntity: "", contactName: "", email: "", phone: "", fax: "", defaultAdditionalRate: null, notes: "", isNew: true }); setEditSubEntityMode(sub?.submissionEntity ? "select" : "select"); }}
                  className="text-xs bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 rounded px-2.5 py-1.5 flex items-center gap-1"
                ><Inbox className="w-3 h-3" />{sub ? "제출처 수정" : "제출처 등록"}</button>
              </div>
            </div>

            {sub ? (
              <div className="px-5 py-2.5 bg-gray-50/60 border-b border-gray-100 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                {sub.contactName && <span className="text-gray-700"><span className="text-gray-400">담당자:</span> <span className="font-medium">{sub.contactName}</span></span>}
                {sub.email && <span className="text-gray-700"><span className="text-gray-400">이메일:</span> <a className="text-blue-600 hover:underline" href={`mailto:${sub.email}`}>{sub.email}</a></span>}
                {sub.phone && <span className="text-gray-700"><span className="text-gray-400">전화:</span> {sub.phone}</span>}
                {sub.fax && <span className="text-gray-700"><span className="text-gray-400">팩스:</span> {sub.fax}</span>}
                {sub.notes && <span className="text-gray-500 italic">{sub.notes}</span>}
              </div>
            ) : (
              <div className="px-5 py-2.5 bg-red-50/50 border-b border-red-100 text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5" /> 제출처 정보가 없어요. "제출처 등록"을 눌러 담당자 이메일·연락처를 먼저 등록해 주세요.
              </div>
            )}

            {!isCollapsed && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white text-xs text-gray-500 font-semibold">
                      <th className="px-5 py-2.5 text-left w-10">#</th>
                      <th className="px-4 py-2.5 text-left">거래처명</th>
                      <th className="px-4 py-2.5 text-left">사업자번호</th>
                      <th className="px-4 py-2.5 text-left">영업사원</th>
                      <th className="px-4 py-2.5 text-center">요청일</th>
                      <th className="px-4 py-2.5 text-center">상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((r, i) => {
                      const sOpt = statusOptions.find((s) => s.value === r.status) || statusOptions[0];
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-5 py-2 text-gray-400 text-xs">{i + 1}</td>
                          <td className="px-4 py-2 text-gray-800">{r.clientName}</td>
                          <td className="px-4 py-2 text-gray-500 text-xs font-mono">{r.bizNumber}</td>
                          <td className="px-4 py-2 text-gray-600 text-xs">{r.user.name || r.userName} <span className="text-gray-400">({r.user.email})</span></td>
                          <td className="px-4 py-2 text-center text-gray-400 text-xs">{new Date(r.createdAt).toLocaleDateString("ko-KR")}</td>
                          <td className="px-4 py-2 text-center">
                            <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${sOpt.cls}`}>{sOpt.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {kakaoModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full" style={{ background: "#FEE500" }}>
                  <MessageCircle className="w-3.5 h-3.5" style={{ color: "#3C1E1E" }} />
                </span>
                카카오톡으로 보내기 — {kakaoModal.companyName}
              </h3>
              <button onClick={() => setKakaoModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">담당자명</label>
                  <input
                    value={kakaoModal.editContact}
                    onChange={(e) => setKakaoModal((p) => p ? { ...p, editContact: e.target.value } : p)}
                    className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300"
                    placeholder="담당자명"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">전화번호</label>
                  <input
                    value={kakaoModal.editPhone}
                    onChange={(e) => setKakaoModal((p) => p ? { ...p, editPhone: e.target.value } : p)}
                    className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300"
                    placeholder="전화번호"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-500">메시지 내용</label>
                  <span className={`text-[10px] ${kakaoModal.editMsg.length > 200 ? "text-red-500 font-semibold" : "text-gray-400"}`}>{kakaoModal.editMsg.length}/200자</span>
                </div>
                <textarea
                  value={kakaoModal.editMsg}
                  onChange={(e) => setKakaoModal((p) => p ? { ...p, editMsg: e.target.value } : p)}
                  rows={7}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-yellow-300 resize-none leading-relaxed"
                />
                {kakaoModal.editMsg.length > 200 && (
                  <p className="text-[11px] text-red-500 mt-1">200자를 초과했어요. 전송 시 200자까지만 발송됩니다.</p>
                )}
              </div>
              <p className="text-[11px] text-gray-400">카카오톡 공유 화면이 열리면 보낼 대화방 또는 친구를 선택해 주세요.</p>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setKakaoModal(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50">취소</button>
              <button
                onClick={sendKakao}
                className="px-4 py-2 text-sm font-semibold rounded flex items-center gap-2 hover:opacity-90"
                style={{ background: "#FEE500", color: "#3C1E1E" }}
              >
                <MessageCircle className="w-4 h-4" />카카오톡으로 전송
              </button>
            </div>
          </div>
        </div>
      )}

      {editSub && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{editSub.isNew ? `${editSub.companyName} 제출처 등록` : `${editSub.companyName} 제출처 수정`}</h3>
              <button onClick={() => setEditSub(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* 제출처법인명 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-700">제출처법인명</label>
                    <button
                    type="button"
                    onClick={() => setNewEntityForm({ name: "", contactName: null, email: null, phone: null, fax: null, notes: null })}
                    className="text-[11px] text-blue-600 hover:underline flex items-center gap-1"
                  ><Plus className="w-3 h-3" />신규 제출처 등록</button>
                </div>
                <select
                  value={editSub.submissionEntity || ""}
                  onChange={(e) => {
                    const entity = entities.find((en) => en.name === e.target.value);
                    setEditSub((p) => p ? {
                      ...p,
                      submissionEntity: e.target.value,
                      contactName: entity?.contactName ?? p.contactName,
                      email: entity?.email ?? p.email,
                      phone: entity?.phone ?? p.phone,
                      fax: entity?.fax ?? p.fax,
                    } : p);
                  }}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                >
                  <option value="">— 선택 안 함 —</option>
                  {entities.map((en) => (
                    <option key={en.name} value={en.name}>{en.name}</option>
                  ))}
                </select>
                {editSub.submissionEntity && entities.find((e) => e.name === editSub.submissionEntity) && (
                  <div className="mt-1.5 text-[11px] text-gray-500 bg-gray-50 rounded px-2 py-1.5 flex flex-wrap gap-x-3">
                    {entities.find((e) => e.name === editSub.submissionEntity)?.contactName && <span>담당자: {entities.find((e) => e.name === editSub.submissionEntity)?.contactName}</span>}
                    {entities.find((e) => e.name === editSub.submissionEntity)?.phone && <span>전화: {entities.find((e) => e.name === editSub.submissionEntity)?.phone}</span>}
                    {entities.find((e) => e.name === editSub.submissionEntity)?.email && <span>이메일: {entities.find((e) => e.name === editSub.submissionEntity)?.email}</span>}
                  </div>
                )}
                {entities.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1">등록된 제출처가 없어요. 아래 버튼으로 먼저 등록해 주세요.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">담당자명</label>
                <input
                  value={editSub.contactName || ""}
                  onChange={(e) => setEditSub((p) => p ? { ...p, contactName: e.target.value } : p)}
                  placeholder="예) 홍길동"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">이메일 <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  value={editSub.email || ""}
                  onChange={(e) => setEditSub((p) => p ? { ...p, email: e.target.value } : p)}
                  placeholder="예) contact@company.com"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <p className="text-[11px] text-gray-400 mt-1">이메일이 있어야 "이메일 작성" 버튼으로 일괄 발송할 수 있어요.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">전화번호</label>
                  <input
                    value={editSub.phone || ""}
                    onChange={(e) => setEditSub((p) => p ? { ...p, phone: e.target.value } : p)}
                    placeholder="예) 02-1234-5678"
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">팩스</label>
                  <input
                    value={editSub.fax || ""}
                    onChange={(e) => setEditSub((p) => p ? { ...p, fax: e.target.value } : p)}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
                <textarea
                  value={editSub.notes || ""}
                  onChange={(e) => setEditSub((p) => p ? { ...p, notes: e.target.value } : p)}
                  rows={2}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setEditSub(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50">취소</button>
              <button
                onClick={saveSubmission}
                disabled={savingSub}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
              >{savingSub ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {newEntityForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">신규 제출처(법인) 등록</h3>
              <button onClick={() => setNewEntityForm(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">법인명 <span className="text-red-500">*</span></label>
                <input
                  autoFocus
                  value={newEntityForm.name}
                  onChange={(e) => setNewEntityForm((p) => p ? { ...p, name: e.target.value } : p)}
                  placeholder="예) 동아쏘시오홀딩스"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">담당자명</label>
                <input
                  value={newEntityForm.contactName || ""}
                  onChange={(e) => setNewEntityForm((p) => p ? { ...p, contactName: e.target.value } : p)}
                  placeholder="예) 홍길동"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">이메일</label>
                <input
                  type="email"
                  value={newEntityForm.email || ""}
                  onChange={(e) => setNewEntityForm((p) => p ? { ...p, email: e.target.value } : p)}
                  placeholder="예) contact@company.com"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">전화번호</label>
                  <input
                    value={newEntityForm.phone || ""}
                    onChange={(e) => setNewEntityForm((p) => p ? { ...p, phone: e.target.value } : p)}
                    placeholder="예) 02-1234-5678"
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">팩스</label>
                  <input
                    value={newEntityForm.fax || ""}
                    onChange={(e) => setNewEntityForm((p) => p ? { ...p, fax: e.target.value } : p)}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">비고</label>
                <input
                  value={newEntityForm.notes || ""}
                  onChange={(e) => setNewEntityForm((p) => p ? { ...p, notes: e.target.value } : p)}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setNewEntityForm(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded hover:bg-gray-50">취소</button>
              <button
                onClick={saveNewEntity}
                disabled={savingEntity || !newEntityForm.name.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
              >{savingEntity ? "저장 중..." : "등록 후 선택"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
