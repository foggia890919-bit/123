"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Upload, ZoomIn, ZoomOut, Maximize2, Minimize2, AlertTriangle, CheckCircle, BarChart3, UserPlus, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RequireAuth from "@/components/RequireAuth";

interface OcrField { value: string; confidence: number }
interface DrugItem {
  name: OcrField; code: OcrField; quantity: OcrField; price: OcrField;
}
interface OcrResult {
  hospitalName: OcrField; institutionCode: OcrField;
  prescriptionDate: OcrField; patientName: OcrField;
  drugs: DrugItem[]; avgConfidence: number;
}
interface UserClient {
  id: string; clientName: string; bizNumber: string; approved: boolean;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 줌
  const [zoomLevel, setZoomLevel] = useState(100);
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);

  // OCR
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const [editOcr, setEditOcr] = useState<OcrResult | null>(null);

  // 제출
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // 거래처 목록 불러오기
  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/user-clients?userId=${session.user.id}`)
      .then((r) => r.json())
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch(() => setClients([]));
  }, [session]);

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
    setImageUrl(URL.createObjectURL(file));
    const reader = new FileReader();
    reader.onload = (e) => setImageBase64(e.target?.result as string);
    reader.readAsDataURL(file);
    setOcr(null); setEditOcr(null);
    setZoomEnabled(false); setIsZoomed(false); setZoomLevel(100);
    setSubmitted(false); setSubmitError("");
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  }

  async function runOcr() {
    if (!imageFile) return;
    setOcrLoading(true); setOcrError("");
    try {
      const fd = new FormData();
      fd.append("image", imageFile);
      const res = await fetch("/api/stats/ocr", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOcr(data);
      setEditOcr(JSON.parse(JSON.stringify(data)));
      setZoomEnabled(true);
      // OCR에서 병원명 인식됐고 아직 선택 안 했으면 자동으로 쿼리 채우기
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
    if (!zoomEnabled) return;
    if (isZoomed) { setZoomLevel(100); setIsZoomed(false); }
    else { setZoomLevel(200); setIsZoomed(true); }
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
  const isClientUnnapproved = selectedClient !== null && !selectedClient.approved;

  async function handleSubmit() {
    if (!session?.user?.id || !editOcr) return;
    setSubmitting(true); setSubmitError("");
    try {
      const res = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session.user.id,
          clientId: selectedClient?.id || null,
          year: parseInt(year), month: parseInt(month),
          hospitalName: selectedClient?.clientName || hospitalQuery || editOcr.hospitalName.value,
          companyName: company,
          imageData: imageBase64,
          ocrData: editOcr,
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
    <RequireAuth>
      <div className="space-y-4">
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

            {/* 병원 자동완성 */}
            <div className="flex-1 min-w-52" ref={hospitalRef}>
              <label className="text-xs font-medium text-gray-600 mb-1 block">병원 (거래처)</label>
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
                  {showDropdown && (
                    <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                      {filteredClients.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-4">검색 결과 없음</p>
                      ) : (
                        filteredClients.map((c) => (
                          <button key={c.id} type="button" onClick={() => selectClient(c)}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                              <p className="text-xs text-gray-400">{c.bizNumber}</p>
                            </div>
                            {c.approved
                              ? <span className="text-[10px] bg-green-100 text-green-700 border border-green-300 rounded px-1.5 py-0.5 shrink-0">승인완료</span>
                              : <span className="text-[10px] bg-yellow-100 text-yellow-700 border border-yellow-300 rounded px-1.5 py-0.5 shrink-0">승인전</span>
                            }
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {/* 신규 거래처 등록 버튼 */}
                <button type="button" onClick={() => { setRegOpen(true); setRegName(hospitalQuery); }}
                  className="h-9 px-2.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 shrink-0"
                  title="신규 거래처 등록">
                  <UserPlus className="w-4 h-4" />
                </button>
              </div>
              {/* 선택된 거래처 배지 */}
              {selectedClient && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-xs text-gray-600">{selectedClient.clientName}</span>
                  {selectedClient.approved
                    ? <span className="text-[10px] bg-green-100 text-green-700 border border-green-300 rounded px-1.5 py-0.5">승인완료</span>
                    : <span className="text-[10px] bg-yellow-100 text-yellow-700 border border-yellow-300 rounded px-1.5 py-0.5">승인전</span>
                  }
                </div>
              )}
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

        {/* 메인 split view */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 왼쪽: 이미지 */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
            {imageUrl && (
              <div className="border-b border-gray-100 px-3 py-2 flex items-center gap-2 bg-gray-50">
                <button onClick={() => { setZoomLevel(100); setIsZoomed(false); }}
                  className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 font-mono">1:1</button>
                <button onClick={() => { setZoomLevel(100); setIsZoomed(false); }}
                  className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100">Fit</button>
                <button onClick={() => setZoomLevel((z) => Math.min(z + 25, 400))}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-100">
                  <ZoomIn className="w-3.5 h-3.5" /></button>
                <button onClick={() => setZoomLevel((z) => Math.max(z - 25, 25))}
                  className="w-6 h-6 flex items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-100">
                  <ZoomOut className="w-3.5 h-3.5" /></button>
                <span className="text-xs text-gray-500 font-mono">{zoomLevel}%</span>
                {ocr && (
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-gray-600">클릭 확대</span>
                    <button onClick={() => { setZoomEnabled((v) => !v); if (isZoomed) { setIsZoomed(false); setZoomLevel(100); } }}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${zoomEnabled ? "bg-blue-500" : "bg-gray-300"}`}>
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${zoomEnabled ? "translate-x-4" : "translate-x-1"}`} />
                    </button>
                    <span className="text-[10px] text-gray-500">
                      {zoomEnabled ? (isZoomed ? <Minimize2 className="w-3 h-3 inline text-blue-500" /> : <Maximize2 className="w-3 h-3 inline text-blue-500" />) : null}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="flex-1 overflow-auto min-h-64">
              {imageUrl ? (
                <div onClick={handleImageClick} style={{ minHeight: 300 }}
                  className={`w-full h-full flex items-start justify-center p-2 ${zoomEnabled ? (isZoomed ? "cursor-zoom-out" : "cursor-zoom-in") : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt="처방전"
                    style={{ width: `${zoomLevel}%`, transition: "width 0.2s ease", maxWidth: "none" }}
                    className="rounded object-contain" draggable={false} />
                </div>
              ) : (
                <div onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="h-full min-h-64 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-blue-50 transition-colors m-4 border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-lg">
                  <Upload className="w-10 h-10 text-gray-300" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-600">처방전 이미지 업로드</p>
                    <p className="text-xs text-gray-400 mt-1">클릭하거나 드래그하여 파일 선택</p>
                  </div>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
            <div className="border-t border-gray-100 p-3 flex gap-2 items-center">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="text-xs">
                <Upload className="w-3.5 h-3.5 mr-1" />파일 선택
              </Button>
              {imageUrl && (
                <Button type="button" size="sm" onClick={runOcr} disabled={ocrLoading}
                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white">
                  <BarChart3 className="w-3.5 h-3.5 mr-1" />{ocrLoading ? "인식 중..." : "처방전 인식"}
                </Button>
              )}
              {ocrError && <p className="text-xs text-red-500 flex-1">{ocrError}</p>}
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
                <div className="border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-semibold bg-yellow-100 text-yellow-700 border border-yellow-300 px-2 py-0.5 rounded">PENDING_REVIEW</span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">평균 신뢰도 <strong>{editOcr.avgConfidence}%</strong></span>
                  {isClientUnnapproved && (
                    <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-300 px-2 py-0.5 rounded font-semibold">정산서 미반영</span>
                  )}
                  <span className="ml-auto text-sm font-semibold text-gray-700">수수료 합계 <span className="text-blue-600">{totalFee.toLocaleString()}원</span></span>
                </div>
                <div className="px-4 py-2 flex items-center gap-2 text-[10px] border-b border-gray-50">
                  <span className="px-1.5 py-0.5 rounded border bg-green-100 text-green-700 border-green-300">90%+ 안전</span>
                  <span className="px-1.5 py-0.5 rounded border bg-yellow-100 text-yellow-700 border-yellow-300">75~89% 주의</span>
                  <span className="px-1.5 py-0.5 rounded border bg-red-100 text-red-700 border-red-300">75% 미만 필수검토</span>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">기본 정보</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { label: "병원명", key: "hospitalName" as const },
                        { label: "요양기관번호", key: "institutionCode" as const },
                        { label: "처방일", key: "prescriptionDate" as const },
                        { label: "환자명", key: "patientName" as const },
                      ]).map(({ label, key }) => {
                        const field = editOcr[key] as OcrField;
                        return (
                          <div key={key}>
                            <div className="flex items-center gap-1 mb-1">
                              <span className="text-[10px] text-gray-500">{label}</span>
                              <span className={`text-[10px] px-1 py-0.5 rounded border font-medium ${confColor(field.confidence)}`}>{field.confidence}%</span>
                            </div>
                            <input value={field.value} onChange={(e) => updateField(key, e.target.value)}
                              className={`w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 ${inputColor(field.confidence)}`} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
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
                                <td className="py-1.5 pr-2"><input value={drug.name.value} onChange={(e) => updateDrugField(i, "name", e.target.value)} className={`w-full border rounded px-1.5 py-1 focus:outline-none focus:ring-1 text-xs ${inputColor(drug.name.confidence)}`} /></td>
                                <td className="py-1.5 pr-2"><input value={drug.code.value} onChange={(e) => updateDrugField(i, "code", e.target.value)} className={`w-full border rounded px-1.5 py-1 focus:outline-none focus:ring-1 text-xs ${inputColor(drug.code.confidence)}`} placeholder="코드 없음" /></td>
                                <td className="py-1.5 pr-2"><input value={drug.quantity.value} onChange={(e) => updateDrugField(i, "quantity", e.target.value)} className={`w-full border rounded px-1.5 py-1 focus:outline-none focus:ring-1 text-xs ${inputColor(drug.quantity.confidence)}`} /></td>
                                <td className="py-1.5 pr-2"><input value={drug.price.value} onChange={(e) => updateDrugField(i, "price", e.target.value)} className={`w-full border rounded px-1.5 py-1 focus:outline-none focus:ring-1 text-xs ${inputColor(drug.price.confidence)}`} /></td>
                                <td className="py-1.5"><span className={`px-1.5 py-0.5 rounded border font-medium ${confColor(minConf)}`}>{minConf}%</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {lowConfItems.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-700">
                        <span className="font-semibold">빨간색 항목은 OCR 신뢰도 75% 미만입니다.</span>
                        {" "}{lowConfItems.map((d, i) => `${d.name.value}(${d.code.confidence}%)`).join(", ")}를 원본 이미지와 반드시 대조하세요.
                      </p>
                    </div>
                  )}
                </div>
                <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-400">예상 총 수수료</p>
                    <p className="text-lg font-bold text-gray-900">{totalFee.toLocaleString()}원</p>
                    {isClientUnnapproved && <p className="text-[10px] text-yellow-600 font-medium">정산서 미반영 (승인전)</p>}
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
              </>
            )}
          </div>
        </div>
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
    </RequireAuth>
  );
}
