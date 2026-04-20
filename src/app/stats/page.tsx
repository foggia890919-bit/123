"use client";

import { useState, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Upload, ZoomIn, ZoomOut, Maximize2, Minimize2, AlertTriangle, CheckCircle, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RequireAuth from "@/components/RequireAuth";

interface OcrField { value: string; confidence: number }
interface DrugItem {
  name: OcrField;
  code: OcrField;
  quantity: OcrField;
  price: OcrField;
}
interface OcrResult {
  hospitalName: OcrField;
  institutionCode: OcrField;
  prescriptionDate: OcrField;
  patientName: OcrField;
  drugs: DrugItem[];
  avgConfidence: number;
}

function confColor(c: number) {
  if (c >= 90) return "bg-green-100 text-green-700 border-green-300";
  if (c >= 75) return "bg-yellow-100 text-yellow-700 border-yellow-300";
  return "bg-red-100 text-red-700 border-red-300";
}
function inputColor(c: number) {
  if (c >= 90) return "border-green-300 bg-green-50 focus:ring-green-400";
  if (c >= 75) return "border-yellow-300 bg-yellow-50 focus:ring-yellow-400";
  return "border-red-300 bg-red-50 focus:ring-red-400";
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function StatsPage() {
  const { data: session } = useSession();

  // form
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [hospital, setHospital] = useState("");
  const [company, setCompany] = useState("");

  // image
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // zoom
  const [zoomLevel, setZoomLevel] = useState(100);
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);

  // ocr
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState("");

  // submit
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // editable ocr fields
  const [editOcr, setEditOcr] = useState<OcrResult | null>(null);

  const handleFile = useCallback((file: File) => {
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    const reader = new FileReader();
    reader.onload = (e) => setImageBase64(e.target?.result as string);
    reader.readAsDataURL(file);
    setOcr(null);
    setEditOcr(null);
    setZoomEnabled(false);
    setIsZoomed(false);
    setZoomLevel(100);
    setSubmitted(false);
    setSubmitError("");
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  }

  async function runOcr() {
    if (!imageFile) return;
    setOcrLoading(true);
    setOcrError("");
    try {
      const fd = new FormData();
      fd.append("image", imageFile);
      const res = await fetch("/api/stats/ocr", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOcr(data);
      setEditOcr(JSON.parse(JSON.stringify(data)));
      setZoomEnabled(true);
    } catch (e) {
      setOcrError(String(e));
    } finally {
      setOcrLoading(false);
    }
  }

  function handleImageClick() {
    if (!zoomEnabled) return;
    if (isZoomed) {
      setZoomLevel(100);
      setIsZoomed(false);
    } else {
      setZoomLevel(200);
      setIsZoomed(true);
    }
  }

  function updateDrugField(idx: number, field: keyof DrugItem, value: string) {
    if (!editOcr) return;
    const drugs = [...editOcr.drugs];
    drugs[idx] = { ...drugs[idx], [field]: { ...drugs[idx][field], value } };
    setEditOcr({ ...editOcr, drugs });
  }
  function updateField(key: keyof OcrResult, value: string) {
    if (!editOcr) return;
    setEditOcr({ ...editOcr, [key]: { ...(editOcr[key] as OcrField), value } });
  }

  const totalFee = editOcr?.drugs.reduce((sum, d) => {
    const qty = parseInt(d.quantity.value) || 0;
    const price = parseInt(d.price.value.replace(/[^0-9]/g, "")) || 0;
    return sum + qty * price;
  }, 0) ?? 0;

  const lowConfItems = editOcr?.drugs.filter((d) => d.name.confidence < 75 || d.code.confidence < 75) ?? [];

  async function handleSubmit() {
    if (!session?.user?.id || !editOcr) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session.user.id,
          year: parseInt(year),
          month: parseInt(month),
          hospitalName: hospital || (editOcr.hospitalName.value ?? ""),
          companyName: company,
          imageData: imageBase64,
          ocrData: editOcr,
          totalFee,
          status: "PENDING_REVIEW",
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

  const zoomIn = () => setZoomLevel((z) => Math.min(z + 25, 400));
  const zoomOut = () => setZoomLevel((z) => Math.max(z - 25, 25));
  const zoomFit = () => { setZoomLevel(100); setIsZoomed(false); };
  const zoom1to1 = () => { setZoomLevel(100); setIsZoomed(false); };

  return (
    <RequireAuth>
      <div className="space-y-4">
        {/* 헤더 */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">처방통계 등록</h1>
          <p className="text-sm text-gray-500 mt-0.5">처방전 이미지를 업로드하면 자동으로 인식합니다</p>
        </div>

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
            <div className="flex-1 min-w-40">
              <label className="text-xs font-medium text-gray-600 mb-1 block">병원</label>
              <Input value={hospital} onChange={(e) => setHospital(e.target.value)}
                placeholder="병원명 입력" className="h-9 text-sm" />
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
        </div>

        {/* 메인 split view */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 왼쪽: 이미지 업로드 & 뷰어 */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
            {/* 이미지 컨트롤 바 */}
            {imageUrl && (
              <div className="border-b border-gray-100 px-3 py-2 flex items-center gap-2 bg-gray-50">
                <button onClick={zoom1to1}
                  className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 font-mono">1:1</button>
                <button onClick={zoomFit}
                  className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100">Fit</button>
                <button onClick={zoomIn}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-100">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button onClick={zoomOut}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-100">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-gray-500 font-mono">{zoomLevel}%</span>

                {/* 클릭 확대 토글 - OCR 완료 후에만 표시 */}
                {ocr && (
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-gray-600">클릭 확대</span>
                    <button
                      onClick={() => { setZoomEnabled((v) => !v); if (isZoomed) { setIsZoomed(false); setZoomLevel(100); } }}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${zoomEnabled ? "bg-blue-500" : "bg-gray-300"}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${zoomEnabled ? "translate-x-4" : "translate-x-1"}`} />
                    </button>
                    {zoomEnabled && (
                      <span className="text-[10px] text-blue-600 font-medium">
                        {isZoomed ? <Minimize2 className="w-3 h-3 inline" /> : <Maximize2 className="w-3 h-3 inline" />}
                        {isZoomed ? " 클릭으로 축소" : " 클릭으로 확대"}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 이미지 영역 */}
            <div className="flex-1 overflow-auto min-h-64 relative">
              {imageUrl ? (
                <div
                  className={`w-full h-full flex items-start justify-center p-2 ${zoomEnabled ? "cursor-zoom-in" : ""} ${isZoomed ? "cursor-zoom-out" : ""}`}
                  onClick={handleImageClick}
                  style={{ minHeight: 300 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt="처방전"
                    style={{ width: `${zoomLevel}%`, transition: "width 0.2s ease", maxWidth: "none" }}
                    className="rounded object-contain"
                    draggable={false}
                  />
                </div>
              ) : (
                <div
                  onDrop={onDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="h-full min-h-64 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-blue-50 transition-colors m-4 border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-lg"
                >
                  <Upload className="w-10 h-10 text-gray-300" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-600">처방전 이미지 업로드</p>
                    <p className="text-xs text-gray-400 mt-1">클릭하거나 드래그하여 파일 선택</p>
                    <p className="text-xs text-gray-400">JPG, PNG, GIF, WEBP</p>
                  </div>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>

            {/* 업로드/OCR 버튼 */}
            <div className="border-t border-gray-100 p-3 flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="text-xs">
                <Upload className="w-3.5 h-3.5 mr-1" />파일 선택
              </Button>
              {imageUrl && (
                <Button type="button" size="sm" onClick={runOcr} disabled={ocrLoading}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white">
                  <BarChart3 className="w-3.5 h-3.5 mr-1" />
                  {ocrLoading ? "인식 중..." : "처방전 인식"}
                </Button>
              )}
              {ocrError && <p className="text-xs text-red-500 self-center">{ocrError}</p>}
            </div>
          </div>

          {/* 오른쪽: OCR 결과 */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col">
            {!editOcr ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-10 text-center">
                <BarChart3 className="w-12 h-12 text-gray-200" />
                <p className="text-sm text-gray-400">처방전을 업로드하고<br />인식 버튼을 누르면 결과가 표시됩니다</p>
              </div>
            ) : (
              <>
                {/* 상단 요약 */}
                <div className="border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-semibold bg-yellow-100 text-yellow-700 border border-yellow-300 px-2 py-0.5 rounded">
                    PENDING_REVIEW
                  </span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    평균 신뢰도 <strong>{editOcr.avgConfidence}%</strong>
                  </span>
                  <span className="ml-auto text-sm font-semibold text-gray-700">
                    수수료 합계 <span className="text-blue-600">{totalFee.toLocaleString()}원</span>
                  </span>
                </div>

                {/* 신뢰도 범례 */}
                <div className="px-4 py-2 flex items-center gap-2 text-[10px] border-b border-gray-50">
                  <span className="px-1.5 py-0.5 rounded border bg-green-100 text-green-700 border-green-300">90%+ 안전</span>
                  <span className="px-1.5 py-0.5 rounded border bg-yellow-100 text-yellow-700 border-yellow-300">75~89% 주의</span>
                  <span className="px-1.5 py-0.5 rounded border bg-red-100 text-red-700 border-red-300">75% 미만 필수검토</span>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                  {/* 기본 정보 */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">기본 정보</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "병원명", key: "hospitalName" as const },
                        { label: "요양기관번호", key: "institutionCode" as const },
                        { label: "처방일", key: "prescriptionDate" as const },
                        { label: "환자명", key: "patientName" as const },
                      ].map(({ label, key }) => {
                        const field = editOcr[key] as OcrField;
                        return (
                          <div key={key}>
                            <div className="flex items-center gap-1 mb-1">
                              <span className="text-[10px] text-gray-500">{label}</span>
                              <span className={`text-[10px] px-1 py-0.5 rounded border font-medium ${confColor(field.confidence)}`}>
                                {field.confidence}%
                              </span>
                            </div>
                            <input
                              value={field.value}
                              onChange={(e) => updateField(key, e.target.value)}
                              className={`w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 ${inputColor(field.confidence)}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 처방 의약품 */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">처방 의약품</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-1.5 pr-2 font-medium text-gray-500 w-32">약품명</th>
                            <th className="text-left py-1.5 pr-2 font-medium text-gray-500 w-24">약품코드</th>
                            <th className="text-left py-1.5 pr-2 font-medium text-gray-500 w-12">수량</th>
                            <th className="text-left py-1.5 pr-2 font-medium text-gray-500 w-16">단가</th>
                            <th className="text-left py-1.5 font-medium text-gray-500 w-16">신뢰도</th>
                          </tr>
                        </thead>
                        <tbody>
                          {editOcr.drugs.map((drug, i) => {
                            const minConf = Math.min(drug.name.confidence, drug.code.confidence, drug.quantity.confidence, drug.price.confidence);
                            return (
                              <tr key={i} className="border-b border-gray-50">
                                <td className="py-1.5 pr-2">
                                  <input value={drug.name.value}
                                    onChange={(e) => updateDrugField(i, "name", e.target.value)}
                                    className={`w-full border rounded px-1.5 py-1 focus:outline-none focus:ring-1 text-xs ${inputColor(drug.name.confidence)}`} />
                                </td>
                                <td className="py-1.5 pr-2">
                                  <input value={drug.code.value}
                                    onChange={(e) => updateDrugField(i, "code", e.target.value)}
                                    className={`w-full border rounded px-1.5 py-1 focus:outline-none focus:ring-1 text-xs ${inputColor(drug.code.confidence)}`}
                                    placeholder="코드 없음" />
                                </td>
                                <td className="py-1.5 pr-2">
                                  <input value={drug.quantity.value}
                                    onChange={(e) => updateDrugField(i, "quantity", e.target.value)}
                                    className={`w-full border rounded px-1.5 py-1 focus:outline-none focus:ring-1 text-xs ${inputColor(drug.quantity.confidence)}`} />
                                </td>
                                <td className="py-1.5 pr-2">
                                  <input value={drug.price.value}
                                    onChange={(e) => updateDrugField(i, "price", e.target.value)}
                                    className={`w-full border rounded px-1.5 py-1 focus:outline-none focus:ring-1 text-xs ${inputColor(drug.price.confidence)}`} />
                                </td>
                                <td className="py-1.5">
                                  <span className={`px-1.5 py-0.5 rounded border font-medium ${confColor(minConf)}`}>{minConf}%</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 경고 */}
                  {lowConfItems.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <div className="text-xs text-red-700">
                        <p className="font-semibold mb-1">빨간색 항목은 OCR 신뢰도 75% 미만입니다.</p>
                        <p>
                          특히 {lowConfItems.map((d, i) => (
                            <span key={i}>{d.name.value} 약품코드({d.code.confidence}%){i < lowConfItems.length - 1 ? ", " : ""}</span>
                          ))}를 원본 이미지와 반드시 대조하세요.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* 하단 제출 */}
                <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-400">예상 총 수수료</p>
                    <p className="text-lg font-bold text-gray-900">{totalFee.toLocaleString()}원</p>
                  </div>
                  {submitted ? (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="w-5 h-5" />
                      <span className="text-sm font-semibold">제출 완료</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-1">
                      {submitError && <p className="text-xs text-red-500">{submitError}</p>}
                      <Button onClick={handleSubmit} disabled={submitting}
                        className="bg-gray-900 hover:bg-gray-700 text-white">
                        {submitting ? "제출 중..." : "최종 승인"}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
