"use client";

import { useState, useRef } from "react";
import { Upload, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExtractedData {
  hospitalName: string;
  salesDate: string;
  totalAmount: number;
  salesRep: string;
}

interface ApiResponse {
  success?: boolean;
  data?: ExtractedData;
  sheet?: { url: string; range: string } | null;
  sheetError?: string;
  error?: string;
  debug?: { durationMs?: number; model?: string };
}

export default function SalesExtractPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pickFile(f: File | null) {
    setFile(f);
    setResult(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  async function handleSubmit() {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/sales/extract", { method: "POST", body: fd });
      const data = (await res.json()) as ApiResponse;
      setResult(data);
    } catch (e) {
      setResult({ error: `네트워크 오류: ${String(e)}` });
    } finally {
      setLoading(false);
    }
  }

  const success = result?.success === true && result.data;
  const hasError = result?.success === false || (!result?.success && result?.error);

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">병원 실적 이미지 추출</h1>
        <p className="text-gray-500 mt-1 text-sm">
          카카오톡으로 받은 실적 사진을 업로드하면 Gemini AI 가 자동으로 병원명·날짜·금액·담당자를
          추출하고 구글 시트에 기록합니다.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <label
          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-md py-10 cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="w-8 h-8 text-gray-400" />
          <span className="text-sm text-gray-600">
            {file ? file.name : "사진을 클릭해서 선택하거나 드래그하세요"}
          </span>
          {file && (
            <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {previewUrl && (
          <div className="border rounded-md overflow-hidden bg-gray-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="preview" className="max-h-72 mx-auto" />
          </div>
        )}

        <Button onClick={handleSubmit} disabled={!file || loading} className="w-full">
          {loading ? "분석 중..." : "추출 + 시트 기록"}
        </Button>
      </div>

      {success && result.data && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 space-y-3">
          <div className="flex items-center gap-2 text-green-800">
            <CheckCircle className="w-5 h-5" />
            <span className="font-semibold">추출 완료</span>
            {result.debug?.durationMs && (
              <span className="text-xs text-green-700 ml-auto">
                {(result.debug.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <div className="text-gray-500">병원명</div>
            <div className="font-medium">{result.data.hospitalName || "(미상)"}</div>
            <div className="text-gray-500">실적일</div>
            <div className="font-medium">{result.data.salesDate || "(미상)"}</div>
            <div className="text-gray-500">금액</div>
            <div className="font-medium">{result.data.totalAmount.toLocaleString()}원</div>
            <div className="text-gray-500">영업사원</div>
            <div className="font-medium">{result.data.salesRep || "(없음)"}</div>
          </div>
          {result.sheet?.url && (
            <a
              href={result.sheet.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
            >
              구글 시트에서 보기 <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {result.sheetError && (
            <p className="text-xs text-orange-600">
              ⚠ 시트 저장 실패: {result.sheetError}
            </p>
          )}
        </div>
      )}

      {hasError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-2 text-red-800">
            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <div className="font-semibold">오류</div>
              <div className="text-red-700 mt-1">{result?.error}</div>
              {result?.data && (
                <pre className="mt-2 text-xs bg-red-100 rounded p-2 overflow-x-auto">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
