"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle, AlertCircle, ShieldCheck, Users, Percent, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Tab = "upload" | "members" | "rates";

interface UserDoc { id: string; docType: string; fileName: string; fileData: string; }
interface User {
  id: string; email: string; name: string | null;
  role: string; approved: boolean; createdAt: string;
  phone?: string | null; carrier?: string | null;
  documents?: UserDoc[];
}

const roleLabel: Record<string, string> = {
  ADMIN: "관리자", SALES_REP: "영업사원", DOCTOR: "의사", PHARMACIST: "약사",
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("upload");

  useEffect(() => {
    if (sessionStorage.getItem("isAdmin") !== "true") router.push("/admin/login");
  }, [router]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-7 h-7 text-gray-800" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">관리자 대시보드</h1>
          <p className="text-gray-500 text-sm">데이터 및 회원 관리</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {([
          { key: "upload", label: "요율표 업로드", icon: Upload },
          { key: "members", label: "회원관리", icon: Users },
          { key: "rates", label: "추가수수료 관리", icon: Percent },
        ] as { key: Tab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === "upload" && <UploadTab />}
      {tab === "members" && <MembersTab />}
      {tab === "rates" && <RatesTab />}
    </div>
  );
}

function UploadTab() {
  const [file, setFile] = useState<File | null>(null);
  const [isSettlement, setIsSettlement] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; count?: number; error?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    if (!file) return;
    setLoading(true); setResult(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("isSettlement", String(isSettlement));
    try {
      const res = await fetch("/api/medications/upload", { method: "POST", body: formData });
      const data = await res.json();
      setResult(data);
      if (data.success) setFile(null);
    } catch { setResult({ error: "업로드 중 오류가 발생했어요." }); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
      <h2 className="text-lg font-semibold text-gray-800">요율표 엑셀 업로드</h2>
      <div className="bg-gray-50 rounded p-3 text-xs text-gray-500 font-mono leading-relaxed">
        필요 컬럼: 분류(A) | 성분명 | 분류(B) | 코드(수수료율) | 제약사명 | 생동/생산 | 품목명 | 약가 | 오리지날/대조약 | 보험코드 | 특이사항
      </div>
      <div
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${file ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) { setFile(f); setResult(null); } }}
      >
        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-500">
          {file ? <span className="font-medium text-gray-800">{file.name}</span> : <>클릭하거나 <span className="text-blue-500">드래그</span>해서 업로드</>}
        </p>
        <p className="text-xs text-gray-400 mt-1">.xlsx, .xls 지원</p>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }} />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="settlement" checked={isSettlement}
          onChange={(e) => setIsSettlement(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
        <label htmlFor="settlement" className="text-sm text-gray-700">정산 가능 제약사 요율표로 등록</label>
      </div>
      <Button onClick={handleUpload} disabled={!file || loading} className="w-full bg-gray-800 hover:bg-gray-700">
        {loading ? "업로드 중..." : "업로드"}
      </Button>
      {result && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {result.success ? <><CheckCircle className="w-4 h-4 shrink-0" />{result.count?.toLocaleString()}개 품목 등록 완료!</>
            : <><AlertCircle className="w-4 h-4 shrink-0" />{result.error}</>}
        </div>
      )}
    </div>
  );
}

function MembersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [docUser, setDocUser] = useState<User | null>(null);

  useEffect(() => { fetchUsers(); }, []);

  async function fetchUsers() {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    setUsers(await res.json());
    setLoading(false);
  }

  async function toggleApproval(userId: string, approved: boolean) {
    await fetch("/api/admin/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, approved }) });
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, approved } : u));
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

  function downloadDoc(doc: UserDoc) {
    const a = document.createElement("a");
    a.href = doc.fileData;
    a.download = doc.fileName;
    a.click();
  }

  if (loading) return <div className="py-16 text-center text-gray-400 text-sm">불러오는 중...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800">회원 목록 ({users.length}명)</h2>
          <p className="text-xs text-gray-400 mt-0.5">가입 승인 후 서비스를 이용할 수 있어요.</p>
        </div>
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
                <td className="px-4 py-3 font-medium text-gray-900">{user.name || "-"}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{user.email}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  <div>{user.carrier || "-"}</div>
                  <div>{user.phone || "-"}</div>
                </td>
                <td className="px-4 py-3 text-center"><Badge variant="secondary">{roleLabel[user.role] || user.role}</Badge></td>
                <td className="px-4 py-3 text-center text-gray-400 text-xs">{new Date(user.createdAt).toLocaleDateString("ko-KR")}</td>
                <td className="px-4 py-3 text-center">
                  <Badge variant={user.approved ? "success" : "warning"}>{user.approved ? "승인됨" : "대기중"}</Badge>
                </td>
                <td className="px-4 py-3 text-center">
                  {user.documents && user.documents.length > 0 ? (
                    <button onClick={() => setDocUser(user)} className="text-xs text-blue-600 hover:underline">
                      보기 ({user.documents.length})
                    </button>
                  ) : <span className="text-xs text-gray-300">없음</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleApproval(user.id, !user.approved)}
                    className={`text-xs px-2.5 py-1.5 rounded font-medium transition-colors ${user.approved ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>
                    {user.approved ? "취소" : "승인"}
                  </button>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => { setResetUserId(user.id); setNewPw(""); }}
                    className="text-xs px-2.5 py-1.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">
                    초기화
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={9} className="py-12 text-center text-gray-400 text-sm">가입 회원이 없어요.</td></tr>}
          </tbody>
        </table>
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

function RatesTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; count?: number; error?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/users").then((r) => r.json()).then(setUsers);
  }, []);

  async function downloadTemplate() {
    if (!selectedUser) return alert("회원을 먼저 선택해주세요.");
    const res = await fetch("/api/admin/rates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedUser }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const user = users.find((u) => u.id === selectedUser);
    a.download = `${user?.name || "회원"}_추가수수료.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function uploadRates(file: File) {
    if (!selectedUser) return alert("회원을 먼저 선택해주세요.");
    setUploading(true); setResult(null);
    const formData = new FormData();
    formData.append("userId", selectedUser);
    formData.append("file", file);
    try {
      const res = await fetch("/api/admin/rates", { method: "POST", body: formData });
      const data = await res.json();
      setResult(data);
    } catch { setResult({ error: "업로드 오류" }); }
    finally { setUploading(false); }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">회원별 추가수수료 관리</h2>
        <p className="text-sm text-gray-500">회원 선택 → 엑셀 다운로드 → B열에 추가수수료 입력 → 업로드</p>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">회원 선택</label>
          <select
            value={selectedUser}
            onChange={(e) => { setSelectedUser(e.target.value); setResult(null); }}
            className="w-full h-10 rounded-md border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">-- 회원 선택 --</option>
            {users.filter((u) => u.approved).map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <Button onClick={downloadTemplate} disabled={!selectedUser} variant="outline" className="flex-1">
            <Download className="w-4 h-4 mr-2" />
            제약사 목록 엑셀 다운로드
          </Button>
          <Button onClick={() => fileRef.current?.click()} disabled={!selectedUser} className="flex-1 bg-gray-800 hover:bg-gray-700">
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            {uploading ? "업로드 중..." : "수수료 엑셀 업로드"}
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadRates(f); }} />
        </div>

        <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-700 space-y-1">
          <p className="font-medium">엑셀 작성 방법</p>
          <p>• A열: 제약사명 (다운로드한 그대로 유지)</p>
          <p>• B열: 추가수수료(%) 숫자 입력 (예: 2.5)</p>
          <p>• 0이면 추가수수료 없음, 입력한 수치가 기본수수료에 더해져 합계수수료가 됩니다</p>
        </div>

        {result && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {result.success
              ? <><CheckCircle className="w-4 h-4 shrink-0" />{result.count}개 제약사 수수료 적용 완료!</>
              : <><AlertCircle className="w-4 h-4 shrink-0" />{result.error}</>}
          </div>
        )}
      </div>
    </div>
  );
}
