"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Upload, AlertTriangle, CheckCircle, X, Search, ChevronDown, ChevronUp, Loader2, FileImage } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OcrResult, FusionDrug, ManualDrug, UserClient, ColumnTemplate, PipelineDiagnostics, EmrVendor, CaptureType } from "./types";
import { VENDOR_LABEL_KO, CAPTURE_LABEL_KO } from "./types";

// ─── 거래처별 일괄 업로드 패널 ──────────────────────────────────────────────

interface BatchRow {
  client: UserClient;
  file: File | null;
  uploading: boolean;
  result: { id: string; createdAt: string; drugCount: number; totalFee: number } | null;
  error: string;
  expanded: boolean;
  ocr: OcrResult | null;
}

function BatchUploadPanel({ clients }: { clients: UserClient[] }) {
  const { data: session } = useSession();
  const [yearMonth, setYearMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [ocrModal, setOcrModal] = useState<{ clientName: string; ocr: OcrResult } | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // 거래처 목록이 바뀌면 rows 동기화 (기존 결과 보존)
  useEffect(() => {
    setRows((prev) => {
      const prevMap = new Map(prev.map((r) => [r.client.id, r]));
      return clients.map((c) => prevMap.get(c.id) ?? {
        client: c, file: null, uploading: false, result: null, error: "", expanded: false, ocr: null,
      });
    });
  }, [clients]);

  function setRow(clientId: string, patch: Partial<BatchRow>) {
    setRows((prev) => prev.map((r) => r.client.id === clientId ? { ...r, ...patch } : r));
  }

  function handleFileChange(clientId: string, file: File | null) {
    setRow(clientId, { file, result: null, error: "", ocr: null });
  }

  async function compressImage(file: File, maxDim = 1600, quality = 0.78): Promise<Blob> {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("압축 실패"))), "image/jpeg", quality);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadRow(row: BatchRow) {
    if (!row.file || !session?.user?.id) return;
    setRow(row.client.id, { uploading: true, error: "" });
    try {
      // 1) OCR
      const compressed = await compressImage(row.file);
      const fd = new FormData();
      fd.append("image", compressed, "prescription.jpg");
      fd.append("clientId", row.client.id);
      const ocrRes = await fetch("/api/stats/ocr", { method: "POST", body: fd });
      const ocrText = await ocrRes.text();
      let ocrData: OcrResult & { error?: string };
      try { ocrData = JSON.parse(ocrText); }
      catch { throw new Error(`OCR 오류 (${ocrRes.status}): ${ocrText.slice(0, 200)}`); }
      if (ocrData.error) throw new Error(ocrData.error);

      // 2) base64 for storage
      const reader = new FileReader();
      const imageBase64 = await new Promise<string>((resolve) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(row.file!);
      });

      // 3) 확정 약품 = OCR 결과 그대로
      const finalDrugs = ocrData.drugs.map((d) => ({
        insuranceCode: d.insuranceCode.value,
        companyName: d.companyName.value,
        productName: d.productName.value,
        quantity: d.quantity.value,
        unitPrice: d.unitPrice,
        commissionRate: d.commissionRate,
        additionalRate: d.additionalRate,
        matchedMedicationId: d.matchedMedicationId,
        bboxYPercent: d.bboxYPercent,
      }));
      // 행별 수수료 = 수량 × 단가 × (수수료율 + 추가율) / 100
      const totalFee = finalDrugs.reduce((s, d) => {
        const qty = parseFloat(d.quantity) || 0;
        const price = d.unitPrice ?? 0;
        const ratePct = (d.commissionRate ?? 0) + (d.additionalRate ?? 0);
        return s + qty * price * ratePct / 100;
      }, 0);

      const [yearStr, monthStr] = yearMonth.split("-");
      const saveRes = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session.user.id,
          clientId: row.client.id,
          year: parseInt(yearStr ?? "0"),
          month: parseInt(monthStr ?? "0"),
          hospitalName: row.client.clientName,
          companyName: "",
          imageData: imageBase64,
          ocrData: {
            source: ocrData.source,
            vendor: ocrData.vendor,
            captureType: ocrData.captureType,
            aiDrugs: ocrData.drugs,
            finalDrugs,
            avgConfidence: ocrData.avgConfidence,
            manualCheckCount: ocrData.manualCheckCount,
            rawClovaText: ocrData.rawClovaText,
            rawGeminiText: ocrData.rawGeminiText,
            // 자동 검수 통과 케이스에서도 다음 업로드용 ColumnTemplate 캐시를 쌓아야
            // 같은 거래처 재방문 시 헤더 자동감지를 우회할 수 있다 (이전 누락 버그).
            columnTemplate: ocrData.columnTemplate,
          },
          totalFee,
        }),
      });
      const saved = await saveRes.json();
      if (saved.error) throw new Error(saved.error);

      setRow(row.client.id, {
        uploading: false,
        ocr: ocrData,
        result: {
          id: saved.id,
          createdAt: saved.createdAt,
          drugCount: finalDrugs.length,
          totalFee,
        },
      });
    } catch (e) {
      setRow(row.client.id, { uploading: false, error: String(e) });
    }
  }

  const [yearStr, monthStr] = yearMonth.split("-");
  const label = yearStr && monthStr ? `${yearStr}년 ${parseInt(monthStr)}월` : "";

  return (
    <div className="space-y-4">
      {/* 적용월 picker */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-end gap-4 flex-wrap">
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">적용월</label>
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="h-9 text-sm border border-gray-300 rounded-md px-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        {label && (
          <div className="text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-1.5">
            {label} 처방통계 일괄 등록
          </div>
        )}
        <p className="text-xs text-gray-400 ml-auto">거래처별로 처방전 사진을 업로드하면 자동 인식 후 저장합니다.</p>
      </div>

      {/* 거래처 행 목록 */}
      {rows.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-400 shadow-sm">
          등록된 거래처가 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.client.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              {/* 헤더 행 */}
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                {/* 거래처명 + 승인 배지 */}
                <div className="flex items-center gap-2 min-w-40">
                  <span className="text-sm font-semibold text-gray-800">{row.client.clientName}</span>
                  {row.client.approved
                    ? <span className="text-[10px] bg-green-100 text-green-700 border border-green-300 rounded px-1.5 py-0.5 shrink-0">승인완료</span>
                    : <span className="text-[10px] bg-yellow-100 text-yellow-700 border border-yellow-300 rounded px-1.5 py-0.5 shrink-0">승인전</span>
                  }
                </div>

                {/* 업로드 영역 */}
                <div
                  className={`flex-1 min-w-52 h-10 flex items-center gap-2 border-2 border-dashed rounded-lg px-3 cursor-pointer transition-colors
                    ${row.file ? "border-blue-300 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50/30"}`}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("image/")) handleFileChange(row.client.id, f); }}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileRefs.current[row.client.id]?.click()}
                >
                  <FileImage className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="text-xs text-gray-500 truncate">
                    {row.file ? row.file.name : "사진 드래그 또는 클릭"}
                  </span>
                  <input ref={(el) => { fileRefs.current[row.client.id] = el; }}
                    type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; handleFileChange(row.client.id, f ?? null); }} />
                </div>

                {/* 업로드 버튼 */}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => uploadRow(row)}
                  disabled={!row.file || row.uploading}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 shrink-0"
                >
                  {row.uploading ? "처리 중..." : "인식 · 저장"}
                </Button>

                {/* 결과 표시 */}
                {row.result && (
                  <div className="flex items-center gap-2 shrink-0">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-xs text-green-700 font-medium">
                      {new Date(row.result.createdAt).toLocaleDateString("ko-KR")} · 인식 {row.result.drugCount}건 · {row.result.totalFee.toLocaleString()}원
                    </span>
                    {row.ocr && (
                      <button
                        onClick={() => setRow(row.client.id, { expanded: !row.expanded })}
                        className="text-xs text-blue-600 flex items-center gap-0.5 hover:underline"
                      >
                        {row.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        OCR 결과
                      </button>
                    )}
                  </div>
                )}
                {row.error && (
                  <span className="text-xs text-red-500 shrink-0">{row.error}</span>
                )}
              </div>

              {/* 펼침: OCR 약품 목록 */}
              {row.expanded && row.ocr && (
                <div className="border-t border-gray-100 px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-700">OCR 인식 결과</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${row.ocr.avgConfidence >= 90 ? "bg-green-100 text-green-700 border-green-300" : row.ocr.avgConfidence >= 75 ? "bg-yellow-100 text-yellow-700 border-yellow-300" : "bg-red-100 text-red-700 border-red-300"}`}>
                      예상 정확도 {row.ocr.avgConfidence}%
                    </span>
                    {row.ocr.manualCheckCount > 0 && (
                      <span className="text-xs bg-red-100 text-red-700 border border-red-300 px-1.5 py-0.5 rounded font-semibold">
                        검토필요 {row.ocr.manualCheckCount}건
                      </span>
                    )}
                    {row.ocr.partialExtraction && (
                      <span
                        className="text-xs bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded font-semibold"
                        title={`사진 약품수 ${row.ocr.partialExtraction.detected}건 vs 추출 ${row.ocr.partialExtraction.extracted}건 — 일부 누락 가능`}
                      >
                        부분추출 {row.ocr.partialExtraction.detected}/{row.ocr.partialExtraction.extracted}
                      </span>
                    )}
                    <button
                      onClick={() => setOcrModal({ clientName: row.client.clientName, ocr: row.ocr! })}
                      className="ml-auto text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
                    >
                      전체 보기
                    </button>
                  </div>
                  <table className="w-full text-xs table-fixed">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left py-1 px-1.5 font-medium text-gray-500 w-[22%]">보험코드</th>
                        <th className="text-left py-1 px-1.5 font-medium text-gray-500 w-[18%]">제약사</th>
                        <th className="text-left py-1 px-1.5 font-medium text-gray-500">제품명</th>
                        <th className="text-left py-1 px-1.5 font-medium text-gray-500 w-[10%]">수량</th>
                        <th className="text-left py-1 px-1.5 font-medium text-gray-500 w-[10%]">정확도</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.ocr.drugs.map((d, i) => (
                        <tr key={i} className={`border-b border-gray-100 ${d.manualCheck ? "bg-red-50" : ""}`}>
                          <td className="py-1 px-1.5 font-mono text-[11px] truncate">{d.insuranceCode.value || "—"}</td>
                          <td className="py-1 px-1.5 text-[11px] truncate">{d.companyName.value || "—"}</td>
                          <td className="py-1 px-1.5 text-[11px] truncate">{d.productName.value || "—"}</td>
                          <td className="py-1 px-1.5 text-[11px]">{d.quantity.value || "—"}</td>
                          <td className="py-1 px-1.5 text-[11px]">{d.finalConfidence}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* OCR 전체 모달 */}
      {ocrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOcrModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">{ocrModal.clientName} — OCR 인식 결과</h2>
              <button onClick={() => setOcrModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <table className="w-full text-xs table-fixed">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-1.5 px-2 font-medium text-gray-500 w-[22%]">보험코드</th>
                  <th className="text-left py-1.5 px-2 font-medium text-gray-500 w-[18%]">제약사</th>
                  <th className="text-left py-1.5 px-2 font-medium text-gray-500">제품명</th>
                  <th className="text-left py-1.5 px-2 font-medium text-gray-500 w-[10%]">수량</th>
                  <th className="text-left py-1.5 px-2 font-medium text-gray-500 w-[10%]">정확도</th>
                </tr>
              </thead>
              <tbody>
                {ocrModal.ocr.drugs.map((d, i) => (
                  <tr key={i} className={`border-b border-gray-100 h-8 ${d.manualCheck ? "bg-red-50" : ""}`}>
                    <td className="py-1 px-2 font-mono text-[11px] truncate">{d.insuranceCode.value || "—"}</td>
                    <td className="py-1 px-2 text-[11px] truncate">{d.companyName.value || "—"}</td>
                    <td className="py-1 px-2 text-[11px] truncate">{d.productName.value || "—"}</td>
                    <td className="py-1 px-2 text-[11px]">{d.quantity.value || "—"}</td>
                    <td className="py-1 px-2 text-[11px]">{d.finalConfidence}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default BatchUploadPanel;
