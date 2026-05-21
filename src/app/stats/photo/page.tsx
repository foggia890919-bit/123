"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Upload, CheckCircle, AlertCircle, AlertTriangle, ExternalLink, Plus, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

// 영업사원이 보낸 EMR 처방통계 사진을 Gemini 3.5 가 사람처럼 직접 읽고 5컬럼만 표시.
// 검수 후 "최종 승인" 시 영업실적 DB + 구글 시트 동시 저장.
// 효능/카테고리/단가/기간 등 풀 데이터는 시트에만, 영업실적 DB 는 핵심 5컬럼만.

interface UserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  approved: boolean;
}

interface FusionField { value: string; confidence: number }

interface FusionDrug {
  insuranceCode: FusionField;
  companyName: FusionField;
  productName: FusionField;
  quantity: FusionField;
  unitPrice: number | null;
}

interface RxDrugRow {
  name: string;
  code: string;
  quantity: number;
  prescriptions: number;
  unitPrice: number;
  totalPrice: number;
  category: string;
  efficacy: string;
}

interface OcrResponse {
  drugs: FusionDrug[];
  hospitalName: FusionField;
  partialExtraction: { detected: number; extracted: number } | null;
  rawDrugs: RxDrugRow[];
  rawGeminiText: string;
  geminiMeta: {
    pharma: string;
    period: string;
    periodRaw: string;
    summary: { drugCount: number; totalPrescriptions: number; totalQuantity: number; totalAmountWon: number };
    durationMs: number;
    model: string;
  };
  error?: string;
}

interface EditRow {
  insuranceCode: string;
  companyName: string;
  productName: string;
  quantity: string;
  unitPrice: number;
  totalPrice: number;
  totalPriceManual: boolean;        // true = 사용자가 수동 편집 → 자동 재계산 비활성화
}

interface FinalizeResponse {
  dbRecordId?: string;
  sheetUrl?: string | null;
  sheetBatchId?: string | null;
  sheetWarning?: string | null;
  totalFee?: number;
  rowCount?: number;
  error?: string;
}

// stats/page.tsx 의 동일 함수 — 1600px / JPEG 0.78 로 클라이언트 압축.
// Vercel 4.5MB body limit 우회 + Gemini 비용 절감.
async function compressImage(file: File, maxDim = 1600, quality = 0.78): Promise<Blob> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
  const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("canvas blob 실패"))), "image/jpeg", quality),
  );
}

