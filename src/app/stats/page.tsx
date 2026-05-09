"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Upload, ZoomIn, ZoomOut, Maximize2, Minimize2, AlertTriangle, CheckCircle, BarChart3, UserPlus, X, Search, ArrowRight, Plus, Trash2, FileImage, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RequireRole from "@/components/RequireRole";
import DocumentScanner from "@/components/DocumentScanner";
import CameraCapture from "@/components/CameraCapture";

interface OcrField { value: string; confidence: number }
interface DrugDebug {
  anchorXPct: number;
  anchorTopPct: number;
  anchorBotPct: number;
  slopePerWidth: number;
  qtyBoxPct: { left: number; top: number; right: number; bottom: number } | null;
}
interface FusionDrug {
  insuranceCode: OcrField;
  companyName: OcrField;
  productName: OcrField;
  quantity: OcrField;
  unitPrice: number | null;
  commissionRate: number | null;
  additionalRate: number | null;
  matchedMedicationId: string | null;
  finalConfidence: number;
  manualCheck: boolean;
  bboxYPercent: number | null;
  debug: DrugDebug | null;
  mismatch?: {
    kind: "code-name-mismatch";
    masterProductName: string;
    ocrProductName: string;
  } | null;
}
// 서버의 EmrVendor / CaptureType 과 동기화 — 새 EMR 추가 시 ocr-vendor-classifier.ts 와 같이 수정.
type EmrVendor =
  | "doctor" | "doctor2" | "u-pharm" | "eghis" | "nh-pharm"
  | "chartfree" | "emrpro" | "biit" | "dubeone" | "pharm-it3000" | "unknown";
type CaptureType = "photo" | "screenshot" | "monitor";

const VENDOR_LABEL_KO: Record<EmrVendor, string> = {
  doctor: "의사랑 v1",
  doctor2: "의사랑 v2",
  "u-pharm": "U pharm system",
  eghis: "eGhis 통합",
  "nh-pharm": "NH팜",
  chartfree: "차트프리",
  emrpro: "EMRpro",
  biit: "비트",
  dubeone: "두번에",
  "pharm-it3000": "PHARM IT3000 (약국)",
  unknown: "알 수 없음",
};

const CAPTURE_LABEL_KO: Record<CaptureType, string> = {
  photo: "종이 사진",
  screenshot: "스크린샷",
  monitor: "모니터 촬영",
};

interface ColumnTemplate {
  insuranceCode: number | null;
  productName: number | null;
  patientCount: number | null;
  unitPrice: number | null;
  quantity: number | null;
  total: number | null;
  detectedAt: string;
  source: "auto" | "manual" | "cached";
  vendor?: EmrVendor;
  captureType?: CaptureType;
}
interface PipelineDiagnostics {
  vendor: EmrVendor;
  captureType: CaptureType;
  vendorConfidence: number;
  vendorRationale: string;
  vendorError: string | null;
  cachedTemplateVendor: EmrVendor | null;
  cacheHit: boolean;
  cacheRejectReason: string | null;
  clovaOk: boolean;
  clovaChars: number;
  clovaError: string | null;
  visionOk: boolean;
  visionDrugCount: number;
  visionError: string | null;
  mergeUsed: string;
  mergeDrugCount: number;
  mergeError: string | null;
  filteredByIsLikelyDrug: number;
  masterMatchedCount: number;
  masterUnmatchedCount: number;
  dedupedCount: number;
  finalCount: number;
  columnCounts?: {
    insuranceCode9digit: number;
    visionRows: number;
    positionalRows: number;
    mismatch: boolean;
  };
  nameCodeMismatchCount?: number;
  drugCandidates?: Array<{
    text: string;
    yPercent: number;
    xPercent: number;
    accepted: boolean;
    droppedReason: string | null;
    slope?: number;
    quantity?: string;
    quantityY?: number;
    insuranceCode?: string;
  }>;
  masterUnmatchedSamples?: Array<{ productName: string; unitPriceHint: number | null }>;
  crossValidation?: Array<{
    insuranceCode: string;
    productName: string;
    positionalQuantity: string;
    visionQuantity: string;
    match: boolean;
  }>;
  // Document AI 진단 (있을 수도 없을 수도)
  docaiOk?: boolean;
  docaiConfigured?: boolean;
  docaiTableCount?: number;
  docaiTotalRowCount?: number;
  docaiTextChars?: number;
  docaiError?: string | null;
  docaiSampleTable?: string[][] | null;
}
interface OcrResult {
  source: string;
  vendor: EmrVendor;
  captureType: CaptureType;
  drugs: FusionDrug[];
  avgConfidence: number;
  manualCheckCount: number;
  rawClovaText?: string;
  rawGeminiText?: string;
  hospitalName: OcrField;
  columnTemplate: ColumnTemplate | null;
  pipeline?: PipelineDiagnostics;
}
interface ManualDrug {
  insuranceCode: string;
  companyName: string;
  productName: string;
  quantity: string;
  unitPrice: number | null;
  commissionRate: number | null;
  additionalRate: number | null;
  matchedMedicationId: string | null;
  bboxYPercent: number | null;   // 이미지 내 행 Y 위치 (%) — 셀 포커스 시 이미지 자동 추적용
}
interface UserClient {
  id: string; clientName: string; bizNumber: string; approved: boolean;
}

function emptyManualDrug(): ManualDrug {
  return { insuranceCode: "", companyName: "", productName: "", quantity: "", unitPrice: null, commissionRate: null, additionalRate: null, matchedMedicationId: null, bboxYPercent: null };
}

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

