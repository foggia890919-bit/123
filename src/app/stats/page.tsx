"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { AlertTriangle, Search, X, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import RequireRole from "@/components/RequireRole";
import DocumentScanner from "@/components/DocumentScanner";
import CameraCapture from "@/components/CameraCapture";

import type { OcrResult, ManualDrug, UserClient } from "./components/types";
import { emptyManualDrug } from "./components/types";
import { CURRENT_YEAR, YEARS, MONTHS, compressImage } from "./components/constants";
import BatchUploadPanel from "./components/BatchUploadPanel";
import ClientRegistrationModal from "./components/ClientRegistrationModal";
import ImagePanel from "./components/ImagePanel";
import ManualDrugsPanel from "./components/ManualDrugsPanel";
import OcrMatchPanel from "./components/OcrMatchPanel";

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
  const [manualInitMode, setManualInitMode] = useState<"ocr" | "lastMonth" | "empty">("ocr");

  // 저번달 처방 (가운데 패널 — 거래처+년월 변경 시 자동 로드)
  const [lastMonth, setLastMonth] = useState<{ drugs: ManualDrug[]; year: number; month: number } | null>(null);
  const [lastMonthLoading, setLastMonthLoading] = useState(false);

  // 이미지 패널 사이즈 (사용자 조절 가능)
  const [imageHeight, setImageHeight] = useState(360);

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

  const handleFile = useCallback((file: File) => {
    setImageFile(file);
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

  const isClientUnnapproved = selectedClient !== null && !selectedClient.approved;

  // 행별 수수료 계산 for totalFee
  const filledManualDrugs = manualDrugs.filter((d) => d.insuranceCode || d.productName || d.quantity);
  const totalFee = filledManualDrugs.reduce((sum, d) => {
    const qty = parseFloat(d.quantity) || 0;
    const price = d.unitPrice ?? 0;
    const ratePct = (d.commissionRate ?? 0) + (d.additionalRate ?? 0);
    return sum + qty * price * ratePct / 100;
  }, 0);

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
                                &quot;{hospitalQuery}&quot; 와 일치하는 거래처가 없어 전체 목록 ({clients.length}건) 을 표시합니다
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
                <button type="button" onClick={() => { setRegOpen(true); }}
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

        {/* 이미지 — 상단 sticky strip */}
        <ImagePanel
          imageUrl={imageUrl}
          imageFile={imageFile}
          originalImageFile={originalImageFile}
          selectedClient={selectedClient}
          ocrLoading={ocrLoading}
          ocrError={ocrError}
          ocr={ocr}
          editOcr={editOcr}
          manualDrugs={manualDrugs}
          focusedIdx={focusedIdx}
          zoomLevel={zoomLevel}
          setZoomLevel={setZoomLevel}
          zoomEnabled={zoomEnabled}
          setZoomEnabled={setZoomEnabled}
          isZoomed={isZoomed}
          setIsZoomed={setIsZoomed}
          showDebug={showDebug}
          setShowDebug={setShowDebug}
          imageHeight={imageHeight}
          setImageHeight={setImageHeight}
          imageScrollRef={imageScrollRef}
          imageElRef={imageElRef}
          onRunOcr={runOcr}
          onFileSelect={() => fileInputRef.current?.click()}
          onCameraOpen={() => setCameraOpen(true)}
          onDrop={onDrop}
          onReScan={() => setPendingScanFile(originalImageFile ?? imageFile)}
          fileInputRef={fileInputRef}
          cameraInputRef={cameraInputRef}
          onFileInputChange={(e) => { const f = e.target.files?.[0]; if (f) { setOriginalImageFile(f); setPendingScanFile(f); } e.target.value = ""; }}
          onCameraInputChange={(e) => { const f = e.target.files?.[0]; if (f) { setOriginalImageFile(f); setPendingScanFile(f); } e.target.value = ""; }}
        />

        {/* 두 패널 통합 — 사진매칭 (hidden) + 최종수정 (visible) */}
        <div className="grid grid-cols-1 gap-4">
          {/* 사진매칭: OCR 인식 원본 — UI 에서 숨김 (데이터/진단은 내부에서 유지) */}
          <OcrMatchPanel editOcr={editOcr} ocrLoading={ocrLoading} />

          {/* 최종수정: 사람 확정 입력 */}
          <ManualDrugsPanel
            manualDrugs={manualDrugs}
            setManualDrugs={setManualDrugs}
            editOcr={editOcr}
            manualInitMode={manualInitMode}
            setManualInitMode={setManualInitMode}
            isClientUnnapproved={isClientUnnapproved}
            submitted={submitted}
            submitError={submitError}
            submitting={submitting}
            onSubmit={handleSubmit}
            focusedIdx={focusedIdx}
            setFocusedIdx={setFocusedIdx}
            imageScrollRef={imageScrollRef}
            imageElRef={imageElRef}
            sessionUserId={session?.user?.id}
          />
        </div>
        </>}
      </div>

      {/* 신규 거래처 등록 모달 */}
      {regOpen && (
        <ClientRegistrationModal
          initialName={hospitalQuery}
          onClose={() => setRegOpen(false)}
          onRegistered={(data) => {
            setClients((prev) => [data, ...prev]);
            selectClient(data);
            setRegOpen(false);
          }}
        />
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
