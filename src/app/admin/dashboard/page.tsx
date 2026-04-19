"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AdminDashboardPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isSettlement, setIsSettlement] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; count?: number; error?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sessionStorage.getItem("isAdmin") !== "true") {
      router.push("/admin/login");
    }
  }, [router]);

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("isSettlement", String(isSettlement));

    try {
      const res = await fetch("/api/medications/upload", { method: "POST", body: formData });
      const data = await res.json();
      setResult(data);
      if (data.success) setFile(null);
    } catch {
      setResult({ error: "업로드 중 오류가 발생했어요." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-7 h-7 text-gray-800" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">관리자 대시보드</h1>
          <p className="text-gray-500 text-sm">요율표 업로드 및 데이터 관리</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-800">요율표 엑셀 업로드</h2>

        <div className="bg-gray-50 rounded p-3 text-xs text-gray-500 font-mono leading-relaxed">
          필요 컬럼: 분류(A) | 성분명 | 분류(B) | 코드(수수료율) | 제약사명 | 생동/생산 | 품목명 | 약가 | 오리지날/대조약 | 보험코드 | 특이사항
        </div>

        <div
          className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${file ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400"}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) { setFile(dropped); setResult(null); }
          }}
        >
          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-500">
            {file
              ? <span className="font-medium text-gray-800">{file.name}</span>
              : <>클릭하거나 <span className="text-blue-500">파일을 여기에 드래그</span>해서 업로드</>
            }
          </p>
          <p className="text-xs text-gray-400 mt-1">.xlsx, .xls 지원</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="settlement"
            checked={isSettlement}
            onChange={(e) => setIsSettlement(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300"
          />
          <label htmlFor="settlement" className="text-sm text-gray-700">
            정산 가능 제약사 요율표로 등록
          </label>
        </div>

        <Button
          onClick={handleUpload}
          disabled={!file || loading}
          className="w-full bg-gray-800 hover:bg-gray-700"
        >
          {loading ? "업로드 중..." : "업로드"}
        </Button>

        {result && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {result.success
              ? <><CheckCircle className="w-4 h-4 shrink-0" />{result.count?.toLocaleString()}개 품목이 등록됐어요!</>
              : <><AlertCircle className="w-4 h-4 shrink-0" />{result.error}</>
            }
          </div>
        )}
      </div>
    </div>
  );
}