function confColor(c: number) {
  if (c >= 90) return "bg-green-100 text-green-700 border-green-300";
  if (c >= 75) return "bg-yellow-100 text-yellow-700 border-yellow-300";
  return "bg-red-100 text-red-700 border-red-300";
}
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function StatsPage() {
  const { data: session } = useSession();

  // 탭
  const [pageTab, setPageTab] = useState<"single" | "batch">("single");

  // 폼
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [company, setCompany] = useState("");

  // 병원(거래처) 자동완성
  const [clients, setClients] = useState<UserClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<UserClient | null>(null);
  const [hospitalQuery, setHospitalQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const hospitalRef = useRef<HTMLDivElement>(null);

  // 신규 거래처 등록 모달
  const [regOpen, setRegOpen] = useState(false);
  const [regName, setRegName] = useState("");
  const [regBizNum, setRegBizNum] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState("");

  // 이미지
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [originalImageFile, setOriginalImageFile] = useState<File | null>(null);
  const [pendingScanFile, setPendingScanFile] = useState<File | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imageScrollRef = useRef<HTMLDivElement>(null);
  const imageElRef = useRef<HTMLImageElement>(null);
  const manualInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  // 줌
  const [zoomLevel, setZoomLevel] = useState(100);
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);

  // OCR
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [editOcr, setEditOcr] = useState<OcrResult | null>(null);

  // 사람이 최종 확정하는 약품 리스트 (오른쪽 패널)
  const [manualDrugs, setManualDrugs] = useState<ManualDrug[]>([emptyManualDrug()]);
  const [lookupBusy, setLookupBusy] = useState<Record<number, boolean>>({});
  const [manualInitMode, setManualInitMode] = useState<"ocr" | "lastMonth" | "empty">("ocr");

  // 제품명 자동완성 — 요율표(Medication) 검색
  interface AutocompleteOption {
    id: string;
    insuranceCode: string | null;
    productName: string;
    companyName: string;
    price: number | null;
    commissionRate: number | null;
    additionalRate: number | null;
  }
  const [autocompleteIdx, setAutocompleteIdx] = useState<number | null>(null);
  const [autocompleteOptions, setAutocompleteOptions] = useState<AutocompleteOption[]>([]);
  const [autocompleteFocus, setAutocompleteFocus] = useState(0);

  // 저번달 처방 (가운데 패널 — 거래처+년월 변경 시 자동 로드)
  const [lastMonth, setLastMonth] = useState<{ drugs: ManualDrug[]; year: number; month: number } | null>(null);
  const [lastMonthLoading, setLastMonthLoading] = useState(false);

  // 이미지 패널 사이즈 (사용자 조절 가능)
  const [imageHeight, setImageHeight] = useState(360);
  const isDraggingResize = useRef(false);
  const isPanning = useRef<{ startX: number; startY: number; startScrollX: number; startScrollY: number } | null>(null);
  const dragMoved = useRef(false);

  // 제출
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [middleTab, setMiddleTab] = useState<"ai" | "raw">("ai");

  // 거래처 목록 불러오기
  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/user-clients?userId=${session.user.id}`)
      .then((r) => r.json())
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch(() => setClients([]));
  }, [session]);

  // 제품명 자동완성 — 입력 중인 행의 productName 으로 마스터 검색 (80ms 디바운스 + 캐시)
  const autocompleteQuery = autocompleteIdx != null ? (manualDrugs[autocompleteIdx]?.productName ?? "") : "";
  const autocompleteCache = useRef<Map<string, AutocompleteOption[]>>(new Map());
  useEffect(() => {
    if (autocompleteIdx == null) { setAutocompleteOptions([]); return; }
    const q = autocompleteQuery.trim();
    if (q.length < 2) { setAutocompleteOptions([]); return; }
    const userId = session?.user?.id;
    const cacheKey = `${userId ?? ""}:${q}`;
    const cached = autocompleteCache.current.get(cacheKey);
    if (cached) { setAutocompleteOptions(cached); setAutocompleteFocus(0); return; }
    const t = setTimeout(async () => {
      try {
        const url = `/api/medications/search?q=${encodeURIComponent(q)}&limit=8&fast=true${userId ? `&userId=${userId}` : ""}`;
        const res = await fetch(url);
        const data = await res.json();
        const opts: AutocompleteOption[] = Array.isArray(data.medications) ? data.medications.slice(0, 8) : [];
        autocompleteCache.current.set(cacheKey, opts);
        setAutocompleteOptions(opts);
        setAutocompleteFocus(0);
      } catch { setAutocompleteOptions([]); }
    }, 80);
    return () => clearTimeout(t);
  }, [autocompleteIdx, autocompleteQuery, session?.user?.id]);

  // 자동완성 옵션 선택 → 관련 필드 일괄 채우기
  function applyAutocomplete(rowIdx: number, opt: AutocompleteOption) {
    setManualDrugs((prev) => {
      const next = [...prev];
      next[rowIdx] = {
        ...next[rowIdx],
        insuranceCode: opt.insuranceCode ?? next[rowIdx].insuranceCode,
        companyName: opt.companyName ?? "",
        productName: opt.productName,
        unitPrice: opt.price ?? null,
        commissionRate: opt.commissionRate ?? null,
        additionalRate: opt.additionalRate ?? null,
        matchedMedicationId: opt.id,
      };
      return next;
    });
    setAutocompleteIdx(null);
    setAutocompleteOptions([]);
  }

  // 저번달 처방 자료 자동 로드 (거래처/년월 변경 시)
  useEffect(() => {
    if (!selectedClient || !year || !month) { setLastMonth(null); return; }
    setLastMonthLoading(true);
    fetch(`/api/stats/client-history?clientId=${selectedClient.id}&year=${year}&month=${month}`)
      .then((r) => r.json())
      .then((data) => {
        setLastMonth(data.lastMonth ?? null);
      })
      .catch(() => setLastMonth(null))
      .finally(() => setLastMonthLoading(false));
  }, [selectedClient, year, month]);

  // 이미지 패널 높이 — localStorage 영속화
  useEffect(() => {
    const v = localStorage.getItem("stats:imageHeight");
    if (v) setImageHeight(Math.max(200, Math.min(800, parseInt(v) || 360)));
  }, []);
  useEffect(() => { localStorage.setItem("stats:imageHeight", String(imageHeight)); }, [imageHeight]);

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (hospitalRef.current && !hospitalRef.current.contains(e.target as Node)) setShowDropdown(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filteredClients = useMemo(() => {
    if (!hospitalQuery.trim()) return clients;
    const q = hospitalQuery.toLowerCase();
    return clients.filter((c) => c.clientName.toLowerCase().includes(q) || c.bizNumber.includes(q));
  }, [clients, hospitalQuery]);

  function selectClient(c: UserClient) {
    setSelectedClient(c);
    setHospitalQuery(c.clientName);
    setShowDropdown(false);
  }

  function clearClient() {
    setSelectedClient(null);
    setHospitalQuery("");
  }

  async function deleteClient(c: UserClient) {
    // 1) 연결된 항목 카운트 가져와서 확인 메시지에 포함
    let reportCount = 0, proposalCount = 0;
    try {
      const r = await fetch(`/api/user-clients/${c.id}`);
      if (r.ok) {
        const data = await r.json();
        reportCount = data.reportCount ?? 0;
        proposalCount = data.proposalCount ?? 0;
      }
    } catch { /* 카운트 못 가져와도 진행 */ }

    const refs = [
      reportCount > 0 ? `처방통계 ${reportCount}건` : "",
      proposalCount > 0 ? `제안서 ${proposalCount}건` : "",
    ].filter(Boolean).join(" / ");
    const msg = refs
      ? `"${c.clientName}" 거래처를 삭제할까요?\n연결된 ${refs}는 그대로 유지되고 거래처 정보만 분리됩니다.`
      : `"${c.clientName}" 거래처를 삭제할까요?`;
    if (!window.confirm(msg)) return;

    try {
      const res = await fetch(`/api/user-clients/${c.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `삭제 실패 (${res.status})`);
      setClients((prev) => prev.filter((x) => x.id !== c.id));
      if (selectedClient?.id === c.id) clearClient();
    } catch (e) {
      window.alert(`거래처 삭제 실패: ${String(e)}`);
    }
  }

  async function registerClient() {
    if (!regName.trim() || !regBizNum.trim()) { setRegError("이름과 사업자번호를 입력하세요"); return; }
    if (!session?.user?.id) return;
    setRegLoading(true); setRegError("");
    try {
      const res = await fetch("/api/user-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: session.user.id, clientName: regName.trim(), bizNumber: regBizNum.trim() }),
      });
      const data = await res.json();
      if (data.error) { setRegError(data.error); return; }
      setClients((prev) => [data, ...prev]);
      selectClient(data);
      setRegOpen(false); setRegName(""); setRegBizNum("");
    } catch (e) {
      setRegError(String(e));
    } finally {
      setRegLoading(false);
    }
  }

  const handleFile = useCallback((file: File) => {
    setImageFile(file);
    // 원본이 따로 저장되어 있지 않으면 이 파일을 원본으로 간주 (재보정 fallback 용).
    setOriginalImageFile((cur) => cur ?? file);
    setImageUrl(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = (e) => setImageBase64(e.target?.result as string);
    reader.readAsDataURL(file);
    setOcr(null); setEditOcr(null);
    setManualDrugs([emptyManualDrug()]);
    setZoomEnabled(false); setIsZoomed(false); setZoomLevel(100);
    setSubmitted(false); setSubmitError("");
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      setOriginalImageFile(file);
      setPendingScanFile(file);
    }
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

  async function runOcr() {
    if (!imageFile) return;
    if (!selectedClient) { setOcrError("거래처를 먼저 선택하세요"); return; }
    setOcrLoading(true); setOcrError("");
    try {
      const compressed = await compressImage(imageFile);
      const fd = new FormData();
      fd.append("image", compressed, "prescription.jpg");
      fd.append("clientId", selectedClient.id);
      const res = await fetch("/api/stats/ocr", { method: "POST", body: fd });
      const text = await res.text();
      let data: { error?: string } & OcrResult;
      try { data = JSON.parse(text); }
      catch { throw new Error(`서버 응답 오류 (${res.status}): ${text.slice(0, 200)}`); }
      if (data.error) throw new Error(data.error);
      setOcr(data);
      setEditOcr(JSON.parse(JSON.stringify(data)));
      // 사람 확정 패널 초기화 — manualInitMode 에 따라
      if (manualInitMode === "ocr") {
        const paired: ManualDrug[] = (data.drugs ?? []).map((d) => ({
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
        setManualDrugs(paired.length ? paired : [emptyManualDrug()]);
      } else if (manualInitMode === "lastMonth" && lastMonth?.drugs.length) {
        setManualDrugs([...lastMonth.drugs.map((d) => ({ ...d })), emptyManualDrug()]);
      } else {
        setManualDrugs([emptyManualDrug()]);
      }
      setZoomEnabled(true);
      if (!selectedClient && data.hospitalName?.value) {
        setHospitalQuery(data.hospitalName.value);
        setShowDropdown(true);
      }
    } catch (e) {
      setOcrError(String(e));
    } finally {
      setOcrLoading(false);
    }
  }

  function handleImageClick() {
    if (dragMoved.current) return; // 드래그 끝 click 무시
    if (!zoomEnabled) return;
    if (isZoomed) { setZoomLevel(100); setIsZoomed(false); }
    else { setZoomLevel(200); setIsZoomed(true); }
  }

  // 이미지 click-drag 팬 — 줌 상태 무관하게 동작
  function handleImageMouseDown(e: React.MouseEvent) {
    const scrollEl = imageScrollRef.current;
    if (!scrollEl) return;
    isPanning.current = {
      startX: e.clientX,
      startY: e.clientY,
      startScrollX: scrollEl.scrollLeft,
      startScrollY: scrollEl.scrollTop,
    };
    dragMoved.current = false;
  }
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const pan = isPanning.current;
      const scrollEl = imageScrollRef.current;
      if (!pan || !scrollEl) return;
      const dx = e.clientX - pan.startX;
      const dy = e.clientY - pan.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved.current = true;
      scrollEl.scrollLeft = pan.startScrollX - dx;
      scrollEl.scrollTop = pan.startScrollY - dy;
    }
    function onUp() { isPanning.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // 이미지 패널 세로 크기 조절 — 하단 핸들 드래그
  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    isDraggingResize.current = true;
    const startY = e.clientY;
    const startHeight = imageHeight;
    function onMove(ev: MouseEvent) {
      if (!isDraggingResize.current) return;
      const next = Math.max(200, Math.min(800, startHeight + (ev.clientY - startY)));
      setImageHeight(next);
    }
    function onUp() {
      isDraggingResize.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // 오른쪽 패널 — 사람 입력
  function updateManualField(idx: number, field: keyof ManualDrug, value: string) {
    setManualDrugs((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value, matchedMedicationId: field === "insuranceCode" ? null : next[idx].matchedMedicationId };
      // 마지막 행에 입력하면 빈 행 자동 추가
      if (idx === next.length - 1 && (value || "").trim()) next.push(emptyManualDrug());
      return next;
    });
  }
  function removeManualRow(idx: number) {
    setManualDrugs((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [emptyManualDrug()];
    });
  }
  function addManualRow() {
    setManualDrugs((prev) => [...prev, emptyManualDrug()]);
  }
  function moveManualRow(fromIdx: number, toIdx: number) {
    setManualDrugs((prev) => {
      if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= prev.length || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, row);
      return next;
    });
  }

  // 행/필드에 포커스 들어오면 이미지를 해당 약품의 Y 위치로 스크롤
  function handleManualFocus(idx: number) {
    setFocusedIdx(idx);
    // bboxYPercent 는 manualDrug 자체에 보관 — editOcr.drugs[idx] 와 idx 가 어긋나는
    // 경우(행 추가/삭제, 중복 제거 등) 에도 정확한 bbox 사용 가능
    const yPercent = manualDrugs[idx]?.bboxYPercent ?? null;
    const scrollEl = imageScrollRef.current;
    const imgEl = imageElRef.current;
    if (!scrollEl || !imgEl) return;
    const imgRect = imgEl.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();
    const imgTopInScroll = imgRect.top - scrollRect.top + scrollEl.scrollTop;
    if (yPercent != null) {
      const targetY = imgTopInScroll + (imgEl.clientHeight * yPercent) / 100;
      scrollEl.scrollTo({ top: Math.max(0, targetY - scrollEl.clientHeight / 2), behavior: "smooth" });
    } else if (manualDrugs.length) {
      const targetY = imgTopInScroll + (idx / manualDrugs.length) * imgEl.clientHeight;
      scrollEl.scrollTo({ top: Math.max(0, targetY - scrollEl.clientHeight / 2), behavior: "smooth" });
    }
  }

  // 키보드 위/아래로 행 이동 (Enter / ArrowDown / ArrowUp)
  // 제품명·긴 필드에선 select() 시 커서가 끝으로 가서 검수 시 처음부터 읽기 어려움.
  // 항상 맨 앞(0,0)으로 고정 — 검수자가 텍스트 처음부터 빠르게 훑을 수 있게.
  function handleManualKey(e: React.KeyboardEvent<HTMLInputElement>, idx: number, field: keyof ManualDrug) {
    // 자동완성이 productName 행에 열려있으면 ↑↓/Enter/Esc 를 dropdown 에 우선 위임
    const acOpen = field === "productName" && autocompleteIdx === idx && autocompleteOptions.length > 0;
    if (acOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteFocus((f) => Math.min(f + 1, autocompleteOptions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteFocus((f) => Math.max(f - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        applyAutocomplete(idx, autocompleteOptions[autocompleteFocus]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAutocompleteIdx(null);
        return;
      }
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    e.preventDefault();
    setAutocompleteIdx(null);
    const dir = e.key === "ArrowUp" ? -1 : 1;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= manualDrugs.length) return;
    const target = manualInputRefs.current[`${nextIdx}:${field}`];
    target?.focus();
    // 방향키 이동 시 텍스트 전체 선택 — 바로 타이핑으로 덮어쓰기 가능
    target?.select();
    if (target) {
      target.scrollLeft = 0;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  // 보험코드 입력 후 마스터에서 제품명/제약사/단가 자동 채움
  async function lookupByInsuranceCode(idx: number) {
    const code = manualDrugs[idx]?.insuranceCode.replace(/\D/g, "") ?? "";
    if (code.length !== 9) return;
    setLookupBusy((b) => ({ ...b, [idx]: true }));
    try {
      const res = await fetch(`/api/medications/search?q=${encodeURIComponent(code)}&limit=1`);
      const data = await res.json();
      const med = data.medications?.[0];
      if (med && med.insuranceCode === code) {
        setManualDrugs((prev) => {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            insuranceCode: code,
            companyName: med.companyName ?? "",
            productName: med.productName ?? "",
            unitPrice: med.price ?? null,
            commissionRate: med.commissionRate ?? null,
            additionalRate: med.additionalRate ?? null,
            matchedMedicationId: med.id ?? null,
          };
          return next;
        });
      }
    } finally {
      setLookupBusy((b) => ({ ...b, [idx]: false }));
    }
  }

  const filledManualDrugs = manualDrugs.filter((d) => d.insuranceCode || d.productName || d.quantity);
  // 행별 수수료 = 수량 × 단가 × (수수료율 + 추가율) / 100
  function rowCommission(d: ManualDrug): number {
    const qty = parseFloat(d.quantity) || 0;
    const price = d.unitPrice ?? 0;
    const ratePct = (d.commissionRate ?? 0) + (d.additionalRate ?? 0);
    return qty * price * ratePct / 100;
  }
  // 총합계 로직 — 사용자 검수 흐름에 맞춤:
  //   총수량 = OCR 이 잡은 모든 행의 수량 합 (이미지 헤더와 비교해 누락 즉시 식별)
  //   총금액 = 약가 매칭된 행의 (수량 × 약가) 합 (실제 청구 금액)
  //   총수료 = 약가 매칭된 행의 수수료 합
  // 사용자가 한눈에 보고 검수 필요 여부 빠르게 판단 가능.
  const totalQuantity = filledManualDrugs.reduce((sum, d) => sum + (parseFloat(d.quantity) || 0), 0);
  const totalAmount = filledManualDrugs.reduce((sum, d) => {
    const qty = parseFloat(d.quantity) || 0;
    const price = d.unitPrice ?? 0;
    return sum + qty * price;
  }, 0);
  const noPriceCount = filledManualDrugs.filter((d) => (parseFloat(d.quantity) || 0) > 0 && !d.unitPrice).length;
  // 합계행 자동 감지 — 한 행의 수량이 전체 합의 30% 이상이면 합계행으로 OCR 됐을 가능성
  const suspectedSummaryRows = totalQuantity > 0
    ? filledManualDrugs.filter((d) => (parseFloat(d.quantity) || 0) > totalQuantity * 0.3).length
    : 0;
  // 중복 보험코드 감지 — 같은 9자리 코드가 여러 행에 등장. OCR 이 한 행을 두 번 읽거나
  // 다른 행의 코드를 잘못 인식해 같은 코드로 만든 케이스. 정당한 경우 (진료실 1·2)
  // 도 있어 경고만 노출, 자동 제거는 안 함.
  const dupCodeRows = (() => {
    const counts = new Map<string, number>();
    for (const d of filledManualDrugs) {
      const c = (d.insuranceCode || "").replace(/\D/g, "");
      if (c.length === 9) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let dups = 0;
    for (const [, n] of counts) if (n > 1) dups += n;
    return dups;
  })();
  const totalFee = filledManualDrugs.reduce((sum, d) => sum + rowCommission(d), 0);

  const isClientUnnapproved = selectedClient !== null && !selectedClient.approved;

  async function handleSubmit() {
    if (!session?.user?.id) return;
    if (filledManualDrugs.length === 0) { setSubmitError("오른쪽 사람 확정 창에 약품을 1개 이상 입력하세요"); return; }
    setSubmitting(true); setSubmitError("");
    try {
      const res = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session.user.id,
          clientId: selectedClient?.id || null,
          year: parseInt(year), month: parseInt(month),
          hospitalName: selectedClient?.clientName || hospitalQuery || editOcr?.hospitalName.value || "",
          companyName: company,
          imageData: imageBase64,
          ocrData: {
            source: editOcr?.source ?? "manual",
            vendor: editOcr?.vendor ?? "unknown",
            captureType: editOcr?.captureType ?? "photo",
            aiDrugs: editOcr?.drugs ?? [],
            finalDrugs: filledManualDrugs,
            avgConfidence: editOcr?.avgConfidence ?? 0,
            manualCheckCount: editOcr?.manualCheckCount ?? 0,
            rawClovaText: editOcr?.rawClovaText,
            rawGeminiText: editOcr?.rawGeminiText,
            // 다음 업로드부터 같은 거래처 EMR 양식을 자동 재사용하기 위해 같이 저장.
            // vendor 가 다르면 fetchCachedColumnTemplate 가 거부 → cross-EMR 오염 방지.
            columnTemplate: editOcr?.columnTemplate ?? null,
          },
          totalFee,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSubmitted(true);
    } catch (e) {
      setSubmitError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RequireRole minRole="BIZ">
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">처방통계 등록</h1>
            <p className="text-sm text-gray-500 mt-0.5">처방전 이미지를 업로드하면 자동으로 인식합니다</p>
          </div>
          {/* 탭 */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setPageTab("single")}
              className={`text-sm px-4 py-1.5 rounded-md font-medium transition-colors ${pageTab === "single" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
            >
              단건 등록
            </button>
            <button
              onClick={() => setPageTab("batch")}
              className={`text-sm px-4 py-1.5 rounded-md font-medium transition-colors ${pageTab === "batch" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
            >
              거래처별 일괄
            </button>
          </div>
        </div>

        {/* 거래처별 일괄 탭 */}
        {pageTab === "batch" && <BatchUploadPanel clients={clients} />}

        {/* 단건 등록 탭 */}
        {pageTab === "single" && <>

        {/* 상단 폼 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">처방년도</label>
              <select value={year} onChange={(e) => setYear(e.target.value)}
                className="h-9 text-sm border border-gray-300 rounded-md px-2 pr-7 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">처방월</label>
              <select value={month} onChange={(e) => setMonth(e.target.value)}
                className="h-9 text-sm border border-gray-300 rounded-md px-2 pr-7 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
                {MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}
              </select>
            </div>

            {/* 병원 자동완성 */}
            <div className="flex-1 min-w-52" ref={hospitalRef}>
              <div className="flex items-center gap-1.5 mb-1 h-4">
                <label className="text-xs font-medium text-gray-600">병원 (거래처)</label>
                {selectedClient && (
                  selectedClient.approved
                    ? <span className="text-[10px] bg-green-100 text-green-700 border border-green-300 rounded px-1.5 py-0.5">승인완료</span>
                    : <span className="text-[10px] bg-yellow-100 text-yellow-700 border border-yellow-300 rounded px-1.5 py-0.5">승인전</span>
                )}
              </div>
              <div className="relative flex gap-1">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  <input
                    value={hospitalQuery}
                    onChange={(e) => { setHospitalQuery(e.target.value); setShowDropdown(true); if (!e.target.value) setSelectedClient(null); }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="병원명 검색..."
                    className="w-full h-9 text-sm border border-gray-300 rounded-md pl-8 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  {selectedClient && (
                    <button onClick={clearClient} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {showDropdown && (() => {
                    // 매칭 결과 우선, 없으면 전체 거래처를 폴백으로 노출.
                    const noMatch = filteredClients.length === 0 && clients.length > 0;
                    const list = noMatch ? clients : filteredClients;
                    return (
                      <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
                        {clients.length === 0 ? (
                          <div className="px-3 py-4 text-center">
                            <p className="text-xs text-gray-500 mb-2">등록된 거래처가 없습니다</p>
                            <p className="text-[11px] text-gray-400">오른쪽 + 버튼으로 거래처를 가등록하세요</p>
                          </div>
                        ) : (
                          <>
                            {noMatch && (
                              <p className="px-3 py-1.5 text-[11px] text-gray-500 bg-yellow-50 border-b border-yellow-200">
                                "{hospitalQuery}" 와 일치하는 거래처가 없어 전체 목록 ({clients.length}건) 을 표시합니다
                              </p>
                            )}
                            {list.map((c) => (
                              <div key={c.id} role="button" tabIndex={0}
                                onClick={() => selectClient(c)}
                                onKeyDown={(e) => { if (e.key === "Enter") selectClient(c); }}
                                className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2 cursor-pointer">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-800 truncate">{c.clientName}</p>
                                  <p className="text-xs text-gray-400">{c.bizNumber}</p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {c.approved
                                    ? <span className="text-[10px] bg-green-100 text-green-700 border border-green-300 rounded px-1.5 py-0.5">승인완료</span>
                                    : <span className="text-[10px] bg-yellow-100 text-yellow-700 border border-yellow-300 rounded px-1.5 py-0.5">승인전</span>
                                  }
                                  <button type="button"
                                    onClick={(e) => { e.stopPropagation(); deleteClient(c); }}
                                    className="text-gray-300 hover:text-red-600 p-0.5 rounded hover:bg-red-50"
                                    title="이 거래처 삭제">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {/* 신규 거래처 등록 버튼 */}
                <button type="button" onClick={() => { setRegOpen(true); setRegName(hospitalQuery); }}
                  className="h-9 px-2.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 shrink-0"
                  title="신규 거래처 등록">
                  <UserPlus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-w-40">
              <label className="text-xs font-medium text-gray-600 mb-1 block">제약사</label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)}
                placeholder="제약사명 입력" className="h-9 text-sm" />
            </div>
            <div className="text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-3 py-1.5 whitespace-nowrap">
              {year}년 {month}월 처방통계
            </div>
          </div>

          {/* 승인전 거래처 경고 */}
          {isClientUnnapproved && (
            <div className="mt-3 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
              <div className="text-xs text-yellow-800">
                <span className="font-semibold">승인 전 거래처입니다.</span>
                {" "}통계 입력 및 저장은 가능하지만, 관리자 승인 전까지 <span className="font-semibold">정산서에 반영되지 않습니다.</span>
              </div>
            </div>
          )}
        </div>

        {/* 이미지 — 상단 sticky strip (높이 조절 + pan/zoom + 커서 따라감) */}
        <div className="sticky top-0 z-30 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 px-3 py-2 flex items-center gap-2 bg-gray-50 flex-wrap">
            <Button type="button" variant="outline" size="sm" onClick={() => setCameraOpen(true)} className="text-xs">
              카메라
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="text-xs">
              <Upload className="w-3.5 h-3.5 mr-1" />파일 선택
            </Button>
            {(originalImageFile || imageFile) && (
              <Button type="button" variant="outline" size="sm"
                      onClick={() => setPendingScanFile(originalImageFile ?? imageFile)}
                      className="text-xs bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-700">
                재보정
              </Button>
            )}
            {imageUrl && (
              <Button type="button" size="sm" onClick={runOcr} disabled={ocrLoading || !selectedClient}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300">
                <BarChart3 className="w-3.5 h-3.5 mr-1" />{ocrLoading ? "인식 중..." : "처방전 인식"}
              </Button>
            )}
            {imageUrl && !selectedClient && (
              <span className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded">
                ⓘ 거래처를 먼저 선택하세요
              </span>
            )}
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {imageUrl && <>
                <button onClick={() => { setZoomLevel(100); setIsZoomed(false); }}
                  className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 font-mono">1:1</button>
                <button onClick={() => setZoomLevel((z) => Math.min(z + 25, 400))}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-100">
                  <ZoomIn className="w-3.5 h-3.5" /></button>
                <button onClick={() => setZoomLevel((z) => Math.max(z - 25, 25))}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-100">
                  <ZoomOut className="w-3.5 h-3.5" /></button>
                <span className="text-xs text-gray-500 font-mono w-10 text-right">{zoomLevel}%</span>
              </>}
              {ocr && (
                <>
                  <span className="text-xs text-gray-600">클릭 확대</span>
                  <button onClick={() => { setZoomEnabled((v) => !v); if (isZoomed) { setIsZoomed(false); setZoomLevel(100); } }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${zoomEnabled ? "bg-blue-500" : "bg-gray-300"}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${zoomEnabled ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                  <span className="text-[10px] text-gray-500">
                    {zoomEnabled ? (isZoomed ? <Minimize2 className="w-3 h-3 inline text-blue-500" /> : <Maximize2 className="w-3 h-3 inline text-blue-500" />) : null}
                  </span>
                  <span className="text-xs text-gray-600 ml-2">디버그</span>
                  <button onClick={() => setShowDebug((v) => !v)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${showDebug ? "bg-pink-500" : "bg-gray-300"}`}
                    title="OCR 행 밴드와 매칭된 셀 위치를 이미지에 표시">
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${showDebug ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                </>
              )}
              {ocrError && <p className="text-xs text-red-500">{ocrError}</p>}
            </div>
          </div>
          <div ref={imageScrollRef}
            onMouseDown={handleImageMouseDown}
            style={{ height: `${imageHeight}px` }}
            className="overflow-auto relative bg-gray-50"
          >
            {imageUrl ? (
              <div onClick={handleImageClick}
                className={`w-full min-h-full flex items-start justify-center p-2 select-none ${isPanning.current ? "cursor-grabbing" : zoomEnabled ? (isZoomed ? "cursor-zoom-out" : "cursor-zoom-in") : "cursor-grab"}`}>
                {/* 이미지 + 행 하이라이트는 같은 relative 박스 안에 — 좌표가 이미지 크기에 정확히 매핑됨 */}
                <div className="relative shrink-0"
                  style={{ width: `${zoomLevel}%`, transition: "width 0.2s ease" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img ref={imageElRef} src={imageUrl} alt="처방전"
                    style={{ width: "100%", display: "block" }}
                    className="rounded" draggable={false} />
                  {focusedIdx != null && manualDrugs[focusedIdx]?.bboxYPercent != null && (
                    <div
                      className="absolute left-0 right-0 pointer-events-none border-y-2 border-yellow-400 bg-yellow-300/20 transition-all"
                      style={{
                        top: `${manualDrugs[focusedIdx]!.bboxYPercent}%`,
                        height: "32px",
                        transform: "translateY(-50%)",
                      }}
                    />
                  )}
                  {/* 디버그 SVG 오버레이 — 약품마다 행 밴드 (위/아래 2 라인) + 매칭된 사용량 bbox 표시 */}
                  {showDebug && editOcr && (
                    <svg className="absolute inset-0 pointer-events-none"
                      viewBox="0 0 100 100" preserveAspectRatio="none"
                      style={{ width: "100%", height: "100%" }}>
                      {editOcr.drugs.map((d, i) => {
                        if (!d.debug) return null;
                        const { anchorXPct, anchorTopPct, anchorBotPct, slopePerWidth, qtyBoxPct } = d.debug;
                        // 윗선/아랫선을 X=0 ~ X=100 까지 slope 로 연장
                        const xLeft = 0, xRight = 100;
                        const dxLeft = xLeft - anchorXPct * 100;
                        const dxRight = xRight - anchorXPct * 100;
                        const yTopLeft = anchorTopPct * 100 + slopePerWidth * (dxLeft / 100) * 100;
                        const yTopRight = anchorTopPct * 100 + slopePerWidth * (dxRight / 100) * 100;
                        const yBotLeft = anchorBotPct * 100 + slopePerWidth * (dxLeft / 100) * 100;
                        const yBotRight = anchorBotPct * 100 + slopePerWidth * (dxRight / 100) * 100;
                        const isFocus = focusedIdx === i;
                        const stroke = isFocus ? "#dc2626" : "#fb7185";  // focus: red, else pink
                        const op = isFocus ? 0.95 : 0.45;
                        return (
                          <g key={i} opacity={op}>
                            <line x1={xLeft} y1={yTopLeft} x2={xRight} y2={yTopRight}
                              stroke={stroke} strokeWidth={isFocus ? 0.25 : 0.12} vectorEffect="non-scaling-stroke" />
                            <line x1={xLeft} y1={yBotLeft} x2={xRight} y2={yBotRight}
                              stroke={stroke} strokeWidth={isFocus ? 0.25 : 0.12} vectorEffect="non-scaling-stroke" />
                            {qtyBoxPct && (
                              <rect
                                x={qtyBoxPct.left * 100}
                                y={qtyBoxPct.top * 100}
                                width={(qtyBoxPct.right - qtyBoxPct.left) * 100}
                                height={(qtyBoxPct.bottom - qtyBoxPct.top) * 100}
                                fill="none" stroke="#16a34a" strokeWidth={isFocus ? 0.4 : 0.2}
                                vectorEffect="non-scaling-stroke" />
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  )}
                </div>
              </div>
            ) : (
              <div onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
                className="h-full min-h-64 flex flex-col items-center justify-center gap-3 transition-colors m-4 border-2 border-dashed border-gray-300 rounded-lg p-4">
                <Upload className="w-10 h-10 text-gray-300" />
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-600">처방전 이미지 업로드</p>
                  <p className="text-xs text-gray-400 mt-1">파일 선택 후 4 모서리 보정 (캠스캐너 방식)</p>
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 max-w-md mx-auto">
                    📷 촬영 팁: 종이를 <b>평평하게 펴서</b> 빛 잘 드는 곳에서 정면으로 찍으세요. 꾸겨짐·접힘은 OCR 정확도를 크게 떨어뜨립니다.
                  </p>
                </div>
                <div className="flex gap-2 mt-2">
                  <Button type="button" size="sm" onClick={() => setCameraOpen(true)}
                          className="bg-blue-600 hover:bg-blue-700 text-white">
                    카메라 촬영
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    앨범에서 선택
                  </Button>
                </div>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setOriginalImageFile(f); setPendingScanFile(f); } e.target.value = ""; }} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setOriginalImageFile(f); setPendingScanFile(f); } e.target.value = ""; }} />
          </div>
          {/* 높이 조절 핸들 — 아래로 드래그 */}
          <div onMouseDown={handleResizeMouseDown}
            className="h-1.5 cursor-row-resize bg-gray-200 hover:bg-blue-400 transition-colors"
            title="드래그하여 높이 조절" />
        </div>

        {/* 2-pane data view: 사진매칭 / 최종수정 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 사진매칭: OCR 인식 원본 (read-only, 항상 4컬럼 헤더 표시) */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col max-h-[80vh]">
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
                    {/* 0단계: 벤더 분류 결과 — OCR 정확도의 가장 큰 지렛대. 분류 신뢰도가 낮으면 캐시·전처리 분기가 동작하지 않으므로 별도 박스로 강조. */}
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
                      const mismatches = editOcr.pipeline.crossValidation.filter((c) => !c.match);
                      const matches = editOcr.pipeline.crossValidation.filter((c) => c.match);
                      return (
                        <div className="mt-2">
                          <p className="text-[10px] font-semibold text-gray-500 mb-1">
                            Vision · Positional 교차 검증 (총 {editOcr.pipeline.crossValidation.length}건 — 일치 {matches.length} / 불일치 <span className={mismatches.length > 0 ? "text-red-700 font-bold" : ""}>{mismatches.length}</span>)
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


          {/* 최종수정: 사람 확정 입력 */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col max-h-[80vh]">
            <div className="border-b border-gray-100 px-3 h-[44px] flex items-center gap-2 overflow-x-auto">
              <span className="text-xs font-semibold text-gray-700">② 최종 수정</span>
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{filledManualDrugs.length}건</span>
              {isClientUnnapproved && (
                <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-300 px-1.5 py-0.5 rounded font-semibold">정산서 미반영</span>
              )}
              <select
                value={manualInitMode}
                onChange={(e) => setManualInitMode(e.target.value as "ocr" | "lastMonth" | "empty")}
                className="ml-auto text-[11px] h-7 border border-gray-300 rounded px-1.5 bg-white text-gray-600"
                title="OCR 인식 시 이 패널을 어떤 데이터로 채울지 선택">
                <option value="ocr">OCR 결과 복사</option>
                <option value="lastMonth">저번달 복사</option>
                <option value="empty">비어있음</option>
              </select>
              <button onClick={addManualRow}
                className="text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 flex items-center gap-1">
                <Plus className="w-3 h-3" />행 추가
              </button>
            </div>

            {/* 총수량/총금액/총 수수료 + 최종 승인 — 패널이 height 제한이라
                자연스럽게 상단 고정 (rows 스크롤은 아래쪽 flex-1 영역에서). */}
            <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-[10px] text-gray-400" title="OCR 이 잡은 모든 행의 수량 합. 이미지 헤더의 총수량과 비교해 누락 여부 즉시 확인">
                    총수량 <span className="text-gray-300">(OCR 전체)</span>
                  </p>
                  <p className="text-lg font-bold text-gray-900">{totalQuantity.toLocaleString()}</p>
                  {suspectedSummaryRows > 0 && (
                    <p className="text-[10px] text-red-600 font-medium" title="한 행의 수량이 전체의 30%+ — 합계행이 약품으로 잘못 OCR 됐을 가능성">
                      ⚠ 합계행 의심 {suspectedSummaryRows}건
                    </p>
                  )}
                  {dupCodeRows > 0 && (
                    <p className="text-[10px] text-red-600 font-medium" title="같은 9자리 보험코드가 여러 행에 등장 — OCR 이 한 행을 두 번 읽었거나 다른 행 코드를 잘못 읽음">
                      ⚠ 보험코드 중복 {dupCodeRows}건
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-gray-400" title="약가 매칭된 행의 (수량 × 마스터 약가) 합">
                    총금액 <span className="text-gray-300">(수량×약가)</span>
                  </p>
                  <p className="text-lg font-bold text-gray-900">{totalAmount.toLocaleString()}원</p>
                  {noPriceCount > 0 && (
                    <p className="text-[10px] text-amber-600 font-medium" title="보험코드 미매칭 — 약가 못 가져와서 0원으로 합산">
                      약가 미적용 {noPriceCount}건
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">예상 총 수수료</p>
                  <p className="text-lg font-bold text-gray-900">{totalFee.toLocaleString()}원</p>
                  {isClientUnnapproved && <p className="text-[10px] text-yellow-600 font-medium">정산서 미반영 (승인전)</p>}
                </div>
              </div>
              {submitted ? (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-5 h-5" /><span className="text-sm font-semibold">제출 완료</span>
                </div>
              ) : (
                <div className="flex flex-col items-end gap-1">
                  {submitError && <p className="text-xs text-red-500">{submitError}</p>}
                  <Button onClick={handleSubmit} disabled={submitting} className="bg-gray-900 hover:bg-gray-700 text-white">
                    {submitting ? "제출 중..." : "최종 승인"}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 min-h-[200px]">
              <table className="w-full text-xs table-fixed">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr className="border-b border-gray-200">
                    <th className="text-center py-1.5 px-1 font-medium text-gray-500 w-[44px] bg-gray-50">#</th>
                    <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[24%] bg-gray-50">보험코드</th>
                    <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[18%] bg-gray-50">제약사</th>
                    <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 bg-gray-50">제품명</th>
                    <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[14%] bg-gray-50">수량</th>
                    <th className="py-1.5 px-1 w-[34px] bg-gray-50"></th>
                  </tr>
                </thead>
                <tbody>
                  {manualDrugs.length === 0 ? (
                    <tr><td colSpan={5} className="py-10 text-center text-gray-400 text-xs">행 추가를 눌러 직접 입력하거나 처방전을 인식하세요</td></tr>
                  ) : manualDrugs.map((d, i) => {
                    const aiPair = editOcr?.drugs[i];
                    const lowConf = aiPair?.manualCheck;
                    return (
                      <tr key={i} className={`border-b border-gray-100 h-9 ${focusedIdx === i ? "bg-yellow-50" : lowConf ? "bg-red-50/50" : ""}`}>
                        <td className="px-1 align-middle text-center">
                          <select value={i}
                            onChange={(e) => moveManualRow(i, parseInt(e.target.value, 10))}
                            title="행 순서 변경 — 다른 위치 선택 시 이 행이 그 위치로 이동"
                            className="w-full h-7 border border-gray-300 rounded px-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer">
                            {manualDrugs.map((_, j) => (
                              <option key={j} value={j}>{j + 1}{j === i ? "" : ` ↩`}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 align-middle">
                          <input value={d.insuranceCode}
                            ref={(el) => { manualInputRefs.current[`${i}:insuranceCode`] = el; }}
                            onFocus={() => handleManualFocus(i)}
                            onKeyDown={(e) => handleManualKey(e, i, "insuranceCode")}
                            onChange={(e) => updateManualField(i, "insuranceCode", e.target.value.replace(/\D/g, "").slice(0, 9))}
                            onBlur={() => lookupByInsuranceCode(i)}
                            placeholder="9자리"
                            className={`w-full h-7 border rounded px-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 ${d.matchedMedicationId ? "border-green-300 bg-green-50" : "border-gray-300"}`} />
                        </td>
                        <td className="px-1 align-middle">
                          <input value={d.companyName}
                            ref={(el) => { manualInputRefs.current[`${i}:companyName`] = el; }}
                            onFocus={() => handleManualFocus(i)}
                            onKeyDown={(e) => handleManualKey(e, i, "companyName")}
                            onChange={(e) => updateManualField(i, "companyName", e.target.value)}
                            placeholder="제약사"
                            className="w-full h-7 border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                        <td className="px-1 align-middle">
                          <div className="relative">
                            <input value={d.productName}
                              ref={(el) => { manualInputRefs.current[`${i}:productName`] = el; }}
                              onFocus={() => { handleManualFocus(i); setAutocompleteIdx(i); }}
                              onBlur={(e) => {
                                const next = e.relatedTarget as HTMLElement | null;
                                if (next?.closest?.("[data-ac-dropdown]")) return;
                                window.setTimeout(() => { setAutocompleteIdx((cur) => (cur === i ? null : cur)); }, 200);
                              }}
                              onKeyDown={(e) => handleManualKey(e, i, "productName")}
                              onChange={(e) => { updateManualField(i, "productName", e.target.value); setAutocompleteIdx(i); }}
                              placeholder="제품명"
                              className="w-full h-7 border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400" />
                            {autocompleteIdx === i && autocompleteOptions.length > 0 && (
                              <div data-ac-dropdown className="absolute z-40 left-0 right-0 top-full mt-0.5 bg-white border border-gray-300 rounded shadow-lg max-h-56 overflow-y-auto">
                                {autocompleteOptions.map((opt, j) => (
                                  <button key={opt.id} type="button"
                                    onMouseDown={(e) => { e.preventDefault(); applyAutocomplete(i, opt); }}
                                    className={`block w-full text-left px-2 py-1 text-[11px] border-b border-gray-100 last:border-b-0 ${j === autocompleteFocus ? "bg-blue-100" : "hover:bg-blue-50"}`}>
                                    <div className="font-medium text-gray-900 truncate">{opt.productName}</div>
                                    <div className="text-gray-500 text-[10px] truncate">
                                      {opt.companyName || "-"} · {opt.price ? `${opt.price.toLocaleString()}원` : "단가-"} · {opt.insuranceCode || "코드없음"}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-1 align-middle">
                          <input value={d.quantity}
                            ref={(el) => { manualInputRefs.current[`${i}:quantity`] = el; }}
                            onFocus={() => handleManualFocus(i)}
                            onKeyDown={(e) => handleManualKey(e, i, "quantity")}
                            onChange={(e) => updateManualField(i, "quantity", e.target.value)}
                            placeholder="0"
                            className="w-full h-7 border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                        <td className="px-1 align-middle text-center">
                          <button onClick={() => removeManualRow(i)}
                            className="text-gray-400 hover:text-red-600" title="행 삭제">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-gray-400">
                ← 왼쪽 OCR 결과와 행 단위로 매칭됩니다. 보험코드 9자리 입력 후 포커스 이동 시 마스터 DB에서 제품명·제약사·단가 자동 채움.
              </p>
            </div>
          </div>
        </div>
        </>}
      </div>

      {/* 신규 거래처 등록 모달 */}
      {regOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">신규 거래처 가등록</h2>
              <button onClick={() => { setRegOpen(false); setRegError(""); }} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">거래처명 (병원명)</label>
                <Input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="예: 서울내과의원" className="h-9 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">사업자번호</label>
                <Input value={regBizNum} onChange={(e) => setRegBizNum(e.target.value)} placeholder="예: 123-45-67890" className="h-9 text-sm" />
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
                <span className="font-semibold">가등록</span>으로 저장되며, 관리자 승인 전까지 통계는 정산서에 반영되지 않습니다.
              </div>
              {regError && <p className="text-xs text-red-500">{regError}</p>}
              <div className="flex gap-2 pt-1">
                <Button onClick={registerClient} disabled={regLoading} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm">
                  {regLoading ? "등록 중..." : "가등록 완료"}
                </Button>
                <Button variant="outline" onClick={() => { setRegOpen(false); setRegError(""); }} className="flex-1 text-sm">취소</Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {pendingScanFile && (
        <DocumentScanner
          file={pendingScanFile}
          onConfirm={(corrected) => { setPendingScanFile(null); handleFile(corrected); }}
          onSkip={() => { const f = pendingScanFile; setPendingScanFile(null); if (f) handleFile(f); }}
          onCancel={() => setPendingScanFile(null)}
        />
      )}
      {cameraOpen && (
        <CameraCapture
          onCapture={(f) => { setCameraOpen(false); setOriginalImageFile(f); setPendingScanFile(f); }}
          onCancel={() => setCameraOpen(false)}
          onUnsupported={() => { setCameraOpen(false); cameraInputRef.current?.click(); }}
        />
      )}
    </RequireRole>
  );
}
