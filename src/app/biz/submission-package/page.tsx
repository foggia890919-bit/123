"use client";

import { useState } from "react";
import { Download, Package, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import RequireRole from "@/components/RequireRole";

export default function SubmissionPackagePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [entityFilter, setEntityFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<{
    entityCount: number; unmappedCount: number; noDrugsCount: number;
    imageFailureCount: number; imageWriteCount: number; filename: string;
  } | null>(null);

  async function downloadPackage() {
    setBusy(true);
    setError("");
    setLastResult(null);
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      if (entityFilter.trim()) params.set("entity", entityFilter.trim());
      const res = await fetch(`/api/biz/submission-package?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `오류 (${res.status})`);
      }
      const num = (k: string) => parseInt(res.headers.get(k) || "0", 10);
      const entityCount = num("X-Entity-Count");
      const unmappedCount = num("X-Unmapped-Count");
      const noDrugsCount = num("X-No-Drugs-Count");
      const imageFailureCount = num("X-Image-Failure-Count");
      const imageWriteCount = num("X-Image-Write-Count");
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
      const filename = m ? decodeURIComponent(m[1].replace(/"/g, "")) : `${year}${String(month).padStart(2, "0")}_제출패키지.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setLastResult({ entityCount, unmappedCount, noDrugsCount, imageFailureCount, imageWriteCount, filename });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RequireRole minRole="BIZ">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <header>
          <h1 className="text-xl font-bold text-gray-900">제출 패키지 다운로드</h1>
          <p className="text-sm text-gray-500 mt-1">
            월별 제출된 처방통계를 (제출처 → 제약사) 별로 분리해서 ZIP 으로 받습니다. 한 사진에 여러 제약사가 들어있으면 제약사별로 사본이 만들어집니다.
          </p>
        </header>

        <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">처방년도</label>
              <input type="number" min={2020} max={2100} value={year}
                     onChange={(e) => setYear(parseInt(e.target.value || "0", 10) || year)}
                     className="h-9 w-24 text-sm border border-gray-300 rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">처방월</label>
              <select value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                      className="h-9 text-sm border border-gray-300 rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-blue-400">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-48">
              <label className="text-xs font-medium text-gray-600 mb-1 block">제출처 필터 (선택)</label>
              <input value={entityFilter}
                     onChange={(e) => setEntityFilter(e.target.value)}
                     placeholder="예: 메디펄스 (비우면 전체)"
                     className="h-9 w-full text-sm border border-gray-300 rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <Button onClick={downloadPackage} disabled={busy}
                    className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5">
              {busy ? "생성 중..." : (<><Download className="w-4 h-4" />패키지 다운로드</>)}
            </Button>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {lastResult && !error && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">
                <Package className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{lastResult.filename} 다운로드 완료</p>
                  <p className="text-xs text-green-600 mt-0.5">
                    제출처 {lastResult.entityCount}곳 · 이미지 사본 {lastResult.imageWriteCount}건
                  </p>
                </div>
              </div>
              {(lastResult.unmappedCount > 0 || lastResult.noDrugsCount > 0 || lastResult.imageFailureCount > 0) && (
                <div className="text-xs bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-md p-3 space-y-1">
                  <p className="font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> 패키지 안의 <code>_요약.txt</code> 를 꼭 확인해주세요
                  </p>
                  {lastResult.unmappedCount > 0 && (
                    <p>· 제출처 미매핑 (제약사×거래처): <b>{lastResult.unmappedCount}건</b> — 통계 제출처 관리 메뉴에서 등록 필요</p>
                  )}
                  {lastResult.noDrugsCount > 0 && (
                    <p>· OCR 미완료 report: <b>{lastResult.noDrugsCount}건</b> — 처방통계 등록에서 다시 인식 필요</p>
                  )}
                  {lastResult.imageFailureCount > 0 && (
                    <p>· 이미지 fetch 실패: <b>{lastResult.imageFailureCount}건</b> — Storage 누락 또는 권한 확인</p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-xs text-gray-600 space-y-2">
          <p className="font-semibold text-gray-700 text-sm">패키지 구성</p>
          <pre className="bg-white border border-gray-200 rounded-md p-3 text-[11px] font-mono overflow-x-auto">
{`{YYYYMM}_제출패키지/
├── {제출처1}/
│   ├── {제약사A}_{YYYYMM}.xlsx     ← 시트1 겉표지(사업자번호/병원명/총금액)
│   │                                ← 시트2 세부내역(병원명/보험코드/제품명/수량/단가/처방금액)
│   └── {제약사A}_이미지/
│       └── {병원명}_{제약사A}_{YYYYMM}.jpg
├── {제출처2}/
│   └── ...
└── _미매핑.txt                     ← SubmissionRoute 미등록 (제약사,거래처) 목록`}
          </pre>
          <p>
            제출처 매핑은 <a href="/biz/submission-routes" className="text-blue-600 hover:underline">통계 제출처 관리</a> 메뉴에서 (거래처 × 제약사 → 제출처) 형태로 등록합니다.
          </p>
        </section>
      </div>
    </RequireRole>
  );
}
