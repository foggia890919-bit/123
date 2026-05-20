"use client";

import { useState, useRef, useMemo } from "react";
import { Upload, CheckCircle, AlertCircle, ExternalLink, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DrugRow {
  name: string;
  code: string;
  quantity: number;
  prescriptions: number;
  unitPrice: number;
  totalPrice: number;
  category: string;
  efficacy: string;
}

interface ExtractedData {
  pharma: string;
  period: string;
  periodRaw: string;
  hospital: string;
  summary: {
    drugCount: number;
    totalPrescriptions: number;
    totalQuantity: number;
    totalAmountWon: number;
  };
  drugs: DrugRow[];
}

interface ApiResponse {
  success?: boolean;
  data?: ExtractedData;
  sheet?: {
    url: string;
    summaryRange: string;
    drugsRange: string;
    batchId: string;
  } | null;
  sheetError?: string;
  error?: string;
  debug?: { durationMs?: number; model?: string };
}

// "만성질환 / 고혈압" vs "만성질환/고혈압" 같은 띄어쓰기 차이만 합치는 약한 정규화.
// "만성질환/고혈압" vs "만성질환/고지혈증" 같은 다른 카테고리는 분리 유지.
function normalizeCategory(c: string): string {
  const trimmed = (c || "").trim();
  if (!trimmed) return "기타";
  return trimmed.replace(/\s*\/\s*/g, "/");
}

export default function RxStatsExtractPage() {
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
      const res = await fetch("/api/rx-stats/extract", { method: "POST", body: fd });
      const data = (await res.json()) as ApiResponse;
      setResult(data);
    } catch (e) {
      setResult({ error: `네트워크 오류: ${String(e)}` });
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => {
    const data = result?.data;
    if (!data) return new Map<string, DrugRow[]>();
    const map = new Map<string, DrugRow[]>();
    for (const d of data.drugs) {
      const key = normalizeCategory(d.category);
      const arr = map.get(key) ?? [];
      arr.push(d);
      map.set(key, arr);
    }
    return map;
  }, [result]);

  const success = result?.success === true && result.data;
  const hasError = result?.success === false || (!result?.success && result?.error);
  const countMismatch =
    success &&
    result.data!.summary.drugCount > 0 &&
    result.data!.summary.drugCount !== result.data!.drugs.length;

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">처방 통계 표 분석</h1>
        <p className="text-gray-500 mt-1 text-sm">
          영업사원이 보내준 EMR 처방통계 화면 사진을 업로드하면 Gemini 멀티모달이 표를
          통째로 읽어 약품별 데이터 + 자동 카테고리 분류 + 효능 요약까지 정리합니다.
          OCR 사전 처리 없음 — 비스듬한 사진/모니터 반사에도 강건.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <label
          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-md py-10 cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="w-8 h-8 text-gray-400" />
          <span className="text-sm text-gray-600">
            {file ? file.name : "처방통계 사진을 클릭해서 선택하세요"}
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
          {loading ? "분석 중... (gemini-3.5-flash, 보통 3~10s)" : "분석 + 시트 기록"}
        </Button>
      </div>

      {success && result.data && (
        <div className="space-y-4">
          {/* 메타 + 디버그 */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center gap-2 text-green-800">
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">분석 완료</span>
              <span className="text-xs text-green-700 ml-auto flex items-center gap-2">
                {result.debug?.model && (
                  <span className="text-[10px] text-green-600">{result.debug.model}</span>
                )}
                {result.debug?.durationMs && (
                  <span>{(result.debug.durationMs / 1000).toFixed(1)}s</span>
                )}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-gray-500">제약사</div>
                <div className="font-medium">{result.data.pharma || "(미상)"}</div>
              </div>
              <div>
                <div className="text-gray-500">기간</div>
                <div className="font-medium">
                  {result.data.period || result.data.periodRaw || "(미상)"}
                </div>
                {result.data.period && result.data.periodRaw && result.data.period !== result.data.periodRaw && (
                  <div className="text-[10px] text-gray-400">원본: {result.data.periodRaw}</div>
                )}
              </div>
              <div>
                <div className="text-gray-500">병원</div>
                <div className="font-medium">{result.data.hospital || "(미상)"}</div>
              </div>
            </div>
          </div>

          {/* drugCount vs drugs.length 불일치 경고 */}
          {countMismatch && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-2 text-amber-800">
                <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <div className="font-semibold">부분 추출 감지</div>
                  <div className="text-amber-700 mt-1">
                    사진의 약품수 ({result.data.summary.drugCount}건) 와 추출된 행 수 (
                    {result.data.drugs.length}건) 가 다릅니다. 일부 행이 누락됐을 수 있어요 — 시트에
                    저장된 데이터를 검수하거나 더 선명한 사진으로 재시도하세요.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 합계 4박스 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBox label="약품수" value={result.data.summary.drugCount.toString()} unit="건" />
            <StatBox label="처방횟수" value={result.data.summary.totalPrescriptions.toLocaleString()} unit="회" />
            <StatBox label="총사용량" value={result.data.summary.totalQuantity.toLocaleString()} unit="" />
            <StatBox label="총금액" value={result.data.summary.totalAmountWon.toLocaleString()} unit="원" />
          </div>

          {/* 카테고리별 약품 표 */}
          {Array.from(grouped.entries()).map(([cat, rows]) => (
            <section key={cat} className="bg-white border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b">
                <h3 className="text-sm font-semibold text-gray-700">
                  {cat} <span className="text-xs font-normal text-gray-500">({rows.length}개)</span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="text-left px-3 py-2">약품명</th>
                      <th className="text-left px-3 py-2">보험코드</th>
                      <th className="text-right px-3 py-2">사용량</th>
                      <th className="text-right px-3 py-2">처방횟수</th>
                      <th className="text-right px-3 py-2">단가</th>
                      <th className="text-right px-3 py-2">총금액</th>
                      <th className="text-left px-3 py-2">효능</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d, i) => (
                      <tr key={i} className="border-t hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{d.name}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono text-[11px]">{d.code || "-"}</td>
                        <td className="px-3 py-2 text-right">{d.quantity.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{d.prescriptions.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-gray-500">
                          {d.unitPrice ? d.unitPrice.toLocaleString() : "-"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {d.totalPrice ? d.totalPrice.toLocaleString() : "-"}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{d.efficacy || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {/* 시트 링크 + 디스클레이머 */}
          {result.sheet?.url && (
            <div className="bg-white border rounded-lg p-4 space-y-2">
              <a
                href={result.sheet.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
              >
                구글 시트에서 보기 <ExternalLink className="w-3 h-3" />
              </a>
              <div className="text-[11px] text-gray-400">
                batchId: <code>{result.sheet.batchId}</code> · 이 ID 로 "약품" 탭에서 한 업로드의
                모든 행을 묶어서 필터링할 수 있습니다.
              </div>
              <div className="text-[11px] text-gray-400">
                ⚠ 효능 설명은 AI 자동 추론입니다. 의료 의사결정 용도가 아니라 영업 데이터
                정리 보조용입니다.
              </div>
            </div>
          )}
          {result.sheetError && (
            <p className="text-xs text-orange-600">⚠ 시트 저장 실패: {result.sheetError}</p>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-white border rounded-lg px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold mt-0.5">
        {value} <span className="text-xs font-normal text-gray-400">{unit}</span>
      </div>
    </div>
  );
}
