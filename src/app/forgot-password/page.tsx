"use client";

import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KeyRound, CheckCircle, Mail, Smartphone } from "lucide-react";

type Method = "email" | "phone";

export default function ForgotPasswordPage() {
  const [method, setMethod] = useState<Method>("email");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setDone(false);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, [method]: value }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error);
      else setDone(true);
    } finally {
      setLoading(false);
    }
  }

  function switchMethod(m: Method) {
    setMethod(m);
    setValue("");
    setError("");
    setDone(false);
  }

  return (
    <div className="max-w-md mx-auto mt-16 px-4">
      <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-6 shadow-sm">
        <div className="flex items-center gap-3">
          <KeyRound className="w-6 h-6 text-blue-600 shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">비밀번호 찾기</h1>
            <p className="text-gray-500 text-sm mt-0.5">임시 비밀번호를 받을 방법을 선택하세요</p>
          </div>
        </div>

        {/* 방법 선택 탭 */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => switchMethod("email")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
              method === "email"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Mail className="w-4 h-4" />
            이메일로 받기
          </button>
          <button
            type="button"
            onClick={() => switchMethod("phone")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
              method === "phone"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Smartphone className="w-4 h-4" />
            문자(SMS)로 받기
          </button>
        </div>

        {!done ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {method === "email" ? (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">가입한 이메일 주소</label>
                <Input
                  type="email"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="example@email.com"
                  required
                  autoFocus
                />
                <p className="text-xs text-gray-400">가입 시 등록한 이메일 주소로 임시 비밀번호를 보내드려요</p>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">가입한 휴대폰 번호</label>
                <Input
                  type="tel"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="010-1234-5678"
                  required
                  autoFocus
                />
                <p className="text-xs text-gray-400">가입 시 등록한 휴대폰 번호로 문자를 발송해드려요</p>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "처리 중..." : method === "email" ? "이메일로 임시 비밀번호 받기" : "문자로 임시 비밀번호 받기"}
            </Button>
          </form>
        ) : (
          <div className="flex items-start gap-3 text-green-700 bg-green-50 p-4 rounded-lg">
            <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">요청이 접수되었어요.</p>
              <p className="text-sm mt-1 text-green-600">
                {method === "email"
                  ? "등록된 정보가 일치하면 1~2분 내에 이메일로 임시 비밀번호가 도착합니다."
                  : "등록된 정보가 일치하면 1~2분 내에 문자로 임시 비밀번호가 도착합니다."}
              </p>
              <p className="text-xs mt-2 text-green-500">로그인 후 반드시 비밀번호를 변경해주세요.</p>
            </div>
          </div>
        )}

        <p className="text-center text-sm text-gray-500">
          <Link href="/login" className="text-blue-600 hover:underline font-medium">
            로그인 페이지로 돌아가기
          </Link>
        </p>
      </div>
    </div>
  );
}
