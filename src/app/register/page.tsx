"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const roles = [
  { value: "SALES_REP", label: "영업사원" },
  { value: "DOCTOR", label: "의사" },
  { value: "PHARMACIST", label: "약사" },
];

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "SALES_REP" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "회원가입에 실패했어요.");
    } else {
      router.push("/login");
    }
    setLoading(false);
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="bg-white rounded-lg border border-gray-200 p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">회원가입</h1>
          <p className="text-gray-500 text-sm mt-1">MedAlt 계정을 만드세요</p>
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
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">직업</label>
            <select
              value={form.role}
              onChange={(e) => update("role", e.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {roles.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "처리 중..." : "회원가입"}
          </Button>
        </form>

        <p className="text-center text-sm text-gray-500">
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className="text-blue-600 hover:underline font-medium">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
