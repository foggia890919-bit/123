"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { User, KeyRound, CheckCircle, ArrowUpCircle } from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS, type UserRole } from "@/lib/roles";

const KAKAO_URL = "https://open.kakao.com/me/ykmedi";

export default function MyPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  if (status === "loading") return <div className="py-20 text-center text-gray-400">불러오는 중...</div>;
  if (!session) { router.push("/login"); return null; }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSuccess(false);
    if (newPw !== confirmPw) { setError("새 비밀번호가 일치하지 않아요."); return; }
    if (newPw.length < 8) { setError("비밀번호는 8자 이상이어야 해요."); return; }

    setLoading(true);
    const res = await fetch("/api/mypage", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: session!.user.id, currentPassword: currentPw, newPassword: newPw }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); }
    else { setSuccess(true); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }
    setLoading(false);
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

        {/* 등급 안내 */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">현재 이용 등급</p>
              <p className="text-sm font-semibold text-gray-800">
                {ROLE_LABELS[session.user.role as UserRole] ?? session.user.role}
              </p>
            </div>
            <a
              href={KAKAO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-medium bg-[#FEE500] hover:bg-[#FFCF00] text-[#3C1E1E] px-3 py-2 rounded-lg transition-colors"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
              등급 변경 문의
            </a>
          </div>
        </div>
      </div>

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

          {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}
          {success && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-3 rounded-lg">
              <CheckCircle className="w-4 h-4" /> 비밀번호가 변경됐어요!
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "변경 중..." : "비밀번호 변경"}
          </Button>
        </form>
      </div>
    </div>
  );
}
