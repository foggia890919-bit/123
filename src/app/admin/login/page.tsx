"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password === "admin1234") {
      sessionStorage.setItem("isAdmin", "true");
      router.push("/admin/dashboard");
    } else {
      setError("비밀번호가 올바르지 않아요.");
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-24">
      <div className="bg-white rounded-lg border border-gray-200 p-8 space-y-6">
        <div className="flex flex-col items-center gap-2">
          <ShieldCheck className="w-10 h-10 text-gray-800" />
          <h1 className="text-xl font-bold text-gray-900">관리자 로그인</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">관리자 비밀번호</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 입력"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full bg-gray-800 hover:bg-gray-700">
            로그인
          </Button>
        </form>
      </div>
    </div>
  );
}
