"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KeyRound, CheckCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setDone(false);
    setLoading(true);
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, phone }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error);
    else setDone(true);
    setLoading(false);
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="bg-white rounded-lg border border-gray-200 p-8 space-y-6">
        <div className="flex items-center gap-2">
          <KeyRound className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">비밀번호 찾기</h1>
            <p className="text-gray-500 text-sm mt-0.5">가입 시 등록한 휴대폰으로 임시 비밀번호를 SMS 발송해드려요</p>
          </div>
        </div>

        {!done ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">가입 이메일</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com" required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">가입한 휴대폰 번호</label>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="010-1234-5678" required />
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "처리 중..." : "임시 비밀번호 SMS 발송"}
            </Button>
          </form>
        ) : (
          <div className="flex items-start gap-2 text-green-700 bg-green-50 p-4 rounded-lg">
            <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">요청이 접수되었어요.</p>
              <p className="text-sm mt-1">등록된 정보가 일치하면 1-2분 내에 문자로 임시 비밀번호가 도착합니다. 로그인 후 반드시 비밀번호를 변경해주세요.</p>
            </div>
          </div>
        )}

        <p className="text-center text-sm text-gray-500">
          <Link href="/login" className="text-blue-600 hover:underline font-medium">로그인 페이지로 돌아가기</Link>
        </p>
      </div>
    </div>
  );
}
