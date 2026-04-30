"use client";

import { useState, useEffect, useCallback } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Mail, RefreshCw, Loader2, CheckCircle, AlertCircle,
  Trash2, Settings2, Download, X, Clock, Inbox,
} from "lucide-react";

interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

interface IncomingEmail {
  id: string;
  messageId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  bodyPreview: string | null;
  receivedAt: string;
  status: string;
  classifiedAs: string | null;
  mappedCorpId: string | null;
  mappedCompanyName: string | null;
  applyMonth: string | null;
  errorMessage: string | null;
  attachments: Attachment[];
  processedBy?: { name: string | null; email: string } | null;
}

interface Corp {
  id: string;
  clientName: string;
}

interface Mapping {
  id: string;
  fromAddress: string;
  matchType: string;
  corpClientId: string;
  defaultClassification: string | null;
  active: boolean;
}

const STATUS_TABS = [
  { key: "PENDING", label: "미분류", icon: Inbox, color: "bg-yellow-50 text-yellow-700" },
  { key: "CLASSIFIED", label: "분류됨", icon: Clock, color: "bg-blue-50 text-blue-700" },
  { key: "PROCESSED", label: "처리완료", icon: CheckCircle, color: "bg-green-50 text-green-700" },
  { key: "FAILED", label: "실패", icon: AlertCircle, color: "bg-red-50 text-red-700" },
  { key: "IGNORED", label: "무시", icon: X, color: "bg-gray-50 text-gray-500" },
  { key: "ALL", label: "전체", icon: Mail, color: "bg-gray-50 text-gray-700" },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function EmailInboxPage() {
  const [activeTab, setActiveTab] = useState<string>("PENDING");
  const [emails, setEmails] = useState<IncomingEmail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IncomingEmail | null>(null);
  const [corps, setCorps] = useState<Corp[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [showMappings, setShowMappings] = useState(false);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/email-ingest/inbox?status=${activeTab}&limit=100`);
      const data = await res.json();
      setEmails(data?.items ?? []);
      setTotal(data?.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    load();
  }, [load]);

  // load dropdowns once
  useEffect(() => {
    fetch("/api/dealer")
      .then((r) => r.json())
      .then((d) => setCorps(Array.isArray(d) ? d.map((x) => ({ id: x.id, clientName: x.clientName })) : []));
    fetch("/api/medications/companies?type=settlement")
      .then((r) => r.json())
      .then((d) => setCompanies(Array.isArray(d) ? d.map((x) => x.name) : []));
  }, []);

  async function loadMappings() {
    const res = await fetch("/api/email-ingest/mappings");
    const data = await res.json();
    setMappings(Array.isArray(data) ? data : data?.items ?? []);
  }

  async function patchEmail(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/email-ingest/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "저장 실패");
        return null;
      }
      const updated = await res.json();
      setSelected(updated);
      load();
      return updated;
    } finally {
      setBusy(false);
    }
  }

  async function processEmail(id: string, action: "process_rate" | "process_settlement") {
    setBusy(true);
    try {
      const res = await fetch(`/api/email-ingest/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processAction: action }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "처리 실패");
        return;
      }
      alert("자동 등록 완료");
      setSelected(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function ignoreEmail(id: string) {
    if (!confirm("이 메일을 무시 처리할까요?")) return;
    await patchEmail(id, { status: "IGNORED" });
    setSelected(null);
  }

  async function addMappingFromSelected() {
    if (!selected || !selected.mappedCorpId) {
      alert("법인을 먼저 선택해주세요.");
      return;
    }
    const res = await fetch("/api/email-ingest/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAddress: selected.fromAddress,
        matchType: "EXACT",
        corpClientId: selected.mappedCorpId,
        defaultClassification: selected.classifiedAs,
      }),
    });
    if (res.ok) alert("매핑 등록 완료. 다음부터 이 발신자 메일은 자동 분류됩니다.");
    else alert("매핑 등록 실패");
  }

  return (
    <BizLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">메일 자동 수신함</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              지메일 자동 수신 → 분류 → 요율표/정산서 등록
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowMappings(true); loadMappings(); }}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              <Settings2 className="w-4 h-4" /> 발신자 매핑
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              새로고침
            </button>
          </div>
        </div>

        {/* 상태 탭 */}
        <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
          {STATUS_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => { setActiveTab(t.key); setSelected(null); }}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  activeTab === t.key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                <Icon className="w-4 h-4" /> {t.label}
              </button>
            );
          })}
          <span className="ml-auto text-xs text-gray-400 px-3">{total}건</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 메일 리스트 */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : emails.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">메일이 없어요.</div>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
                {emails.map((e) => (
                  <li
                    key={e.id}
                    onClick={() => setSelected(e)}
                    className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selected?.id === e.id ? "bg-blue-50" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{e.subject}</p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {e.fromName || e.fromAddress} · {new Date(e.receivedAt).toLocaleString("ko-KR")}
                        </p>
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                          📎 {e.attachments.length}개 · {e.bodyPreview?.substring(0, 60)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          STATUS_TABS.find((t) => t.key === e.status)?.color ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {STATUS_TABS.find((t) => t.key === e.status)?.label ?? e.status}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 메일 상세 + 분류 */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            {!selected ? (
              <div className="flex items-center justify-center text-sm text-gray-400 h-64">
                메일을 선택하세요.
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-base font-bold text-gray-900">{selected.subject}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {selected.fromName ? `${selected.fromName} <${selected.fromAddress}>` : selected.fromAddress}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(selected.receivedAt).toLocaleString("ko-KR")}
                  </p>
                </div>

                {selected.bodyPreview && (
                  <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {selected.bodyPreview}
                  </div>
                )}

                {/* 첨부 */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500">첨부파일</p>
                  {selected.attachments.map((a) => (
                    <a
                      key={a.id}
                      href={`/api/email-ingest/attachment/${a.id}`}
                      className="flex items-center gap-2 text-sm text-blue-600 hover:bg-blue-50 px-2 py-1 rounded"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {a.fileName} <span className="text-xs text-gray-400">({formatBytes(a.size)})</span>
                    </a>
                  ))}
                </div>

                {selected.errorMessage && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                    {selected.errorMessage}
                  </div>
                )}

                {/* 분류 폼 */}
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">법인</label>
                      <select
                        value={selected.mappedCorpId ?? ""}
                        onChange={(e) => patchEmail(selected.id, { mappedCorpId: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
                      >
                        <option value="">선택</option>
                        {corps.map((c) => (
                          <option key={c.id} value={c.id}>{c.clientName}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">제약사 (요율 시)</label>
                      <select
                        value={selected.mappedCompanyName ?? ""}
                        onChange={(e) => patchEmail(selected.id, { mappedCompanyName: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
                      >
                        <option value="">선택</option>
                        {companies.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">적용월</label>
                      <input
                        type="month"
                        value={selected.applyMonth ?? currentYearMonth()}
                        onChange={(e) => patchEmail(selected.id, { applyMonth: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">종류</label>
                      <select
                        value={selected.classifiedAs ?? ""}
                        onChange={(e) => patchEmail(selected.id, { classifiedAs: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
                      >
                        <option value="">선택</option>
                        <option value="RATE">요율표</option>
                        <option value="SETTLEMENT">정산내역서</option>
                        <option value="OTHER">기타</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    {selected.classifiedAs === "RATE" && (
                      <button
                        onClick={() => processEmail(selected.id, "process_rate")}
                        disabled={busy || !selected.mappedCorpId || !selected.mappedCompanyName || !selected.applyMonth}
                        className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-40"
                      >
                        요율표로 등록
                      </button>
                    )}
                    {selected.classifiedAs === "SETTLEMENT" && (
                      <button
                        onClick={() => processEmail(selected.id, "process_settlement")}
                        disabled={busy || !selected.mappedCorpId || !selected.applyMonth}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40"
                      >
                        정산서로 등록
                      </button>
                    )}
                    <button
                      onClick={addMappingFromSelected}
                      disabled={!selected.mappedCorpId}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 rounded-lg disabled:opacity-40"
                    >
                      이 발신자 매핑 등록
                    </button>
                    <button
                      onClick={() => ignoreEmail(selected.id)}
                      className="ml-auto px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-3 h-3 inline mr-1" /> 무시
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 매핑 관리 모달 */}
      {showMappings && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">발신자 → 법인 매핑</h2>
              <button onClick={() => setShowMappings(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 text-sm">
              {mappings.length === 0 ? (
                <p className="text-center text-gray-400 py-8">매핑이 없어요. 메일 분류 화면에서 "이 발신자 매핑 등록"으로 추가.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2">발신자</th>
                      <th className="text-left px-3 py-2">법인</th>
                      <th className="text-left px-3 py-2">기본분류</th>
                      <th className="text-left px-3 py-2">활성</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {mappings.map((m) => (
                      <tr key={m.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono">{m.fromAddress}</td>
                        <td className="px-3 py-2">{corps.find((c) => c.id === m.corpClientId)?.clientName ?? m.corpClientId}</td>
                        <td className="px-3 py-2">{m.defaultClassification ?? "—"}</td>
                        <td className="px-3 py-2">{m.active ? "✓" : "✗"}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={async () => {
                              if (!confirm("매핑을 삭제할까요?")) return;
                              await fetch(`/api/email-ingest/mappings?id=${m.id}`, { method: "DELETE" });
                              loadMappings();
                            }}
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </BizLayout>
  );
}
