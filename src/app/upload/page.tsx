"use client";

import { useState, useRef } from "react";
import { Upload, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isSettlement, setIsSettlement] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; count?: number; error?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    } catch {
      setResult({ error: "업로드 중 오류가 발생했어요." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">요율표 엑셀 업로드</h1>
        <p className="text-gray-500 mt-1">보유한 요율표 엑셀 파일을 업로드해서 의약품 데이터를 등록하세요.</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <p className="text-sm font-medium text-gray-700 mb-1">엑셀 컬럼 형식 안내</p>
          <div className="bg-gray-50 rounded p-3 text-xs text-gray-500 font-mono">
            분류(A) | 성분명 | 분류(B) | 코드(수수료율) | 제약사명 | 생동/생산 | 품목명 | 약가 | 오리지날/대조약 | 보험코드 | 특이사항
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">파일 선택</label>
          <div
            className="mt-1 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              {file ? file.name : "클릭하거나 파일을 드래그해서 업로드"}
            </p>
            <p className="text-xs text-gray-400 mt-1">.xlsx, .xls 파일 지원</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="settlement"
            checked={isSettlement}
            onChange={(e) => setIsSettlement(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600"
          />
          <label htmlFor="settlement" className="text-sm text-gray-700">
            정산 가능 제약사 요율표
          </label>
        </div>

        <Button onClick={handleUpload} disabled={!file || loading} className="w-full">
          {loading ? "업로드 중..." : "업로드"}
        </Button>

        {result && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {result.success ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {result.success ? `${result.count?.toLocaleString()}개 품목이 등록됐어요.` : result.error}
          </div>
        )}
      </div>
    </div>
  );
}
