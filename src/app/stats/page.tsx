"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Upload, ZoomIn, ZoomOut, Maximize2, Minimize2, AlertTriangle, CheckCircle, BarChart3, UserPlus, X, Search, ArrowRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RequireRole from "@/components/RequireRole";

interface OcrField { value: string; confidence: number }
interface FusionDrug {
  insuranceCode: OcrField;
  companyName: OcrField;
  productName: OcrField;
  quantity: OcrField;
  unitPrice: number | null;
  matchedMedicationId: string | null;
  finalConfidence: number;
  manualCheck: boolean;
  bboxYPercent: number | null;
}
interface OcrResult {
  source: string;
  drugs: FusionDrug[];
  avgConfidence: number;
  manualCheckCount: number;
  rawClovaText?: string;
  rawGeminiText?: string;
  hospitalName: OcrField;
}
interface ManualDrug {
  insuranceCode: string;
  companyName: string;
  productName: string;
  quantity: string;
  unitPrice: number | null;
  matchedMedicationId: string | null;
}
interface UserClient {
  id: string; clientName: string; bizNumber: string; approved: boolean;
}

function emptyManualDrug(): ManualDrug {
  return { insuranceCode: "", companyName: "", productName: "", quantity: "", unitPrice: null, matchedMedicationId: null };
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
  const imageScrollRef = useRef<HTMLDivElement>(null);
  const imageElRef = useRef<HTMLImageElement>(null);
  const manualInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

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
    setManualDrugs([emptyManualDrug()]);
    setZoomEnabled(false); setIsZoomed(false); setZoomLevel(100);
    setSubmitted(false); setSubmitError("");
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  }

  async function compressImage(file: File, maxDim = 2000, quality = 0.82): Promise<Blob> {
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
    setOcrLoading(true); setOcrError("");
    try {
      const compressed = await compressImage(imageFile);
      const fd = new FormData();
      fd.append("image", compressed, "prescription.jpg");
      const res = await fetch("/api/stats/ocr", { method: "POST", body: fd });
      const text = await res.text();
      let data: { error?: string } & OcrResult;
      try { data = JSON.parse(text); }
      catch { throw new Error(`서버 응답 오류 (${res.status}): ${text.slice(0, 200)}`); }
      if (data.error) throw new Error(data.error);
      setOcr(data);
      setEditOcr(JSON.parse(JSON.stringify(data)));
      // OCR 모든 행을 오른쪽 확정창에 1:1 페어링 (사람이 검토 후 수정)
      const paired: ManualDrug[] = (data.drugs ?? []).map((d) => ({
        insuranceCode: d.insuranceCode.value,
        companyName: d.companyName.value,
        productName: d.productName.value,
        quantity: d.quantity.value,
        unitPrice: d.unitPrice,
        matchedMedicationId: d.matchedMedicationId,
      }));
      setManualDrugs(paired.length ? paired : [emptyManualDrug()]);
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
    if (!zoomEnabled) return;
    if (isZoomed) { setZoomLevel(100); setIsZoomed(false); }
    else { setZoomLevel(200); setIsZoomed(true); }
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

  // 행/필드에 포커스 들어오면 이미지를 해당 약품의 Y 위치로 스크롤
  function handleManualFocus(idx: number) {
    setFocusedIdx(idx);
    const yPercent = editOcr?.drugs[idx]?.bboxYPercent ?? null;
    const scrollEl = imageScrollRef.current;
    const imgEl = imageElRef.current;
    if (!scrollEl || !imgEl) return;
    if (yPercent != null) {
      const targetY = (imgEl.clientHeight * yPercent) / 100;
      scrollEl.scrollTo({ top: Math.max(0, targetY - scrollEl.clientHeight / 2), behavior: "smooth" });
    } else if (editOcr?.drugs.length) {
      // bbox 없으면 행 인덱스 비례로 스크롤 (위→아래 가정)
      const proportional = (idx / editOcr.drugs.length) * imgEl.clientHeight;
      scrollEl.scrollTo({ top: Math.max(0, proportional - scrollEl.clientHeight / 2), behavior: "smooth" });
    }
  }

  // 키보드 위/아래로 행 이동 (Enter / ArrowDown / ArrowUp)
  function handleManualKey(e: React.KeyboardEvent<HTMLInputElement>, idx: number, field: keyof ManualDrug) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    e.preventDefault();
    const dir = e.key === "ArrowUp" ? -1 : 1;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= manualDrugs.length) return;
    const target = manualInputRefs.current[`${nextIdx}:${field}`];
    target?.focus();
    target?.select();
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
  const totalFee = filledManualDrugs.reduce((sum, d) => {
    const qty = parseFloat(d.quantity) || 0;
    const price = d.unitPrice ?? 0;
    return sum + qty * price;
  }, 0);

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
            aiDrugs: editOcr?.drugs ?? [],
            finalDrugs: filledManualDrugs,
            avgConfidence: editOcr?.avgConfidence ?? 0,
            manualCheckCount: editOcr?.manualCheckCount ?? 0,
            rawClovaText: editOcr?.rawClovaText,
            rawGeminiText: editOcr?.rawGeminiText,
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

        {/* 메인 3-pane view: 이미지 / AI 결과 / 사람 확정 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            <div ref={imageScrollRef} className="flex-1 overflow-auto min-h-64 relative">
              {imageUrl ? (
                <div onClick={handleImageClick} style={{ minHeight: 300 }}
                  className={`w-full h-full flex items-start justify-center p-2 relative ${zoomEnabled ? (isZoomed ? "cursor-zoom-out" : "cursor-zoom-in") : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img ref={imageElRef} src={imageUrl} alt="처방전"
                    style={{ width: `${zoomLevel}%`, transition: "width 0.2s ease", maxWidth: "none" }}
                    className="rounded object-contain" draggable={false} />
                  {focusedIdx != null && editOcr?.drugs[focusedIdx]?.bboxYPercent != null && (
                    <div
                      className="absolute left-2 right-2 pointer-events-none border-y-2 border-yellow-400 bg-yellow-300/15 transition-all"
                      style={{
                        top: `calc(${editOcr.drugs[focusedIdx]!.bboxYPercent}% - 14px)`,
                        height: "28px",
                      }}
                    />
                  )}
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

          {/* 중간: OCR 인식 원본 (read-only, 항상 4컬럼 헤더 표시) */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col">
            <div className="border-b border-gray-100 px-3 h-[44px] flex items-center gap-2 overflow-x-auto">
              <span className="text-xs font-semibold text-gray-700">OCR 인식 원본</span>
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
              <div className="flex-1 overflow-y-auto p-3">
                <table className="w-full text-xs table-fixed">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[26%]">보험코드</th>
                      <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[20%]">제약사</th>
                      <th className="text-left py-1.5 px-1.5 font-medium text-gray-500">제품명</th>
                      <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[14%]">수량</th>
                      <th className="py-1.5 px-1 w-[34px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {!editOcr || editOcr.drugs.length === 0 ? (
                      <tr><td colSpan={5} className="py-10 text-center text-gray-400 text-xs">
                        {ocrLoading ? "인식 중..." : "처방전 인식 후 결과가 여기 표시됩니다"}
                      </td></tr>
                    ) : editOcr.drugs.map((d, i) => {
                      const conf = d.finalConfidence;
                      const rowBg = d.manualCheck ? "bg-red-50" : conf >= 95 ? "bg-green-50/40" : "";
                      return (
                        <tr key={i} className={`border-b border-gray-100 h-9 ${rowBg}`}>
                          <td className="py-1.5 px-1.5 font-mono text-[11px] truncate" title={d.insuranceCode.value}>{d.insuranceCode.value || "—"}</td>
                          <td className="py-1.5 px-1.5 text-[11px] truncate" title={d.companyName.value}>{d.companyName.value || "—"}</td>
                          <td className="py-1.5 px-1.5 text-[11px]">
                            <div className="flex items-center gap-1">
                              <span className="truncate" title={d.productName.value}>{d.productName.value || "—"}</span>
                              <span className={`shrink-0 text-[9px] px-1 py-0.5 rounded border font-medium ${confColor(conf)}`}>{conf}%</span>
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

          {/* 오른쪽: 사람 확정 입력 */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col">
            <div className="border-b border-gray-100 px-3 h-[44px] flex items-center gap-2 overflow-x-auto">
              <span className="text-xs font-semibold text-gray-700">사람 확정</span>
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{filledManualDrugs.length}건</span>
              {isClientUnnapproved && (
                <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-300 px-1.5 py-0.5 rounded font-semibold">정산서 미반영</span>
              )}
              <button onClick={addManualRow}
                className="ml-auto text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 flex items-center gap-1">
                <Plus className="w-3 h-3" />행 추가
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <table className="w-full text-xs table-fixed">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[26%]">보험코드</th>
                    <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[20%]">제약사</th>
                    <th className="text-left py-1.5 px-1.5 font-medium text-gray-500">제품명</th>
                    <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[14%]">수량</th>
                    <th className="py-1.5 px-1 w-[34px]"></th>
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
                          <input value={d.productName}
                            ref={(el) => { manualInputRefs.current[`${i}:productName`] = el; }}
                            onFocus={() => handleManualFocus(i)}
                            onKeyDown={(e) => handleManualKey(e, i, "productName")}
                            onChange={(e) => updateManualField(i, "productName", e.target.value)}
                            placeholder="제품명"
                            className="w-full h-7 border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400" />
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
    </RequireRole>
  );
}
