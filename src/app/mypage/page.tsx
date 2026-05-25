"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  User, KeyRound, CheckCircle, ArrowUpCircle, ChevronRight,
  Building2, FileSpreadsheet, FileText, Upload, Pencil, Loader2, Briefcase,
  Network,
} from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS, type UserRole } from "@/lib/roles";

const KAKAO_URL = "https://open.kakao.com/me/ykmedi";

const editableRoles = [
  { value: "BUSINESS",  label: "사업자" },
  { value: "DOCTOR",     label: "의사" },
  { value: "PHARMACIST", label: "약사" },
  { value: "BASIC",      label: "일반회원" },
];
const docTypes = ["CSO 신고증", "의사 면허증", "약사 면허증", "사업자등록증", "기타"];

interface BizClient {
  id: string; clientName: string; bizNumber: string;
  address: string | null; bizFileName: string | null;
  dealerType: string | null;
}
interface ProfileInfo {
  name: string; email: string; phone: string | null;
  carrier: string | null; role: string;
  isBusinessApproved: boolean;
  parent: { id: string; name: string | null; email: string } | null;
  documents: { id: string; docType: string; fileName: string; createdAt: string }[];
  bizClient: BizClient | null;
}

function formatBizNumber(v: string) {
  const d = v.replace(/\D/g, "");
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 10)}`;
}
function validateBizNumber(biz: string): boolean {
  const d = biz.replace(/\D/g, "");
  if (d.length !== 10) return false;
  const n = d.split("").map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += n[i] * w[i];
  sum += Math.floor(n[8] * 5 / 10);
  return (10 - (sum % 10)) % 10 === n[9];
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

  const [profileInfo, setProfileInfo] = useState<ProfileInfo | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // 프로필 수정
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState(false);

  // 사업자 정보
  const bizDocFileRef = useRef<HTMLInputElement>(null);
  // IME(한글 입력) 미반영 케이스 방어용 — 입력칸 DOM 값을 직접 읽기 위함
  const editBizNameRef = useRef<HTMLInputElement>(null);
  const editBizNumberRef = useRef<HTMLInputElement>(null);
  const editBizAddressRef = useRef<HTMLInputElement>(null);
  // 국세청 진위확인 상태 — 사업자번호 10자리 입력시 자동 조회.
  const [ntsVerifyStatus, setNtsVerifyStatus] = useState<"idle" | "checking" | "valid" | "closed" | "invalid" | "error">("idle");
  const [ntsVerifyMessage, setNtsVerifyMessage] = useState<string>("");
  const [editBizNumber, setEditBizNumber] = useState("");
  const [editBizName, setEditBizName] = useState("");
  const [editBizAddress, setEditBizAddress] = useState("");
  // 사업자 유형 — null = 병의원(원외) (기본). 다른 값은 enum DealerType 의 이름.
  const [editBizDealerType, setEditBizDealerType] = useState<string | "">("");
  const [bizNumberError, setBizNumberError] = useState("");
  const [bizDocFile, setBizDocFile] = useState<File | null>(null);
  const [bizSaving, setBizSaving] = useState(false);
  const [bizError, setBizError] = useState("");
  const [bizSuccess, setBizSuccess] = useState(false);

  // 비밀번호 변경
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  // 서류 첨부
  const docFileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("CSO 신고증");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError] = useState("");
  const [docSuccess, setDocSuccess] = useState(false);

  useEffect(() => {
    if (status === "authenticated") loadProfile();
  }, [status]);

  // 사업자번호 10자리 + 형식 검증 통과시 국세청 자동 조회 (debounce 600ms).
  useEffect(() => {
    const digits = editBizNumber.replace(/\D/g, "");
    if (digits.length !== 10 || bizNumberError) {
      setNtsVerifyStatus("idle");
      setNtsVerifyMessage("");
      return;
    }
    setNtsVerifyStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/biz-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bizNumber: digits }),
        });
        const data = await res.json();
        if (res.status === 503) {
          // API 키 미설정 — 자체 검증만으로 통과시키되 안내는 안 띄움
          setNtsVerifyStatus("idle");
          setNtsVerifyMessage("");
          return;
        }
        if (data.valid === true) {
          setNtsVerifyStatus("valid");
          setNtsVerifyMessage(`국세청 확인 완료 (${data.statusText || "계속사업자"})`);
        } else if (data.closed) {
          setNtsVerifyStatus("closed");
          setNtsVerifyMessage("폐업한 사업자번호예요.");
        } else if (data.valid === false) {
          setNtsVerifyStatus("invalid");
          setNtsVerifyMessage("국세청에 등록되지 않은 사업자번호예요.");
        } else {
          setNtsVerifyStatus("error");
          setNtsVerifyMessage(data.error || "조회 실패");
        }
      } catch {
        setNtsVerifyStatus("error");
        setNtsVerifyMessage("조회 중 오류가 발생했어요.");
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [editBizNumber, bizNumberError]);

  async function loadProfile() {
    setProfileLoading(true);
    try {
      const res = await fetch("/api/mypage");
      if (res.ok) {
        const data: ProfileInfo = await res.json();
        setProfileInfo(data);
        setEditName(data.name);
        setEditRole(data.role);
        if (data.bizClient) {
          const fmt = formatBizNumber(data.bizClient.bizNumber);
          setEditBizNumber(fmt);
          setEditBizName(data.bizClient.clientName);
          setEditBizAddress(data.bizClient.address ?? "");
          setEditBizDealerType(data.bizClient.dealerType ?? "");
        } else {
          // 신규 등록 — 회원 직업(role) 기반 자동 분류 (B 기능)
          //  의사/치과의사/한의사 → 병의원 (null, "")
          //  약사 → 약국 (PHARMACY)
          //  나머지 → CSO/일반 사업자
          if (data.role === "DOCTOR") setEditBizDealerType("");
          else if (data.role === "PHARMACIST") setEditBizDealerType("PHARMACY");
          else setEditBizDealerType("CSO");
        }
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

  function handleBizNumberChange(val: string) {
    const fmt = formatBizNumber(val);
    setEditBizNumber(fmt);
    const digits = fmt.replace(/\D/g, "");
    if (digits.length === 10 && !validateBizNumber(fmt)) {
      setBizNumberError("유효하지 않은 사업자등록번호예요.");
    } else {
      setBizNumberError("");
    }
    // 10자리 형식 통과시 국세청 자동 조회 트리거 (debounce 는 useEffect 에서)
    if (digits.length === 10 && validateBizNumber(fmt)) {
      setNtsVerifyStatus("idle"); // useEffect 가 다시 잡아서 'checking' 으로 바꿈
    } else {
      setNtsVerifyStatus("idle");
    }
  }

  async function handleProfileSave() {
    setProfileError(""); setProfileSuccess(false);
    if (!editName.trim()) { setProfileError("이름을 입력해주세요."); return; }
    setProfileSaving(true);
    const res = await fetch("/api/mypage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), role: editRole }),
    });
    const data = await res.json();
    if (!res.ok) { setProfileError(data.error || "저장 실패"); }
    else { setProfileSuccess(true); await updateSession(); await loadProfile(); }
    setProfileSaving(false);
  }

  async function handleBizSave() {
    setBizError(""); setBizSuccess(false);
    // input 의 실제 DOM 값을 우선 읽음 — IME(한글) 입력 직후 submit 케이스 방어.
    // state 가 아직 업데이트되지 않은 상태에서 사용자는 화면에 값이 보이는데
    // "상호명을 입력해주세요" 같은 잘못된 에러가 뜨는 문제를 막는다.
    const bizNumberVal = (editBizNumberRef.current?.value ?? editBizNumber).trim();
    const bizNameVal = (editBizNameRef.current?.value ?? editBizName).trim();
    const bizAddressVal = (editBizAddressRef.current?.value ?? editBizAddress).trim();
    // state 와 DOM 동기화 — 이후 화면이 다시 그려질 때 일관되게.
    if (bizNumberVal !== editBizNumber) setEditBizNumber(bizNumberVal);
    if (bizNameVal !== editBizName) setEditBizName(bizNameVal);
    if (bizAddressVal !== editBizAddress) setEditBizAddress(bizAddressVal);

    if (!bizNumberVal) { setBizError("사업자등록번호를 입력해주세요."); return; }
    if (bizNumberError) { setBizError(bizNumberError); return; }
    const digits = bizNumberVal.replace(/\D/g, "");
    if (digits.length !== 10) { setBizError("사업자등록번호 10자리를 입력해주세요."); return; }
    if (ntsVerifyStatus === "closed") { setBizError("폐업한 사업자번호는 등록할 수 없어요."); return; }
    if (ntsVerifyStatus === "invalid") { setBizError("국세청에 등록되지 않은 사업자번호예요."); return; }
    if (ntsVerifyStatus === "checking") { setBizError("국세청 조회가 끝날 때까지 잠시 기다려주세요."); return; }
    if (!bizNameVal) { setBizError("상호명을 입력해주세요."); return; }
    setBizSaving(true);
    try {
      let bizDocument: { fileName: string; fileData: string } | null = null;
      if (bizDocFile) {
        const fileData: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(bizDocFile);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
        });
        const compressed = bizDocFile.type.startsWith("image/") ? await compressImage(fileData) : fileData;
        bizDocument = { fileName: bizDocFile.name, fileData: compressed };
      }
      const res = await fetch("/api/mypage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          biz: {
            id: profileInfo?.bizClient?.id ?? undefined,
            clientName: bizNameVal,
            bizNumber: digits,
            address: bizAddressVal || null,
            dealerType: editBizDealerType || null,  // "" → null (병의원)
            bizDocument,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 저장 실패 — 폼 state 를 서버 실제값으로 되돌려서 사용자가 "저장된 줄 알고 새로고침" 하는 혼란 방지.
        setBizError(data.error || "저장 실패");
        await loadProfile();
      }
      else { setBizSuccess(true); setBizDocFile(null); await loadProfile(); }
    } catch {
      setBizError("저장 중 오류가 발생했어요.");
    } finally {
      setBizSaving(false);
    }
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
        setDocSuccess(true); setDocFile(null);
        setProfileInfo((prev) => prev ? { ...prev, documents: [{ ...data }, ...prev.documents] } : prev);
      }
    } catch { setDocError("업로드 중 오류가 발생했어요."); }
    finally { setDocUploading(false); }
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
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">현재 이용 등급</p>
            <p className="text-sm font-semibold text-gray-800">{ROLE_LABELS[session.user.role as UserRole] ?? session.user.role}</p>
          </div>
          <a href={KAKAO_URL} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-medium bg-[#FEE500] hover:bg-[#FFCF00] text-[#3C1E1E] px-3 py-2 rounded-lg transition-colors">
            <ArrowUpCircle className="w-3.5 h-3.5" />등급 변경 문의
          </a>
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
              <label className="text-sm font-medium text-gray-700">이메일 <span className="text-xs text-gray-400">(변경 불가)</span></label>
              <Input value={profileInfo?.email ?? ""} disabled className="bg-gray-50 text-gray-400" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">전화번호 <span className="text-xs text-gray-400">(변경 불가)</span></label>
              <Input value={profileInfo?.phone ?? ""} disabled className="bg-gray-50 text-gray-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">통신사 <span className="text-xs text-gray-400">(변경 불가)</span></label>
              <Input value={profileInfo?.carrier ?? ""} disabled className="bg-gray-50 text-gray-400" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">직업</label>
              <select value={editRole} onChange={(e) => setEditRole(e.target.value)}
                className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {editableRoles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">이름</label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="이름" />
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

      {/* 사업자 정보 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-800">사업자 정보</h2>
          {profileInfo?.bizClient && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">등록됨</span>
          )}
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">사업자등록번호 <span className="text-red-500">*</span></label>
            <Input
              value={editBizNumber}
              ref={editBizNumberRef}
              onChange={(e) => handleBizNumberChange(e.target.value)}
              placeholder="000-00-00000"
              maxLength={12}
              className={bizNumberError ? "border-red-400" : ""}
            />
            {bizNumberError && <p className="text-xs text-red-500">{bizNumberError}</p>}
            {!bizNumberError && ntsVerifyStatus === "checking" && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />국세청 조회 중...
              </p>
            )}
            {!bizNumberError && ntsVerifyStatus === "valid" && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />{ntsVerifyMessage}
              </p>
            )}
            {!bizNumberError && (ntsVerifyStatus === "closed" || ntsVerifyStatus === "invalid") && (
              <p className="text-xs text-red-500">{ntsVerifyMessage}</p>
            )}
            {!bizNumberError && ntsVerifyStatus === "error" && (
              <p className="text-xs text-amber-600">{ntsVerifyMessage}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">상호명 <span className="text-red-500">*</span></label>
            <Input ref={editBizNameRef} value={editBizName} onChange={(e) => setEditBizName(e.target.value)} placeholder="병원명 / 상호명" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">유형 <span className="text-red-500">*</span></label>
            <select
              value={editBizDealerType}
              onChange={(e) => setEditBizDealerType(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">병의원 (원외)</option>
              <option value="PHARMACY">약국</option>
              <option value="CSO">CSO / 일반 사업자</option>
              <option value="CORPORATION">법인</option>
              <option value="UPPER_CORP">상위법인</option>
              <option value="LOWER_CORP">하위법인</option>
              <option value="INDIVIDUAL">개인사업자(딜러)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">주소 <span className="text-gray-400 font-normal text-xs">(선택)</span></label>
            <Input ref={editBizAddressRef} value={editBizAddress} onChange={(e) => setEditBizAddress(e.target.value)} placeholder="예: 서울시 강남구 테헤란로 123" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              사업자등록증 <span className="text-gray-400 font-normal text-xs">
                {profileInfo?.bizClient?.bizFileName ? `(현재: ${profileInfo.bizClient.bizFileName})` : "(선택)"}
              </span>
            </label>
            <div onClick={() => bizDocFileRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${bizDocFile ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}>
              <Upload className="w-4 h-4 text-gray-400 mx-auto mb-0.5" />
              <p className="text-sm text-gray-500">
                {bizDocFile ? <span className="font-medium text-gray-800">{bizDocFile.name}</span> : "클릭해서 파일 선택 (JPG, PNG, PDF)"}
              </p>
              <input ref={bizDocFileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                onChange={(e) => { setBizDocFile(e.target.files?.[0] || null); setBizSuccess(false); }} />
            </div>
          </div>
          {bizError && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{bizError}</p>}
          {bizSuccess && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-3 rounded-lg">
              <CheckCircle className="w-4 h-4" /> 사업자 정보가 저장됐어요!
            </div>
          )}
          <Button onClick={handleBizSave} disabled={bizSaving} className="w-full">
            {bizSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />저장 중...</> : profileInfo?.bizClient ? "사업자 정보 수정" : "사업자 정보 등록"}
          </Button>
        </div>
      </div>

      {/* 회원 등급 — 일반회원 vs 사업자회원 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-800">회원 등급</h2>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {profileInfo?.isBusinessApproved ? (
            <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300 rounded">
              사업자회원 (인증 완료)
            </span>
          ) : (
            <span className="px-2.5 py-1 text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-300 rounded">
              일반회원
            </span>
          )}
          {profileInfo?.parent && (
            <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
              하위 회원 (상위: {profileInfo.parent.name || profileInfo.parent.email})
            </span>
          )}
        </div>

        {!profileInfo?.isBusinessApproved && (
          <div className="text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded p-3 space-y-1">
            <p className="font-medium text-amber-800">📌 사업자회원이 되면</p>
            <ul className="list-disc list-inside text-amber-700 space-y-0.5">
              <li>다른 회원의 상위·하위법인 검색에 <span className="font-semibold">우선 노출</span></li>
              <li>통계제출처 자동 라우팅 등 사업자 전용 기능 사용 가능</li>
            </ul>
            <p className="text-amber-700 mt-1">
              위 <span className="font-semibold">사업자 정보</span> 카드에서 상호명·사업자번호·사업자등록증을 등록하면 관리자 승인 후 사업자회원으로 전환됩니다.
            </p>
          </div>
        )}

        <div className="text-xs text-gray-600 bg-blue-50 border border-blue-200 rounded p-3 space-y-1">
          <p className="font-medium text-blue-700">상위 회원과 연결하려면?</p>
          <p>
            <Link href="/submission-routes" className="underline font-semibold text-blue-700 hover:text-blue-900">통계제출처 메뉴</Link>
            에서 상위 회원에게 이메일로 연결 요청을 보내거나, 거래처관리(의료기관) &gt; 제약사 필터링 탭에서 상위법인을 검색·선택하세요.
          </p>
        </div>
      </div>

      {/* 서류 관리 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-800">서류 관리</h2>
        </div>
        {profileInfo?.role === "BUSINESS" && !profileInfo.documents.some((d) => d.docType === "사업자등록증") && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3 rounded-lg">
            사업자등록증을 아직 업로드하지 않으셨어요. 아래 &quot;새 서류 첨부&quot; 에서 종류를 &quot;사업자등록증&quot; 으로 선택해 업로드해주세요.
          </div>
        )}
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
