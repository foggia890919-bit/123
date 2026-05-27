"use client";

import { useState, useEffect, useMemo, Fragment } from "react";
import { AlertCircle, ChevronDown, X, Loader2, Trash2, Pencil, Check } from "lucide-react";
import { AdminUserClient, BizSubTab, EditValues } from "./types";

export default function BizManagementTab() {
  const [rows, setRows] = useState<AdminUserClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [subTab, setSubTab] = useState<BizSubTab>("all");
  // 삭제 진행 상태 — 동일 행 더블 클릭 방지. 삭제 직전 GET 으로 연결 카운트 받아와서 confirm.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 인라인 수정 — id 별 편집 모드. editValues 에 현재 입력값 보관, 저장 시 PATCH.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editError, setEditError] = useState("");

  function startEdit(row: AdminUserClient) {
    setEditingId(row.id);
    setEditValues({
      clientName: row.clientName,
      bizNumber: row.bizNumber,
      dealerType: row.dealerType ?? null,
      approved: row.approved,
    });
    setEditError("");
  }
  function cancelEdit() {
    setEditingId(null);
    setEditValues(null);
    setEditError("");
  }
  async function saveEdit(row: AdminUserClient) {
    if (!editValues) return;
    const digits = editValues.bizNumber.replace(/\D/g, "");
    if (!editValues.clientName.trim()) { setEditError("거래처명을 입력해주세요."); return; }
    if (digits.length !== 10) { setEditError("사업자번호 10자리를 입력해주세요."); return; }
    setSavingId(row.id);
    setEditError("");
    try {
      const res = await fetch(`/api/user-clients?id=${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: editValues.clientName.trim(),
          bizNumber: digits,
          dealerType: editValues.dealerType,
          approved: editValues.approved,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setEditError(err.error || `저장 실패 (${res.status})`);
        return;
      }
      // 로컬 state 즉시 반영 + 서버에서 새로 fetch (uniqueness 등 검증 위해).
      setRows((prev) => prev.map((x) => x.id === row.id
        ? { ...x, clientName: editValues.clientName.trim(), bizNumber: digits, dealerType: editValues.dealerType, approved: editValues.approved }
        : x));
      cancelEdit();
      reload();
    } finally {
      setSavingId(null);
    }
  }

  function reload() {
    setLoading(true);
    fetch("/api/user-clients?all=true")
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }
  useEffect(() => { reload(); }, []);

  async function handleDelete(row: AdminUserClient) {
    if (deletingId) return;
    setDeletingId(row.id);
    try {
      // 연결된 보고서/제안서 카운트 미리 받아서 사용자에게 알리기.
      let reportCount = 0, proposalCount = 0;
      try {
        const r = await fetch(`/api/user-clients/${row.id}`);
        if (r.ok) {
          const d = await r.json();
          reportCount = d.reportCount ?? 0;
          proposalCount = d.proposalCount ?? 0;
        }
      } catch { /* 카운트 못 받아도 진행 가능 */ }

      const lines = [
        `정말 삭제할까요?`,
        ``,
        `거래처명: ${row.clientName}`,
        `사업자번호: ${row.bizNumber}`,
        `담당자: ${row.user.name || row.user.email}`,
      ];
      if (reportCount > 0 || proposalCount > 0) {
        lines.push(``, `⚠️ 이 거래처에 연결된 항목:`);
        if (reportCount > 0) lines.push(`  - 처방통계 보고서 ${reportCount}건`);
        if (proposalCount > 0) lines.push(`  - 제안서 ${proposalCount}건`);
        lines.push(`삭제해도 보고서/제안서 자체는 남지만 거래처 연결이 끊깁니다.`);
      }
      if (!confirm(lines.join("\n"))) return;

      const del = await fetch(`/api/user-clients/${row.id}`, { method: "DELETE" });
      if (!del.ok) {
        const err = await del.json().catch(() => ({}));
        alert(`삭제 실패: ${err.error || del.status}`);
        return;
      }
      // 로컬 state 에서도 즉시 제거 (네트워크 reload 동시에).
      setRows((prev) => prev.filter((x) => x.id !== row.id));
      reload();
    } finally {
      setDeletingId(null);
    }
  }

  const SUB_TABS: { key: BizSubTab; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "hospital", label: "병의원(원외)" },
    { key: "upper-corp", label: "상위법인" },
    { key: "lower-corp", label: "하위법인" },
  ];

  const typeFiltered = rows.filter((r) => {
    if (subTab === "hospital") return !r.dealerType;
    if (subTab === "upper-corp") return r.dealerType === "UPPER_CORP";
    if (subTab === "lower-corp") return r.dealerType === "LOWER_CORP";
    return true;
  });

  const filtered = typeFiltered.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      (r.user.name || "").toLowerCase().includes(q) ||
      r.user.email.toLowerCase().includes(q) ||
      r.clientName.toLowerCase().includes(q) ||
      r.bizNumber.includes(query)
    );
  });

  const dealerLabel = (type?: string | null) => {
    if (!type) return "병의원(원외)";
    if (type === "UPPER_CORP") return "상위법인";
    if (type === "LOWER_CORP") return "하위법인";
    if (type === "CORPORATION") return "법인";
    if (type === "INDIVIDUAL") return "개인사업자";
    return type;
  };
  const dealerColor = (type?: string | null) => {
    if (!type) return "bg-green-100 text-green-700";
    if (type === "UPPER_CORP") return "bg-indigo-100 text-indigo-700";
    if (type === "LOWER_CORP") return "bg-cyan-100 text-cyan-700";
    return "bg-gray-100 text-gray-600";
  };

  const counts = {
    all: rows.length,
    hospital: rows.filter((r) => !r.dealerType).length,
    "upper-corp": rows.filter((r) => r.dealerType === "UPPER_CORP").length,
    "lower-corp": rows.filter((r) => r.dealerType === "LOWER_CORP").length,
  };

  // 본인 대표 사업자 진단 — 마이페이지 사업자 정보 카드는 dealerType=null 중 가장 오래된 1행만 가져옴.
  // 한 회원이 dealerType=null 행을 여러 개 가지면 마이페이지에선 안 보이는 사업자가 생기고
  // 저장 시 "이미 같은 사업자번호로 등록된 거래처" 오류로 막힘. 이를 자동 감지.
  const mypageDiag = useMemo(() => {
    const byUser = new Map<string, AdminUserClient[]>();
    for (const r of rows) {
      if (r.dealerType != null) continue;
      const list = byUser.get(r.userId) ?? [];
      list.push(r);
      byUser.set(r.userId, list);
    }
    const mypagePrimaryIds = new Set<string>();
    const duplicateUserIds = new Set<string>();
    for (const [uid, list] of byUser.entries()) {
      list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      mypagePrimaryIds.add(list[0].id);
      if (list.length >= 2) duplicateUserIds.add(uid);
    }
    return { mypagePrimaryIds, duplicateUserIds, byUser };
  }, [rows]);

  // 중복 회원 펼침 토글
  const [diagOpen, setDiagOpen] = useState(false);

  return (
    <div className="space-y-4">
      {/* 진단 패널 — 본인 대표 사업자 중복 (dealerType=null 행이 한 회원에 2개+) */}
      {mypageDiag.duplicateUserIds.size > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setDiagOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center gap-3 hover:bg-red-100/50 text-left"
          >
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-bold text-red-800">
                마이페이지 사업자 정보 충돌 — {mypageDiag.duplicateUserIds.size}명 감지
              </div>
              <div className="text-xs text-red-600 mt-0.5">
                같은 회원이 &quot;본인 대표 사업자&quot; 후보 행(병의원 유형) 을 2개 이상 가지고 있어요.
                마이페이지는 그중 가장 오래된 1행만 보여주고, 나머지는 사업자번호 충돌로 저장 안 됨.
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-red-500 transition-transform ${diagOpen ? "rotate-180" : ""}`} />
          </button>
          {diagOpen && (
            <div className="px-4 pb-4 space-y-3 border-t border-red-200 pt-3 bg-red-50/30">
              {(Array.from(mypageDiag.byUser.entries()) as [string, AdminUserClient[]][])
                .filter(([uid]) => mypageDiag.duplicateUserIds.has(uid))
                .map(([uid, list]) => {
                  const owner = list[0]; // any row has user info
                  return (
                    <div key={uid} className="bg-white border border-red-200 rounded p-3">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-sm font-bold text-gray-900">{owner.user.name || owner.user.email.split("@")[0]}</span>
                        <span className="text-xs text-gray-500">{owner.user.email}</span>
                        <span className="ml-auto text-[10px] text-red-700">중복 {list.length}건</span>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left py-1">거래처명</th>
                            <th className="text-left py-1">사업자번호</th>
                            <th className="text-left py-1">등록일</th>
                            <th className="text-left py-1">상태</th>
                            <th className="text-center py-1 w-20">수정/삭제</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {list.map((r, idx) => {
                            const isEditingHere = editingId === r.id;
                            const isSavingHere = savingId === r.id;
                            return (
                            <Fragment key={r.id}>
                            <tr className={`${idx === 0 ? "bg-green-50/40" : ""} ${isEditingHere ? "bg-blue-50/40" : ""}`}>
                              <td className="py-1.5 font-medium">
                                {isEditingHere && editValues ? (
                                  <input
                                    value={editValues.clientName}
                                    onChange={(e) => setEditValues({ ...editValues, clientName: e.target.value })}
                                    className="border border-blue-300 rounded px-1.5 py-0.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-400"
                                    autoFocus
                                  />
                                ) : r.clientName}
                              </td>
                              <td className="py-1.5 font-mono">
                                {isEditingHere && editValues ? (
                                  <input
                                    value={editValues.bizNumber}
                                    onChange={(e) => setEditValues({ ...editValues, bizNumber: e.target.value })}
                                    placeholder="10자리"
                                    className="border border-blue-300 rounded px-1.5 py-0.5 text-xs font-mono w-28 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  />
                                ) : r.bizNumber}
                              </td>
                              <td className="py-1.5 text-gray-500">{new Date(r.createdAt).toLocaleDateString("ko-KR")}</td>
                              <td className="py-1.5">
                                {idx === 0
                                  ? <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold text-[10px]">마이페이지 표시</span>
                                  : <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold text-[10px]">숨김 — 저장 시 충돌</span>}
                              </td>
                              <td className="py-1.5 text-center">
                                {isEditingHere ? (
                                  <div className="inline-flex items-center gap-0.5">
                                    <button
                                      onClick={() => saveEdit(r)}
                                      disabled={isSavingHere}
                                      title="저장"
                                      className="text-green-600 hover:text-green-800 disabled:opacity-30 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-green-50"
                                    >
                                      {isSavingHere ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    </button>
                                    <button
                                      onClick={cancelEdit}
                                      disabled={isSavingHere}
                                      title="취소"
                                      className="text-gray-400 hover:text-gray-700 disabled:opacity-30 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-gray-100"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-0.5">
                                    <button
                                      onClick={() => startEdit(r)}
                                      disabled={editingId !== null || deletingId === r.id}
                                      title="수정"
                                      className="text-gray-400 hover:text-blue-600 disabled:opacity-30 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-blue-50"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDelete(r)}
                                      disabled={deletingId === r.id || editingId !== null}
                                      title="이 거래처 행 삭제"
                                      className="text-gray-400 hover:text-red-600 disabled:opacity-30 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-red-50"
                                    >
                                      {deletingId === r.id
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : <Trash2 className="w-3 h-3" />}
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                            {isEditingHere && editError && (
                              <tr className="bg-red-50">
                                <td colSpan={5} className="py-1.5 px-2 text-[11px] text-red-700">{editError}</td>
                              </tr>
                            )}
                            </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              <p className="text-[11px] text-red-700 px-1">
                해결: 어드민에서 불필요한 행을 정리하거나, 회원에게 거래처관리(의료기관) 페이지에서 직접 삭제 안내.
                마이페이지 사업자 정보 수정으로는 이 충돌을 풀 수 없어요.
              </p>
            </div>
          )}
        </div>
      )}

    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">사업자관리 ({rows.length}건)</h2>
          <p className="text-xs text-gray-400 mt-0.5">전체 등록 사업자 정보를 유형별로 확인할 수 있어요.</p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="담당자 / 거래처명 / 사업자번호 검색"
          className="h-9 w-64 border border-gray-200 rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      <div className="flex border-b border-gray-100">
        {SUB_TABS.map((t) => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`text-sm px-5 py-2.5 border-b-2 font-medium transition-colors ${
              subTab === t.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}>
            {t.label} <span className="text-xs opacity-60">({counts[t.key]})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-gray-400 text-sm">해당하는 사업자가 없어요.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
                <th className="px-4 py-3 text-left">거래처명</th>
                <th className="px-4 py-3 text-left">사업자번호</th>
                <th className="px-4 py-3 text-left">유형</th>
                <th className="px-4 py-3 text-left">담당자</th>
                <th className="px-4 py-3 text-left">이메일</th>
                <th className="px-4 py-3 text-center">승인</th>
                <th className="px-4 py-3 text-center">등록일</th>
                <th className="px-4 py-3 text-center">삭제</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((c) => {
                const isMypagePrimary = mypageDiag.mypagePrimaryIds.has(c.id);
                const isHiddenConflict = !c.dealerType && !isMypagePrimary && mypageDiag.duplicateUserIds.has(c.userId);
                const isEditing = editingId === c.id;
                const isSaving = savingId === c.id;
                return (
                <Fragment key={c.id}>
                <tr className={`hover:bg-gray-50 ${isHiddenConflict ? "bg-amber-50/40" : ""} ${isEditing ? "bg-blue-50/30" : ""}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {isEditing && editValues ? (
                      <input
                        value={editValues.clientName}
                        onChange={(e) => setEditValues({ ...editValues, clientName: e.target.value })}
                        className="border border-blue-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-400"
                        autoFocus
                      />
                    ) : (
                      <>
                        {c.clientName}
                        {isMypagePrimary && c.dealerType == null && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-semibold align-middle">마이페이지 표시</span>
                        )}
                        {isHiddenConflict && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold align-middle">숨김 — 저장 충돌</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs font-mono">
                    {isEditing && editValues ? (
                      <input
                        value={editValues.bizNumber}
                        onChange={(e) => setEditValues({ ...editValues, bizNumber: e.target.value })}
                        placeholder="10자리 숫자"
                        className="border border-blue-300 rounded px-2 py-1 text-xs font-mono w-32 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    ) : c.bizNumber}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing && editValues ? (
                      <select
                        value={editValues.dealerType ?? ""}
                        onChange={(e) => setEditValues({ ...editValues, dealerType: e.target.value || null })}
                        className="border border-blue-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="">병의원(원외)</option>
                        <option value="UPPER_CORP">상위법인</option>
                        <option value="LOWER_CORP">하위법인</option>
                        <option value="CORPORATION">법인</option>
                        <option value="INDIVIDUAL">개인사업자</option>
                      </select>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dealerColor(c.dealerType)}`}>
                        {dealerLabel(c.dealerType)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <p>{c.user.name || "-"}</p>
                    {c.user.phone && <p className="text-xs text-gray-400 mt-0.5">{c.user.phone}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.user.email}</td>
                  <td className="px-4 py-3 text-center">
                    {isEditing && editValues ? (
                      <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editValues.approved}
                          onChange={(e) => setEditValues({ ...editValues, approved: e.target.checked })}
                          className="w-3.5 h-3.5"
                        />
                        승인
                      </label>
                    ) : c.approved
                      ? <span className="text-xs text-green-600 font-medium">승인</span>
                      : <span className="text-xs text-amber-500">미승인</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-400">
                    {new Date(c.createdAt).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isEditing ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => saveEdit(c)}
                          disabled={isSaving}
                          title="저장"
                          className="text-green-600 hover:text-green-800 disabled:opacity-30 inline-flex items-center justify-center w-7 h-7 rounded hover:bg-green-50"
                        >
                          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={isSaving}
                          title="취소"
                          className="text-gray-400 hover:text-gray-700 disabled:opacity-30 inline-flex items-center justify-center w-7 h-7 rounded hover:bg-gray-100"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => startEdit(c)}
                          disabled={editingId !== null || deletingId === c.id}
                          title="수정"
                          className="text-gray-400 hover:text-blue-600 disabled:opacity-30 inline-flex items-center justify-center w-7 h-7 rounded hover:bg-blue-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(c)}
                          disabled={deletingId === c.id || editingId !== null}
                          title="이 거래처 행 삭제"
                          className="text-gray-400 hover:text-red-600 disabled:opacity-30 inline-flex items-center justify-center w-7 h-7 rounded hover:bg-red-50"
                        >
                          {deletingId === c.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                {isEditing && editError && (
                  <tr className="bg-red-50">
                    <td colSpan={8} className="px-4 py-2 text-xs text-red-700">{editError}</td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </div>
  );
}