async function fileToDataUri(file: File | Blob): Promise<string> {
  return await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export default function StatsPhotoPage() {
  const { data: session } = useSession();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [clients, setClients] = useState<UserClient[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientQuery, setClientQuery] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [ocr, setOcr] = useState<OcrResponse | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<FinalizeResponse | null>(null);
  const [error, setError] = useState<string>("");

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/user-clients?userId=${session.user.id}`)
      .then((r) => r.json())
      .then((data) => Array.isArray(data) ? setClients(data) : setClients([]))
      .catch(() => setClients([]));
  }, [session?.user?.id]);

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return clients.slice(0, 20);
    return clients.filter((c) => c.clientName.toLowerCase().includes(q) || c.bizNumber.includes(q)).slice(0, 20);
  }, [clientQuery, clients]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  function pickFile(f: File | null) {
    setFile(f);
    setOcr(null);
    setRows([]);
    setSaved(null);
    setError("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  async function handleAnalyze() {
    if (!file) return;
    setAnalyzing(true);
    setError("");
    setOcr(null);
    setSaved(null);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.append("image", compressed, "rx.jpg");
      const res = await fetch("/api/stats/ocr", { method: "POST", body: fd });
      const data = await res.json() as OcrResponse;
      if (!res.ok || data.error) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setOcr(data);
      // 5컬럼 EditRow 초기화. 매출금액 = quantity × unitPrice 자동 계산.
      setRows(data.drugs.map((d) => {
        const qty = parseFloat(d.quantity.value) || 0;
        const unit = d.unitPrice || 0;
        return {
          insuranceCode: d.insuranceCode.value,
          companyName: d.companyName.value,
          productName: d.productName.value,
          quantity: d.quantity.value,
          unitPrice: unit,
          totalPrice: qty * unit,
          totalPriceManual: false,
        };
      }));
    } catch (e) {
      setError(`분석 실패: ${String(e).slice(0, 300)}`);
    } finally {
      setAnalyzing(false);
    }
  }

  function updateRow(i: number, patch: Partial<EditRow>) {
    setRows((prev) => prev.map((r, idx) => {
      if (idx !== i) return r;
      const next: EditRow = { ...r, ...patch };
      // 사용자가 totalPrice 직접 입력하지 않으면 자동 재계산
      if (!next.totalPriceManual && (patch.quantity !== undefined || patch.unitPrice !== undefined)) {
        const qty = parseFloat(next.quantity) || 0;
        next.totalPrice = Math.round(qty * next.unitPrice);
      }
      return next;
    }));
  }

  function addRow() {
    setRows((prev) => [...prev, {
      insuranceCode: "", companyName: "", productName: "", quantity: "0",
      unitPrice: 0, totalPrice: 0, totalPriceManual: false,
    }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleFinalize() {
    if (!ocr || !file || rows.length === 0) return;
    if (!selectedClientId) {
      setError("거래처를 먼저 선택하세요");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const compressed = await compressImage(file);
      const imageBase64 = await fileToDataUri(compressed);
      const body = {
        clientId: selectedClientId,
        year,
        month,
        hospitalName: selectedClient?.clientName ?? ocr.hospitalName.value,
        companyName: ocr.geminiMeta.pharma,
        imageBase64,
        rows: rows.map((r) => ({
          insuranceCode: r.insuranceCode,
          companyName: r.companyName,
          productName: r.productName,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          totalPrice: r.totalPrice,
        })),
        rawDrugs: ocr.rawDrugs,
        geminiMeta: ocr.geminiMeta,
        rawGeminiText: ocr.rawGeminiText,
      };
      const res = await fetch("/api/stats/photo-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as FinalizeResponse;
      if (!res.ok || data.error) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setSaved(data);
    } catch (e) {
      setError(`저장 실패: ${String(e).slice(0, 300)}`);
    } finally {
      setSaving(false);
    }
  }

  const totalRevenue = rows.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-orange-500" />
        <h1 className="text-2xl font-bold text-gray-900">AI 처방통계 등록</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-2">
        Gemini 멀티모달이 사진을 사람처럼 직접 읽어 보험코드·제약사·제품명·수량·매출금액 5개 정보만
        깔끔하게 추출합니다. 검수 후 최종 승인하면 영업실적 DB + 구글 시트에 동시 저장.
        OCR 사전처리 없음 — 비스듬한 사진/모니터 반사에 강건.
      </p>

      {/* 상단: 처방 기간 + 거래처 선택 + 사진 업로드 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500">처방년도</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}
              className="mt-1 w-full border rounded px-3 py-2 text-sm">
              {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">처방월</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
              className="mt-1 w-full border rounded px-3 py-2 text-sm">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">병원 (거래처)</label>
            <input
              type="text"
              value={selectedClient ? selectedClient.clientName : clientQuery}
              onChange={(e) => { setClientQuery(e.target.value); setSelectedClientId(""); }}
              placeholder="검색..."
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            />
            {!selectedClientId && clientQuery && filteredClients.length > 0 && (
              <div className="absolute mt-1 bg-white border rounded shadow-lg max-h-48 overflow-y-auto z-10 w-64">
                {filteredClients.map((c) => (
                  <button key={c.id}
                    onClick={() => { setSelectedClientId(c.id); setClientQuery(c.clientName); }}
                    className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50">
                    {c.clientName}
                    {!c.approved && <span className="ml-2 text-[10px] text-amber-600">(승인전)</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 사진 업로드 */}
        <label
          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-md py-10 cursor-pointer hover:bg-gray-50 transition-colors"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f && f.type.startsWith("image/")) pickFile(f);
          }}
        >
          <Upload className="w-8 h-8 text-gray-400" />
          <span className="text-sm text-gray-600">
            {file ? file.name : "처방통계 사진을 클릭 또는 드래그해서 업로드"}
          </span>
          {file && <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>}
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        </label>

        {previewUrl && (
          <div className="border rounded overflow-hidden bg-gray-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="preview" className="max-h-72 mx-auto" />
          </div>
        )}

        <Button onClick={handleAnalyze} disabled={!file || analyzing} className="w-full">
          {analyzing ? "분석 중... (Gemini 3.5, 30~60초)" : "사진 분석 시작"}
        </Button>
      </div>

      {/* 분석 결과 — 5컬럼 검수 표 */}
      {ocr && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-sm font-semibold text-gray-800">분석 완료 — 검수 후 최종 승인</span>
            <span className="text-[11px] text-gray-500">{ocr.geminiMeta.model} · {(ocr.geminiMeta.durationMs / 1000).toFixed(1)}s</span>
            <span className="text-[11px] text-gray-500 ml-auto">총 매출 <strong className="text-gray-800">{totalRevenue.toLocaleString()}원</strong></span>
          </div>

          {ocr.partialExtraction && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-800">
                <span className="font-semibold">부분 추출 감지</span> — 사진의 약품수 ({ocr.partialExtraction.detected}건) 와 추출된 행 수 ({ocr.partialExtraction.extracted}건) 가 다릅니다.
                일부 행이 누락됐을 수 있어요 — 행 추가로 수동 입력하거나 더 선명한 사진으로 재시도.
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 w-[18%]">보험코드</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500 w-[18%]">제약사</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">제품명</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500 w-[10%]">수량</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500 w-[14%]">매출금액</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t hover:bg-gray-50">
                    <td className="px-2 py-1">
                      <input value={r.insuranceCode} onChange={(e) => updateRow(i, { insuranceCode: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-[11px] font-mono"/>
                    </td>
                    <td className="px-2 py-1">
                      <input value={r.companyName} onChange={(e) => updateRow(i, { companyName: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-[11px]"/>
                    </td>
                    <td className="px-2 py-1">
                      <input value={r.productName} onChange={(e) => updateRow(i, { productName: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-[11px]"/>
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" step="0.1" value={r.quantity} onChange={(e) => updateRow(i, { quantity: e.target.value })}
                        className="w-full px-2 py-1 border rounded text-[11px] text-right"/>
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={r.totalPrice}
                        onChange={(e) => updateRow(i, { totalPrice: Number(e.target.value), totalPriceManual: true })}
                        className="w-full px-2 py-1 border rounded text-[11px] text-right"/>
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500" title="행 삭제">
                        <Trash2 className="w-3.5 h-3.5"/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t px-4 py-3 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addRow} className="text-xs">
              <Plus className="w-3.5 h-3.5 mr-1"/>행 추가
            </Button>
            <span className="text-[11px] text-gray-400 ml-2">
              매출금액은 수량 × 단가 자동 계산. 직접 입력 시 자동 계산 해제.
            </span>
            <Button onClick={handleFinalize} disabled={saving || !selectedClientId}
              className="ml-auto bg-orange-600 hover:bg-orange-700">
              {saving ? "저장 중..." : "최종 승인 (DB + 시트 저장)"}
            </Button>
          </div>
        </div>
      )}

      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2 text-green-800 font-semibold">
            <CheckCircle className="w-5 h-5" />
            저장 완료 — 영업실적 DB + 구글 시트
          </div>
          <div className="text-xs text-green-700 space-y-1">
            <div>약품 행 {saved.rowCount}건 · 매출 합계 <strong>{saved.totalFee?.toLocaleString()}원</strong></div>
            {saved.sheetUrl && (
              <a href={saved.sheetUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                구글 시트에서 보기 <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {saved.sheetBatchId && <div className="text-[10px] text-gray-500">batchId: <code>{saved.sheetBatchId}</code></div>}
            {saved.sheetWarning && (
              <div className="text-amber-700 mt-2 p-2 bg-amber-50 rounded border border-amber-200">
                ⚠ {saved.sheetWarning} (DB 저장은 완료. 관리자에게 알려주세요.)
              </div>
            )}
            <div className="text-[11px] text-gray-500 pt-1">
              영업실적 관리(<a href="/mypage/performance" className="text-blue-600 hover:underline">mypage/performance</a>)
              에서 이 기록을 조회할 수 있습니다.
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}
    </div>
  );
}
