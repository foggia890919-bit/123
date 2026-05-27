"use client";

import React, { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { OcrResult } from "./types";
import { VENDOR_LABEL_KO, CAPTURE_LABEL_KO } from "./types";
import { confColor } from "./constants";

interface OcrMatchPanelProps {
  editOcr: OcrResult | null;
  ocrLoading: boolean;
}

export default function OcrMatchPanel({ editOcr, ocrLoading }: OcrMatchPanelProps) {
  const [middleTab, setMiddleTab] = useState<"ai" | "raw">("ai");

  return (
    <div className="hidden bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col max-h-[80vh]">
      <div className="border-b border-gray-100 px-3 h-[44px] flex items-center gap-2 overflow-x-auto">
        <span className="text-xs font-semibold text-gray-700">① 사진매칭</span>
        <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded">CLOVA + GEMINI</span>
        {editOcr ? (
          <>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${confColor(editOcr.avgConfidence)}`}>
              예상 정확도 <strong>{editOcr.avgConfidence}%</strong>
            </span>
            {editOcr.manualCheckCount > 0 && (
              <span className="text-xs bg-red-100 text-red-700 border border-red-300 px-1.5 py-0.5 rounded font-semibold">
                검토 {editOcr.manualCheckCount}건
              </span>
            )}
            {editOcr.pipeline && (
              <span
                className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded font-mono cursor-help"
                title={[
                  `EMR: ${VENDOR_LABEL_KO[editOcr.pipeline.vendor] ?? editOcr.pipeline.vendor} (${editOcr.pipeline.vendorConfidence}%)${editOcr.pipeline.vendor === "unknown" ? " — 분류 실패" : ""} / 캡처: ${CAPTURE_LABEL_KO[editOcr.pipeline.captureType]}${editOcr.pipeline.cacheHit ? " / 캐시 적용" : " / 캐시 미적용"}`,
                  `Clova: ${editOcr.pipeline.clovaOk ? "OK" : "FAIL"} (${editOcr.pipeline.clovaChars}자)${editOcr.pipeline.clovaError ? " — " + editOcr.pipeline.clovaError : ""}`,
                  `Gemini Vision: ${editOcr.pipeline.visionOk ? "OK" : "FAIL"} (${editOcr.pipeline.visionDrugCount}건)${editOcr.pipeline.visionError ? " — " + editOcr.pipeline.visionError : ""}`,
                  editOcr.pipeline.docaiConfigured
                    ? `Document AI: ${editOcr.pipeline.docaiOk ? "OK" : "FAIL"} (표 ${editOcr.pipeline.docaiTableCount ?? 0}개, ${editOcr.pipeline.docaiTotalRowCount ?? 0}행, ${editOcr.pipeline.docaiTextChars ?? 0}자)${editOcr.pipeline.docaiError ? " — " + editOcr.pipeline.docaiError : ""}`
                    : `Document AI: 미설정`,
                  `컬럼 카운트: 보험코드 ${editOcr.pipeline.columnCounts?.insuranceCode9digit ?? 0} / Vision ${editOcr.pipeline.columnCounts?.visionRows ?? 0} / Positional ${editOcr.pipeline.columnCounts?.positionalRows ?? 0}${editOcr.pipeline.columnCounts?.mismatch ? " ⚠ 불일치" : ""}`,
                  `병합 LLM: ${editOcr.pipeline.mergeUsed} → ${editOcr.pipeline.mergeDrugCount}건${editOcr.pipeline.mergeError ? " — " + editOcr.pipeline.mergeError : ""}`,
                  `isLikelyDrug 필터: -${editOcr.pipeline.filteredByIsLikelyDrug}건`,
                  `마스터 매칭: 성공 ${editOcr.pipeline.masterMatchedCount} / 실패 ${editOcr.pipeline.masterUnmatchedCount}${(editOcr.pipeline.nameCodeMismatchCount ?? 0) > 0 ? ` / 코드↔이름 불일치 ${editOcr.pipeline.nameCodeMismatchCount}` : ""}`,
                  `중복 제거: -${editOcr.pipeline.dedupedCount}건`,
                  `최종: ${editOcr.pipeline.finalCount}건`,
                ].join("\n")}>
                진단
              </span>
            )}
          </>
        ) : (
          <span className="text-xs text-gray-400">대기 중</span>
        )}
        {editOcr && (
          <button onClick={() => setMiddleTab(middleTab === "ai" ? "raw" : "ai")}
            className="ml-auto text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600">
            {middleTab === "ai" ? "원본 텍스트" : "표 보기"}
          </button>
        )}
      </div>

      {editOcr && middleTab === "raw" ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {editOcr.pipeline && (
            <div>
              <p className="text-[10px] font-semibold text-gray-500 mb-1">파이프라인 진단</p>
              {/* 0단계: 벤더 분류 결과 */}
              <div className={`text-[11px] border rounded p-2 font-mono space-y-0.5 mb-2 ${
                editOcr.pipeline.vendorConfidence >= 70 && editOcr.pipeline.vendor !== "unknown"
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-amber-50 border-amber-300"
              }`}>
                <div>
                  EMR: <span className="font-semibold">{VENDOR_LABEL_KO[editOcr.pipeline.vendor] ?? editOcr.pipeline.vendor}</span>
                  {" "}<span className="text-gray-500">({editOcr.pipeline.vendorConfidence}%)</span>
                  {editOcr.pipeline.vendor === "unknown" && <span className="text-amber-700"> — 분류 실패, 캐시·전처리 분기 미적용</span>}
                </div>
                <div>캡처 종류: {CAPTURE_LABEL_KO[editOcr.pipeline.captureType]}</div>
                {editOcr.pipeline.vendorRationale && (
                  <div className="text-gray-600 italic text-[10px]">근거: {editOcr.pipeline.vendorRationale}</div>
                )}
                <div>
                  캐시 템플릿: {editOcr.pipeline.cacheHit
                    ? <span className="text-emerald-700">✓ 적용 (이전 학습 컬럼 위치 재사용)</span>
                    : <span className="text-gray-500">✗ {editOcr.pipeline.cacheRejectReason ?? "사유 미상"}</span>}
                  {editOcr.pipeline.cachedTemplateVendor && editOcr.pipeline.cachedTemplateVendor !== editOcr.pipeline.vendor && (
                    <span className="text-amber-700"> (저장된 vendor: {VENDOR_LABEL_KO[editOcr.pipeline.cachedTemplateVendor] ?? editOcr.pipeline.cachedTemplateVendor})</span>
                  )}
                </div>
                {editOcr.pipeline.vendorError && (
                  <div className="text-red-700 text-[10px]">분류기 오류: {editOcr.pipeline.vendorError}</div>
                )}
              </div>
              <div className="text-[11px] bg-purple-50 border border-purple-200 rounded p-2 font-mono space-y-0.5">
                <div>Clova OCR: {editOcr.pipeline.clovaOk ? "✓" : "✗"} ({editOcr.pipeline.clovaChars}자){editOcr.pipeline.clovaError ? ` — ${editOcr.pipeline.clovaError}` : ""}</div>
                <div>Gemini Vision: {editOcr.pipeline.visionOk ? "✓" : "✗"} ({editOcr.pipeline.visionDrugCount}건){editOcr.pipeline.visionError ? ` — ${editOcr.pipeline.visionError}` : ""}</div>
                <div>
                  Document AI: {editOcr.pipeline.docaiConfigured
                    ? <>{editOcr.pipeline.docaiOk ? "✓" : "✗"} 표 {editOcr.pipeline.docaiTableCount ?? 0}개 · {editOcr.pipeline.docaiTotalRowCount ?? 0}행 · {editOcr.pipeline.docaiTextChars ?? 0}자{editOcr.pipeline.docaiError ? ` — ${editOcr.pipeline.docaiError}` : ""}</>
                    : <span className="text-gray-400">환경변수 미설정 (GCP_PROJECT_ID, GCP_DOCAI_PROCESSOR_ID, GCP_SA_JSON)</span>}
                </div>
                {editOcr.pipeline.docaiSampleTable && editOcr.pipeline.docaiSampleTable.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-purple-700 hover:text-purple-900 text-[10px]">Document AI 표 미리보기 (첫 표 처음 10행)</summary>
                    <div className="mt-1 max-h-48 overflow-auto bg-white border border-purple-100 rounded p-1">
                      <table className="text-[10px]">
                        <tbody>
                          {editOcr.pipeline.docaiSampleTable.map((row, i) => (
                            <tr key={i}>
                              {row.map((cell, j) => (
                                <td key={j} className="border border-gray-100 px-1 py-0.5">{cell || "—"}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                {editOcr.pipeline.columnCounts && (
                  <div className={editOcr.pipeline.columnCounts.mismatch ? "text-red-700 font-semibold" : ""}>
                    컬럼 카운트: 보험코드 9자리 {editOcr.pipeline.columnCounts.insuranceCode9digit}
                    {" / "}Vision 행 {editOcr.pipeline.columnCounts.visionRows}
                    {" / "}Positional 행 {editOcr.pipeline.columnCounts.positionalRows}
                    {editOcr.pipeline.columnCounts.mismatch && <span> ⚠ 컬럼별 N 불일치 — 어느 엔진이 누락/환각했을 가능성</span>}
                  </div>
                )}
                <div>병합 LLM: {editOcr.pipeline.mergeUsed} → {editOcr.pipeline.mergeDrugCount}건{editOcr.pipeline.mergeError ? ` — ${editOcr.pipeline.mergeError}` : ""}</div>
                <div>isLikelyDrug 필터: -{editOcr.pipeline.filteredByIsLikelyDrug}건</div>
                <div>
                  마스터 매칭: 성공 {editOcr.pipeline.masterMatchedCount} / 실패 {editOcr.pipeline.masterUnmatchedCount}
                  {(editOcr.pipeline.nameCodeMismatchCount ?? 0) > 0 && (
                    <span className="text-red-700 font-semibold"> / 코드↔이름 불일치 {editOcr.pipeline.nameCodeMismatchCount}</span>
                  )}
                </div>
                <div>중복 제거: -{editOcr.pipeline.dedupedCount}건</div>
                <div className="font-bold pt-1">최종: {editOcr.pipeline.finalCount}건</div>
              </div>
              {editOcr.pipeline.drugCandidates && editOcr.pipeline.drugCandidates.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold text-gray-500 mb-1">
                    Clova 약품명 후보 ({editOcr.pipeline.drugCandidates.length}건 — 그 중 {editOcr.pipeline.drugCandidates.filter((c) => c.accepted).length}건 채택)
                  </p>
                  <div className="text-[11px] bg-orange-50 border border-orange-200 rounded p-2 font-mono space-y-0.5 max-h-64 overflow-y-auto">
                    {editOcr.pipeline.drugCandidates
                      .slice()
                      .sort((a, b) => a.yPercent - b.yPercent)
                      .map((c, i) => (
                        <div key={i} className={c.accepted ? "text-green-700" : "text-red-700"}>
                          {c.accepted ? "✓" : "✗"} Y{c.yPercent.toFixed(1)}% &quot;{c.text}&quot;
                          {c.droppedReason && <span className="text-gray-500"> — {c.droppedReason}</span>}
                          {c.accepted && (c.quantity || c.insuranceCode || c.slope != null) && (
                            <div className="ml-4 text-[10px] text-gray-600">
                              {c.insuranceCode && <span>code={c.insuranceCode} </span>}
                              {c.quantity != null && <span>qty={c.quantity || "—"} </span>}
                              {c.quantityY != null && <span>qtyY={c.quantityY} </span>}
                              {c.slope != null && <span>slope={c.slope.toFixed(4)}</span>}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}
              {editOcr.pipeline.masterUnmatchedSamples && editOcr.pipeline.masterUnmatchedSamples.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold text-gray-500 mb-1">
                    마스터 매칭 실패 샘플 ({editOcr.pipeline.masterUnmatchedCount}건 중 처음 {editOcr.pipeline.masterUnmatchedSamples.length}건)
                  </p>
                  <div className="text-[11px] bg-red-50 border border-red-200 rounded p-2 font-mono space-y-0.5">
                    {editOcr.pipeline.masterUnmatchedSamples.map((s, i) => (
                      <div key={i}>
                        &quot;{s.productName}&quot;
                        {s.unitPriceHint != null && <span className="text-gray-500"> (단가 {s.unitPriceHint})</span>}
                      </div>
                    ))}
                    <div className="pt-1 text-gray-500 text-[10px]">
                      ⚠️ 이 약품들이 마스터 DB에 없으면 = DB 누락 (sync 필요).
                      마스터에 있는데 못 찾으면 = 매칭 로직 버그.
                    </div>
                  </div>
                </div>
              )}
              {(() => {
                const mismatched = editOcr.drugs.filter((d) => d.mismatch);
                if (mismatched.length === 0) return null;
                return (
                  <div className="mt-2">
                    <p className="text-[10px] font-semibold text-gray-500 mb-1">
                      보험코드 ↔ 마스터 제품명 불일치 ({mismatched.length}건)
                    </p>
                    <div className="text-[11px] bg-red-50 border border-red-300 rounded p-2 font-mono space-y-0.5">
                      {mismatched.map((d, i) => (
                        <div key={i} className="text-red-700">
                          ✗ {d.insuranceCode.value || "—"}{" "}
                          <span className="text-gray-700">OCR &quot;{d.mismatch!.ocrProductName}&quot; ↔ 마스터 &quot;{d.mismatch!.masterProductName}&quot;</span>
                        </div>
                      ))}
                      <div className="pt-1 text-gray-500 text-[10px]">
                        ⚠️ 보험코드는 마스터에 있는데 OCR 제품명이 명백히 다른 행. Vision 이 보험코드 한 자리를 잘못 읽었거나 제품명을 환각으로 만들어낸 신호. 해당 행은 빨간 배지로 자동 검수 표시됩니다.
                      </div>
                    </div>
                  </div>
                );
              })()}
              {editOcr.pipeline.crossValidation && editOcr.pipeline.crossValidation.length > 0 && (() => {
                const mismatches = editOcr.pipeline.crossValidation!.filter((c) => !c.match);
                const matches = editOcr.pipeline.crossValidation!.filter((c) => c.match);
                return (
                  <div className="mt-2">
                    <p className="text-[10px] font-semibold text-gray-500 mb-1">
                      Vision · Positional 교차 검증 (총 {editOcr.pipeline.crossValidation!.length}건 — 일치 {matches.length} / 불일치 <span className={mismatches.length > 0 ? "text-red-700 font-bold" : ""}>{mismatches.length}</span>)
                    </p>
                    {mismatches.length > 0 && (
                      <div className="text-[11px] bg-red-50 border border-red-300 rounded p-2 font-mono space-y-0.5 mb-1">
                        {mismatches.map((c, i) => (
                          <div key={i} className="text-red-700">
                            ✗ {c.insuranceCode} &quot;{c.productName}&quot;
                            <span className="text-gray-700"> — Positional [{c.positionalQuantity}] vs Vision [{c.visionQuantity}]</span>
                          </div>
                        ))}
                        <div className="pt-1 text-gray-500 text-[10px]">
                          ⚠️ 두 추출 결과가 달라 행 매칭이 어긋났을 가능성. 해당 약품은 자동으로 검토 표시(빨간 배지) 됩니다.
                        </div>
                      </div>
                    )}
                    {matches.length > 0 && (
                      <details className="text-[11px]">
                        <summary className="cursor-pointer text-emerald-700 hover:text-emerald-900 text-[10px]">일치 {matches.length}건 펼치기</summary>
                        <div className="bg-emerald-50 border border-emerald-200 rounded p-2 font-mono space-y-0.5 mt-1">
                          {matches.map((c, i) => (
                            <div key={i} className="text-emerald-700">
                              ✓ {c.insuranceCode} &quot;{c.productName}&quot; — qty [{c.positionalQuantity}]
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold text-gray-500 mb-1">CLOVA OCR</p>
            <pre className="text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap font-mono leading-relaxed">
              {editOcr.rawClovaText || "(없음)"}
            </pre>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-500 mb-1">GEMINI VISION</p>
            <pre className="text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap font-mono leading-relaxed">
              {editOcr.rawGeminiText || "(없음)"}
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 min-h-[200px]">
          <table className="w-full text-xs table-fixed">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[26%] bg-gray-50">보험코드</th>
                <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[20%] bg-gray-50">제약사</th>
                <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 bg-gray-50">제품명</th>
                <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[14%] bg-gray-50">수량</th>
                <th className="py-1.5 px-1 w-[34px] bg-gray-50"></th>
              </tr>
            </thead>
            <tbody>
              {!editOcr || editOcr.drugs.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-gray-400 text-xs">
                  {ocrLoading ? "인식 중..." : "처방전 인식 후 결과가 여기 표시됩니다"}
                </td></tr>
              ) : editOcr.drugs.map((d, i) => {
                const conf = d.finalConfidence;
                const rowBg = d.mismatch ? "bg-red-100" : d.manualCheck ? "bg-red-50" : conf >= 95 ? "bg-green-50/40" : "";
                const codeTitle = d.mismatch
                  ? `⚠ 보험코드↔이름 불일치 — 마스터: "${d.mismatch.masterProductName}" / OCR: "${d.mismatch.ocrProductName}"`
                  : d.insuranceCode.value;
                return (
                  <tr key={i} className={`border-b border-gray-100 h-9 ${rowBg}`}>
                    <td className="py-1.5 px-1.5 font-mono text-[11px] truncate" title={codeTitle}>
                      {d.mismatch && <span className="text-red-600 font-bold mr-0.5" title="보험코드와 마스터 제품명이 어긋남">⚠</span>}
                      {d.insuranceCode.value || "—"}
                    </td>
                    <td className="py-1.5 px-1.5 text-[11px] truncate" title={d.companyName.value}>{d.companyName.value || "—"}</td>
                    <td className="py-1.5 px-1.5 text-[11px]">
                      <div className="flex items-center gap-1">
                        <span className="truncate" title={d.productName.value}>{d.productName.value || "—"}</span>
                        <span className={`shrink-0 text-[9px] px-1 py-0.5 rounded border font-medium ${confColor(conf)}`}>{conf}%</span>
                        {d.mismatch && (
                          <span
                            className="shrink-0 text-[9px] px-1 py-0.5 rounded border border-red-300 bg-red-100 text-red-700 font-semibold"
                            title={`보험코드 ${d.insuranceCode.value} 의 마스터 제품명은 "${d.mismatch.masterProductName}" — OCR/Vision 이 본 "${d.mismatch.ocrProductName}" 와 다릅니다.`}>
                            코드↔이름
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-1.5 text-[11px] truncate">{d.quantity.value || "—"}</td>
                    <td className="py-1.5 px-1 text-blue-500" title={`${conf}% 확신 — 오른쪽 행으로 매칭됨`}>
                      <ArrowRight className="w-4 h-4 -mr-1" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
