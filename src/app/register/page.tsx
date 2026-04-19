"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

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

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const selectedRole = roles.find((r) => r.value === form.role);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError("첨부파일을 업로드해주세요."); return; }
    if (!form.phone) { setError("전화번호를 입력해주세요."); return; }

    setLoading(true);
    setError("");

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const fileData = reader.result as string;
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          document: { fileName: file.name, fileData, docType: selectedRole?.docLabel },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "회원가입에 실패했어요.");
      } else {
        router.push("/login?registered=1");
      }
      setLoading(false);
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
              <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="010-0000-0000" required />
            </div>
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

          <Button type="submit" className="w-full" disabled={loading}>
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
