"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
// next-auth/react signIn for client-side
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", { email, password, redirect: false });

    if (result?.error === "PENDING") {
      setError("관리자 승인 대기 중이에요. 승인 후 로그인할 수 있어요.");
    } else if (result?.error) {
      setError("이메일 또는 비밀번호가 올바르지 않아요.");
    } else {
      router.push("/");
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="bg-white rounded-lg border border-gray-200 p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">로그인</h1>
          <p className="text-gray-500 text-sm mt-1">MedAlt에 로그인하세요</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">이메일</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@email.com" required />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">비밀번호</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>

          {error && (
            <div className={`text-sm p-3 rounded-lg ${error.includes("대기") ? "bg-yellow-50 text-yellow-700" : "text-red-600"}`}>
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </Button>
        </form>

        <div className="space-y-2 text-center text-sm text-gray-500">
          <p>
            계정이 없으신가요?{" "}
            <Link href="/register" className="text-blue-600 hover:underline font-medium">회원가입</Link>
          </p>
          <p>
            <Link href="/forgot-password" className="text-gray-400 hover:underline">비밀번호를 잊으셨나요?</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
