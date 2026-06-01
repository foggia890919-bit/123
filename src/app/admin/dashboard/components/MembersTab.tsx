"use client";

import { useState, useEffect } from "react";
import { CheckCircle, Search, X, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { User, UserDoc, roleColor } from "./types";

export default function MembersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [docUser, setDocUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [bulkApproving, setBulkApproving] = useState(false);

  useEffect(() => {
    const delay = searchQuery ? 300 : 0;
    const t = setTimeout(() => fetchUsers(searchQuery), delay);
    return () => clearTimeout(t);
  }, [searchQuery]);

  async function fetchUsers(q: string) {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/admin/users?${params}`);
    const data = await res.json();
    const list: User[] = Array.isArray(data) ? data : (data.users ?? []);
    setUsers(list);
    setTotal(Array.isArray(data) ? list.length : (data.total ?? list.length));
    setLoading(false);
  }

  async function bulkApprove() {
    const pendingCount = users.filter((u) => !u.approved).length;
    if (pendingCount === 0) return;
    if (!confirm(`미승인 회원 ${pendingCount}명을 모두 승인할까요?`)) return;
    setBulkApproving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulkApprove" }),
      });
      if (res.ok) await fetchUsers(searchQuery);
    } finally {
      setBulkApproving(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, role }) });
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role } : u));
  }

  async function toggleApproval(userId: string, approved: boolean) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, approved }) });
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, approved } : u));
  }

  async function toggleBusinessApproval(userId: string, isBusinessApproved: boolean) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, isBusinessApproved }) });
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isBusinessApproved } : u));
  }

  async function resetPassword() {
    if (!newPw || newPw.length < 4) return alert("4자 이상 입력해주세요.");
    setPwLoading(true);
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: resetUserId, newPassword: newPw }) });
    setPwLoading(false);
    setResetUserId(null);
    setNewPw("");
    alert("비밀번호가 초기화됐어요.");
  }

  async function downloadDoc(doc: UserDoc) {
    let data = doc.fileData;
    if (!data) {
      const res = await fetch(`/api/admin/users/document/${doc.id}`);
      if (!res.ok) { alert("문서를 불러오지 못했어요."); return; }
      const full = await res.json();
      data = full.fileData;
    }
    if (!data) return;
    const a = document.createElement("a");
    a.href = data;
    a.download = doc.fileName;
    a.click();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">
                회원 목록 {total > 0 && <span className="text-base font-normal text-gray-500">({total}명)</span>}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">가입 승인 후 서비스를 이용할 수 있어요.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="이름·이메일·연락처 검색"
                  className="h-8 pl-7 pr-7 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 w-52"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {users.filter((u) => !u.approved).length > 0 && (
                <button
                  onClick={bulkApprove}
                  disabled={bulkApproving}
                  className="h-8 px-3 text-xs font-medium rounded-md bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                >
                  {bulkApproving
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <CheckCircle className="w-3.5 h-3.5" />}
                  일괄 승인 ({users.filter((u) => !u.approved).length}명)
                </button>
              )}
            </div>
          </div>
        </div>
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중...
          </div>
        ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 font-semibold">
              <th className="px-4 py-3 text-left">이름</th>
              <th className="px-4 py-3 text-left">이메일</th>
              <th className="px-4 py-3 text-left">연락처</th>
              <th className="px-4 py-3 text-center">직업</th>
              <th className="px-4 py-3 text-center">가입일</th>
              <th className="px-4 py-3 text-center">상태</th>
              <th className="px-4 py-3 text-center">서류</th>
              <th className="px-4 py-3 text-center">승인</th>
              <th className="px-4 py-3 text-center">비밀번호</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900 cursor-pointer hover:text-blue-600"
                  title="클릭해서 이름 수정"
                  onClick={() => {
                    const newName = prompt("이름 수정:", user.name || "");
                    if (newName === null) return;
                    fetch("/api/admin/users", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ userId: user.id, name: newName.trim() }),
                    }).then(async (r) => {
                      if (r.ok) setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, name: newName.trim() } : u));
                      else alert("수정 실패");
                    });
                  }}>{user.name || "-"}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{user.email}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  <div>{user.carrier || "-"}</div>
                  <div>{user.phone || "-"}</div>
                </td>
                <td className="px-4 py-3 text-center">
                  <select
                    value={user.role}
                    onChange={(e) => changeRole(user.id, e.target.value)}
                    className={`text-xs font-medium rounded px-2 py-1 border-0 cursor-pointer ${roleColor[user.role] || "bg-gray-100 text-gray-600"}`}
                  >
                    <option value="HOSPITAL">병의원</option>
                    <option value="PHARMACY">약국</option>
                    <option value="SALES">CSO(영업)</option>
                    <option value="BIZ">CSO·비즈관리자</option>
                    <option value="ADMIN">CSO·관리자</option>
                    <option value="GENERAL">일반</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-center text-gray-400 text-xs">{new Date(user.createdAt).toLocaleDateString("ko-KR")}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Badge variant={user.approved ? "success" : "warning"}>{user.approved ? "가입 승인" : "가입 대기"}</Badge>
                    {user.isBusinessApproved
                      ? <Badge variant="success">사업자 인증</Badge>
                      : (user.userClients && user.userClients.length > 0
                          ? <Badge variant="warning">사업자 대기</Badge>
                          : <span className="text-[10px] text-gray-400">사업자 정보 없음</span>)}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-1">
                    {user.documents && user.documents.length > 0 ? (
                      <button onClick={() => setDocUser(user)} className="text-xs text-blue-600 hover:underline">
                        가입서류 ({user.documents.length})
                      </button>
                    ) : <span className="text-xs text-gray-300">없음</span>}
                    {user.userClients && user.userClients[0] && (
                      <div className="text-[10px] text-gray-500 text-center space-y-0.5">
                        <div className="cursor-pointer hover:text-blue-600" title="클릭해서 수정"
                          onClick={() => {
                            const newName = prompt("상호명 수정:", user.userClients![0].clientName);
                            if (newName === null) return;
                            const newBiz = prompt("사업자번호 수정:", user.userClients![0].bizNumber);
                            if (newBiz === null) return;
                            fetch("/api/admin/users", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ userId: user.id, bizUpdate: { clientName: newName, bizNumber: newBiz } }),
                            }).then(async (r) => {
                              if (r.ok) {
                                const d = await r.json();
                                setUsers((prev) => prev.map((u) =>
                                  u.id === user.id && u.userClients?.[0]
                                    ? { ...u, userClients: [{ ...u.userClients[0], clientName: d.clientName ?? newName, bizNumber: d.bizNumber ?? newBiz }] }
                                    : u
                                ));
                              } else {
                                const d = await r.json().catch(() => ({}));
                                alert(d.error || "수정 실패");
                              }
                            });
                          }}>
                          {user.userClients[0].clientName}
                        </div>
                        <div className="font-mono">{user.userClients[0].bizNumber}</div>
                        {user.userClients[0].bizFileName && (
                          <a href={`/api/files/user-client-biz/${user.userClients[0].id}`} target="_blank" rel="noreferrer"
                            className="text-blue-600 hover:underline">사업자등록증</a>
                        )}
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <button onClick={() => toggleApproval(user.id, !user.approved)}
                      className={`text-xs px-2.5 py-1 rounded font-medium transition-colors w-full ${user.approved ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>
                      가입 {user.approved ? "취소" : "승인"}
                    </button>
                    {user.userClients && user.userClients.length > 0 && (
                      <button onClick={() => toggleBusinessApproval(user.id, !user.isBusinessApproved)}
                        className={`text-xs px-2.5 py-1 rounded font-medium transition-colors w-full ${user.isBusinessApproved ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                        사업자 {user.isBusinessApproved ? "취소" : "승인"}
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => { setResetUserId(user.id); setNewPw(""); }}
                    className="text-xs px-2.5 py-1.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">
                    초기화
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-gray-400 text-sm">
                  {searchQuery ? `"${searchQuery}" 검색 결과가 없어요.` : "가입 회원이 없어요."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        )}
      </div>

      {/* 비밀번호 초기화 모달 */}
      {resetUserId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-80 space-y-4 shadow-xl">
            <h3 className="font-semibold text-gray-900">임시 비밀번호 설정</h3>
            <input value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="새 비밀번호 입력"
              className="w-full h-10 border border-gray-300 rounded-md px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <div className="flex gap-2">
              <button onClick={() => setResetUserId(null)} className="flex-1 h-10 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">취소</button>
              <button onClick={resetPassword} disabled={pwLoading} className="flex-1 h-10 rounded-md bg-gray-800 text-white text-sm hover:bg-gray-700">
                {pwLoading ? "처리 중..." : "변경"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 첨부서류 모달 */}
      {docUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 space-y-4 shadow-xl">
            <h3 className="font-semibold text-gray-900">{docUser.name} 첨부서류</h3>
            {docUser.documents?.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-800">{doc.docType}</p>
                  <p className="text-xs text-gray-400">{doc.fileName}</p>
                </div>
                <button onClick={() => downloadDoc(doc)} className="text-xs text-blue-600 border border-blue-200 rounded px-3 py-1.5 hover:bg-blue-50">다운로드</button>
              </div>
            ))}
            <button onClick={() => setDocUser(null)} className="w-full h-10 rounded-md border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
