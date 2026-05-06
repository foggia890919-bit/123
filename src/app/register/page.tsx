"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle2, Loader2 } from "lucide-react";

const roles = [
  { value: "SALES_REP", label: "영업사원 (CSO)", docLabel: "CSO 신고증" },
  { value: "DOCTOR", label: "의사", docLabel: "의사 면허증" },
  { value: "PHARMACIST", label: "약사", docLabel: "약사 면허증" },
];

const carriers = ["SKT", "KT", "LG U+", "SKT 알뜰폰", "KT 알뜰폰", "LG 알뜰폰"];

export default function RegisterPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "SALES_REP", phone: "", carrier: "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // SMS 인증 상태
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // 전화번호 바뀌면 인증 초기화
    if (field === "phone") {
      setPhoneVerified(false);
      setOtpSent(false);
      setOtpCode("");
      setOtpError("");
    }
  }

  function formatPhone(value: string) {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
  }

  function isValidPhone(phone: string) {
    return /^010-\d{4}-\d{4}$/.test(phone);
  }

  async function sendOtp() {
    setOtpError("");
    if (!isValidPhone(form.phone)) {
      setOtpError("올바른 전화번호를 먼저 입력해주세요. (010-XXXX-XXXX)");
      return;
    }
    setOtpSending(true);
    try {
      const res = await fetch("/api/auth/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: form.phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(data.error || "발송 실패");
        return;
      }
      setOtpSent(true);
      setOtpCode("");
      // 60초 쿨다운
      setCooldown(60);
      const interval = setInterval(() => {
        setCooldown((v) => {
          if (v <= 1) { clearInterval(interval); return 0; }
          return v - 1;
        });
      }, 1000);
    } finally {
      setOtpSending(false);
    }
  }

  async function verifyOtp() {
    setOtpError("");
    if (!otpCode.trim()) { setOtpError("인증코드를 입력해주세요."); return; }
    setOtpVerifying(true);
    try {
      const res = await fetch("/api/auth/verify-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: form.phone, code: otpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOtpError(data.error || "인증 실패");
        return;
      }
      setPhoneVerified(true);
      setOtpError("");
    } finally {
      setOtpVerifying(false);
    }
  }

  const selectedRole = roles.find((r) => r.value === form.role);

  // 이미지 파일을 Canvas로 압축 (최대 1200px, JPEG 0.75 품질)
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
      img.onerror = () => resolve(dataUri); // 압축 실패 시 원본 사용
      img.src = dataUri;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!phoneVerified) { setError("휴대폰 본인인증을 완료해주세요."); return; }
    if (!file) { setError("첨부파일을 업로드해주세요."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("파일 크기는 10MB 이하여야 합니다."); return; }

    setLoading(true);
    setError("");

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onerror = () => {
      setError("파일을 읽을 수 없어요. 다시 시도해주세요.");
      setLoading(false);
    };
    reader.onload = async () => {
      try {
        let fileData = reader.result as string;
        // 이미지면 압축, PDF는 그대로
        if (file.type.startsWith("image/")) {
          fileData = await compressImage(fileData);
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        let res: Response;
        try {
          res = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...form,
              document: { fileName: file.name, fileData, docType: selectedRole?.docLabel },
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        let data: { error?: string } = {};
        try { data = await res.json(); } catch { /* non-JSON response */ }
        if (!res.ok) {
          setError(data.error || "회원가입에 실패했어요. 잠시 후 다시 시도해주세요.");
        } else {
          router.push("/login?registered=1");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("abort") || msg.includes("signal")) {
          setError("요청 시간이 초과됐어요. 잠시 후 다시 시도해주세요.");
        } else {
          setError("네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.");
        }
      } finally {
        setLoading(false);
      }
    };
  }

  return (
    <div className="max-w-lg mx-auto mt-10 mb-10">
      <div className="bg-white rounded-lg border border-gray-200 p-8 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">회원가입</h1>
          <p className="text-gray-500 text-sm mt-1">가입 후 관리자 승인이 필요해요.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">이름</label>
            <Input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="홍길동" required />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">이메일</label>
            <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="example@email.com" required />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">비밀번호</label>
            <Input type="password" value={form.password} onChange={(e) => update("password", e.target.value)} placeholder="8자 이상" minLength={8} required />
          </div>

          {/* 통신사 + 전화번호 + 인증 */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">통신사</label>
                <select
                  value={form.carrier}
                  onChange={(e) => update("carrier", e.target.value)}
                  required
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">선택</option>
                  {carriers.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">전화번호</label>
                <div className="flex gap-2">
                  <Input
                    value={form.phone}
                    onChange={(e) => update("phone", formatPhone(e.target.value))}
                    placeholder="010-0000-0000"
                    maxLength={13}
                    required
                    className={phoneVerified ? "border-green-400 bg-green-50" : ""}
                  />
                </div>
              </div>
            </div>

            {/* 인증코드 발송 버튼 + 상태 */}
            {phoneVerified ? (
              <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                휴대폰 인증 완료
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={sendOtp}
                  disabled={otpSending || cooldown > 0 || !isValidPhone(form.phone)}
                  className="w-full h-9 text-sm font-medium rounded-md border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {otpSending ? (
                    <span className="flex items-center justify-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />발송 중...</span>
                  ) : cooldown > 0 ? (
                    `재발송 대기 (${cooldown}초)`
                  ) : otpSent ? (
                    "인증코드 재발송"
                  ) : (
                    "인증코드 발송"
                  )}
                </button>

                {otpSent && (
                  <div className="flex gap-2">
                    <Input
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="인증코드 6자리"
                      maxLength={6}
                      className="text-center tracking-widest font-mono"
                    />
                    <button
                      type="button"
                      onClick={verifyOtp}
                      disabled={otpVerifying || otpCode.length !== 6}
                      className="shrink-0 px-4 h-10 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {otpVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : "확인"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {otpError && (
              <p className="text-xs text-red-600">{otpError}</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">직업</label>
            <select
              value={form.role}
              onChange={(e) => update("role", e.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">
              {selectedRole?.docLabel} <span className="text-red-500">*</span>
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${file ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}
            >
              <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
              <p className="text-sm text-gray-500">
                {file ? <span className="font-medium text-gray-800">{file.name}</span> : "클릭해서 파일 첨부"}
              </p>
              <p className="text-xs text-gray-400 mt-1">JPG, PNG, PDF 지원</p>
              <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
            ⚠️ 실제 사용하는 이메일로 가입해주세요. 등록한 이메일이 없으면 비밀번호 찾기 서비스를 이용할 수 없어요.
          </div>

          <Button type="submit" className="w-full" disabled={loading || !phoneVerified}>
            {loading ? "처리 중..." : "회원가입 신청"}
          </Button>
        </form>

        <p className="text-center text-sm text-gray-500">
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className="text-blue-600 hover:underline font-medium">로그인</Link>
        </p>
      </div>
    </div>
  );
}
