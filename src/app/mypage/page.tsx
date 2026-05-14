"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  User, KeyRound, CheckCircle, ArrowUpCircle, ChevronRight,
  Building2, FileSpreadsheet, FileText, Upload, Pencil, Loader2,
} from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS, type UserRole } from "@/lib/roles";

const KAKAO_URL = "https://open.kakao.com/me/ykmedi";

const carriers = ["SKT", "KT", "LG U+", "SKT 알뜰폰", "KT 알뜰폰", "LG 알뜰폰"];
const editableRoles = [
  { value: "SALES_REP", label: "영업사원 (CSO)" },
  { value: "DOCTOR",    label: "의사" },
  { value: "PHARMACIST",label: "약사" },
  { value: "BASIC",     label: "일반회원" },
];
const docTypes = ["CSO 신고증", "의사 면허증", "약사 면허증", "사업자등록증", "기타"];

interface ProfileInfo {
  name: string; email: string; phone: string | null;
  carrier: string | null; role: string;
  documents: { id: string; docType: string; fileName: string; createdAt: string }[];
}

function compressImage(dataUri: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round((height * MAX) / width); width = MAX; }
        else { width = Math.round((width * MAX) / height); height = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => resolve(dataUri);
    img.src = dataUri;
  });
}

export default function MyPage() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();

  // Profile info
  const [profileInfo, setProfileInfo] = useState<ProfileInfo | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [editName, setEditName] = useState("");
  const [editCarrier, setEditCarrier] = useState("");
  const [editRole, setEditRole] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState(false);

  // Password change
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  // Document upload
  const docFileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("CSO 신고증");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError] = useState("");
  const [docSuccess, setDocSuccess] = useState(false);

  useEffect(() => {
    if (status === "authenticated") loadProfile();
  }, [status]);

  async function loadProfile() {
    setProfileLoading(true);
    try {
      const res = await fetch("/api/mypage");
      if (res.ok) {
        const data: ProfileInfo = await res.json();
        setProfileInfo(data);
        setEditName(data.name);
        setEditCarrier(data.carrier ?? "");
        setEditRole(data.role);
      }
    } finally {
      setProfileLoading(false);
    }
  }

  if (status === "loading" || profileLoading) {
    return <div className="py-20 text-center text-gray-400">불러오는 중...</div>;
  }
  if (!session) { router.push("/login"); return null; }

  const isBiz = session.user.role === "BIZ" || session.user.role === "ADMIN";

  async function handleProfileSave() {
    setProfileError(""); setProfileSuccess(false);
    if (!editName.trim()) { setProfileError("이름을 입력해주세요."); return; }
    setProfileSaving(true);
    const res = await fetch("/api/mypage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), carrier: editCarrier || null, role: editRole }),
    });
    const data = await res.json();
    if (!res.ok) { setProfileError(data.error || "저장 실패"); }
    else {
      setProfileSuccess(true);
      await updateSession();
      await loadProfile();
    }
    setProfileSaving(false);
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(""); setPwSuccess(false);
    if (newPw !== confirmPw) { setPwError("새 비밀번호가 일치하지 않아요."); return; }
    if (newPw.length < 8) { setPwError("비밀번호는 8자 이상이어야 해요."); return; }
    setPwLoading(true);
    const res = await fetch("/api/mypage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    });
    const data = await res.json();
    if (!res.ok) { setPwError(data.error); }
    else { setPwSuccess(true); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }
    setPwLoading(false);
  }

  async function handleDocUpload() {
    if (!docFile) { setDocError("파일을 선택해주세요."); return; }
    if (docFile.size > 10 * 1024 * 1024) { setDocError("파일 크기는 10MB 이하여야 합니다."); return; }
    setDocError(""); setDocSuccess(false); setDocUploading(true);
    try {
      const fileData: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(docFile);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
      });
      const compressed = docFile.type.startsWith("image/") ? await compressImage(fileData) : fileData;
      const res = await fetch("/api/mypage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, fileName: docFile.name, fileData: compressed }),
      });
      const data = await res.json();
      if (!res.ok) { setDocError(data.error || "업로드 실패"); }
      else {
        setDocSuccess(true);
        setDocFile(null);
        setProfileInfo((prev) =>
          prev ? { ...prev, documents: [{ ...data }, ...prev.documents] } : prev
        );
      }
    } catch {
      setDocError("업로드 중 오류가 발생했어요.");
    } finally {
      setDocUploading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 mt-4">
      {/* 프로필 카드 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center">
            <User className="w-7 h-7 text-blue-600" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">{session.user.name}</h1>
            <p className="text-gray-500 text-sm">{session.user.email}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${ROLE_COLORS[session.user.role as UserRole] ?? "bg-gray-100 text-gray-600"}`}>
                {ROLE_LABELS[session.user.role as UserRole] ?? session.user.role}
              </span>
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">현재 이용 등급</p>
              <p className="text-sm font-semibold text-gray-800">
                {ROLE_LABELS[session.user.role as UserRole] ?? session.user.role}
              </p>
            </div>
            <a href={KAKAO_URL} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-medium bg-[#FEE500] hover:bg-[#FFCF00] text-[#3C1E1E] px-3 py-2 rounded-lg transition-colors">
              <ArrowUpCircle className="w-3.5 h-3.5" />등급 변경 문의
            </a>
          </div>
        </div>
      </div>

      {/* 내 정보 수정 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Pencil className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-800">내 정보 수정</h2>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                이메일 <span className="text-xs text-gray-400">(변경 불가)</span>
              </label>
              <Input value={profileInfo?.email ?? ""} disabled className="bg-gray-50 text-gray-400" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">
                전화번호 <span className="text-xs text-gray-400">(변경 불가)</span>
              </label>
              <Input value={profileInfo?.phone ?? ""} disabled className="bg-gray-50 text-gray-400" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">이름</label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="이름" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">통신사</label>
              <select value={editCarrier} onChange={(e) => setEditCarrier(e.target.value)}
                className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">선택 안함</option>
                {carriers.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">직업</label>
              <select value={editRole} onChange={(e) => setEditRole(e.target.value)}
                className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {editableRoles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          {profileError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{profileError}</p>}
          {profileSuccess && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-3 rounded-lg">
              <CheckCircle className="w-4 h-4" /> 정보가 수정됐어요!
            </div>
          )}
          <Button onClick={handleProfileSave} disabled={profileSaving} className="w-full">
            {profileSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />저장 중...</> : "저장"}
          </Button>
        </div>
      </div>

      {/* 서류 관리 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-800">서류 관리</h2>
        </div>

        {/* 기존 서류 목록 */}
        {profileInfo && profileInfo.documents.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500">등록된 서류</p>
            {profileInfo.documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{doc.fileName}</p>
                  <p className="text-xs text-gray-400">{doc.docType}</p>
                </div>
                <p className="text-xs text-gray-400 shrink-0">
                  {new Date(doc.createdAt).toLocaleDateString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric" })}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">등록된 서류가 없어요.</p>
        )}

        {/* 새 서류 추가 */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">서류 추가 첨부</p>
          <select value={docType} onChange={(e) => setDocType(e.target.value)}
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {docTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div onClick={() => docFileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${docFile ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}>
            <Upload className="w-5 h-5 text-gray-400 mx-auto mb-1" />
            <p className="text-sm text-gray-500">
              {docFile ? <span className="font-medium text-gray-800">{docFile.name}</span> : "클릭해서 파일 선택"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">JPG, PNG, PDF · 최대 10MB</p>
            <input ref={docFileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
              onChange={(e) => { setDocFile(e.target.files?.[0] || null); setDocSuccess(false); setDocError(""); }} />
          </div>
          {docError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{docError}</p>}
          {docSuccess && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-3 rounded-lg">
              <CheckCircle className="w-4 h-4" /> 서류가 등록됐어요!
            </div>
          )}
          <Button onClick={handleDocUpload} disabled={docUploading || !docFile} className="w-full">
            {docUploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />업로드 중...</> : <><Upload className="w-4 h-4 mr-2" />첨부하기</>}
          </Button>
        </div>
      </div>

      {/* BIZ 전용 메뉴 */}
      {isBiz && (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          <p className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">비즈 메뉴</p>
          <Link href="/mypage/dealer" className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg"><Building2 className="w-4 h-4 text-blue-600" /></div>
              <div>
                <p className="text-sm font-medium text-gray-800">딜러 관리</p>
                <p className="text-xs text-gray-400">거래처별 계층 분류</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </Link>
          <Link href="/mypage/settlement" className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg"><FileSpreadsheet className="w-4 h-4 text-green-600" /></div>
              <div>
                <p className="text-sm font-medium text-gray-800">정산서 관리</p>
                <p className="text-xs text-gray-400">법인 양식 템플릿 & 취합</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </Link>
        </div>
      )}

      {/* 비밀번호 변경 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-800">비밀번호 변경</h2>
        </div>
        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">현재 비밀번호</label>
            <Input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="현재 비밀번호" required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">새 비밀번호</label>
            <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="8자 이상" minLength={8} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">새 비밀번호 확인</label>
            <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="비밀번호 재입력" required />
          </div>
          {pwError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{pwError}</p>}
          {pwSuccess && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-3 rounded-lg">
              <CheckCircle className="w-4 h-4" /> 비밀번호가 변경됐어요!
            </div>
          )}
          <Button type="submit" className="w-full" disabled={pwLoading}>
            {pwLoading ? "변경 중..." : "비밀번호 변경"}
          </Button>
        </form>
      </div>
    </div>
  );
}
