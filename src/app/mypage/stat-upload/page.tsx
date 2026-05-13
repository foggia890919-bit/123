"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Upload, ImageIcon, X, CheckCircle2, Download, ChevronDown, ChevronUp, Loader2, AlertCircle, FolderOpen, ChevronLeft, ChevronRight, Plus } from "lucide-react";

const MONTH_LABELS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

function compressImage(file: File, maxPx = 1920, quality = 0.85): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg", quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(file); };
    img.src = blobUrl;
  });
}

interface UserClient { id: string; clientName: string; bizNumber: string; }
interface BatchFile { id: string; storedName: string; viewUrl: string | null; downloadUrl: string; }
interface Batch { batchKey: string; year: number; month: number; clientName: string; fileCount: number; createdAt: string; files: BatchFile[]; }
interface StatusRow { clientId: string; clientName: string; companyName: string; prevMonthUploaded: boolean; curMonthUploaded: boolean; }

function Circle({ filled }: { filled: boolean }) {
  return filled
    ? <span className="inline-block w-3.5 h-3.5 rounded-full bg-green-500" />
    : <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-gray-300" />;
}

export default function StatUploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [clients, setClients] = useState<UserClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  // per-photo selected companies: index → string[]
  const [photoCompanies, setPhotoCompanies] = useState<Record<number, string[]>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(true);
  const [statusRows, setStatusRows] = useState<StatusRow[]>([]);
  const [loadingStatus, setLoadingStatus] = useState(false);
  // lightbox for history
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    fetch("/api/user-clients")
      .then((r) => r.json())
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedClient) { setCompanies([]); return; }
    fetch(`/api/mypage/client-companies?clientId=${selectedClient}`)
      .then((r) => r.json())
      .then((data: string[]) => setCompanies(Array.isArray(data) ? data : []))
      .catch(() => setCompanies([]));
  }, [selectedClient]);

  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    fetch("/api/mypage/stat-upload")
      .then((r) => r.json())
      .then((data) => { setBatches(data.batches ?? []); setStorageReady(data.storageEnabled ?? false); })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, []);

  const loadStatus = useCallback((y: number, m: number) => {
    setLoadingStatus(true);
    fetch(`/api/mypage/stat-status?year=${y}&month=${m}`)
      .then((r) => r.json())
      .then((data) => setStatusRows(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingStatus(false));
  }, []);

  useEffect(() => {
    const uid = (session as { user?: { id?: string } } | null)?.user?.id;
    if (uid) { loadHistory(); loadStatus(year, month); }
  }, [(session as { user?: { id?: string } } | null)?.user?.id]); // eslint-disable-line

  useEffect(() => {
    const uid = (session as { user?: { id?: string } } | null)?.user?.id;
    if (uid) loadStatus(year, month);
  }, [year, month, loadStatus]); // eslint-disable-line

  const addFiles = async (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((f) => f.type.startsWith("image/"));
    const compressed = await Promise.all(arr.map((f) => compressImage(f)));
    const next = [...files, ...compressed].slice(0, 30);
    const newPreviews = next.map((f, i) => previews[i] ?? URL.createObjectURL(f));
    // revoke old previews for removed files
    previews.slice(next.length).forEach((p) => URL.revokeObjectURL(p));
    setFiles(next);
    setPreviews(newPreviews);
    setCurrentIdx(Math.min(currentIdx, next.length - 1));
    setError(null);
  };

  const removeFile = (idx: number) => {
    URL.revokeObjectURL(previews[idx]);
    const newFiles = files.filter((_, i) => i !== idx);
    const newPreviews = previews.filter((_, i) => i !== idx);
    // remap photoCompanies
    const newPC: Record<number, string[]> = {};
    Object.entries(photoCompanies).forEach(([k, v]) => {
      const ki = parseInt(k);
      if (ki < idx) newPC[ki] = v;
      else if (ki > idx) newPC[ki - 1] = v;
    });
    setFiles(newFiles);
    setPreviews(newPreviews);
    setPhotoCompanies(newPC);
    setCurrentIdx(Math.min(currentIdx, Math.max(0, newFiles.length - 1)));
  };

  const toggleCompany = (company: string) => {
    const cur = photoCompanies[currentIdx] ?? [];
    const next = cur.includes(company) ? cur.filter((c) => c !== company) : [...cur, company];
    setPhotoCompanies({ ...photoCompanies, [currentIdx]: next });
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); void addFiles(e.dataTransfer.files); };

  const handleSubmit = async () => {
    if (!files.length) { setError("사진을 선택해주세요"); return; }
    setUploading(true); setError(null); setSuccess(null);

    const form = new FormData();
    form.append("year", String(year));
    form.append("month", String(month));
    if (selectedClient) form.append("clientId", selectedClient);
    form.append("photoCompanies", JSON.stringify(photoCompanies));
    files.forEach((f) => form.append("files", f));

    const res = await fetch("/api/mypage/stat-upload", { method: "POST", body: form });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) { setError(data.error ?? "업로드 실패"); return; }
    setSuccess(`${data.count}개 파일이 저장됐습니다.`);
    previews.forEach((p) => URL.revokeObjectURL(p));
    setFiles([]); setPreviews([]); setPhotoCompanies({}); setCurrentIdx(0);
    loadHistory(); loadStatus(year, month);
  };

  const clientName = clients.find((c) => c.id === selectedClient)?.clientName ?? "";
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const curPhotoCompanies = photoCompanies[currentIdx] ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-50 rounded-lg"><Upload className="w-5 h-5 text-orange-600" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">통계업로드</h1>
          <p className="text-sm text-gray-500">처방통계 사진을 업로드합니다 (최대 30장)</p>
        </div>
      </div>

      {!storageReady && (
        <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />스토리지가 설정되지 않았습니다.
        </div>
      )}

      <div className="flex gap-4 items-start">
        {/* 왼쪽: 제출현황 */}
        <div className="w-72 shrink-0 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">제출현황</h2>
            {loadingStatus && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-x-2 px-3 py-2 bg-gray-50 border-b border-gray-100">
            <span className="text-[10px] font-semibold text-gray-500">병원명</span>
            <span className="text-[10px] font-semibold text-gray-500">제약사명</span>
            <span className="text-[10px] font-semibold text-gray-500 text-center w-8">{prevYear}년{prevMonth}월</span>
            <span className="text-[10px] font-semibold text-gray-500 text-center w-8">{year}년{month}월</span>
          </div>
          {statusRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">{loadingStatus ? "불러오는 중..." : "거래처가 없습니다"}</div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-[520px] overflow-y-auto">
              {statusRows.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-x-2 items-center px-3 py-2 hover:bg-gray-50">
                  <span className="text-xs text-gray-700 truncate">{row.clientName}</span>
                  <span className="text-xs text-gray-500 truncate">{row.companyName}</span>
                  <span className="flex justify-center w-8"><Circle filled={row.prevMonthUploaded} /></span>
                  <span className="flex justify-center w-8"><Circle filled={row.curMonthUploaded} /></span>
                </div>
              ))}
            </div>
          )}
          <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-3 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />제출</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-gray-300" />미제출</span>
          </div>
        </div>

        {/* 오른쪽 */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            {/* 통계월 + 병원 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">통계월</label>
                <div className="flex gap-1.5">
                  <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                    {[2024,2025,2026,2027].map((y) => <option key={y} value={y}>{y}년</option>)}
                  </select>
                  <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                    {MONTH_LABELS.map((l, i) => <option key={i} value={i + 1}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">병원 (거래처)</label>
                <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  <option value="">병원 선택</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.clientName}</option>)}
                </select>
              </div>
            </div>

            {/* 거래가능 제약사 */}
            {selectedClient && companies.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs font-semibold text-gray-500 self-center mr-1">거래가능 제약사</span>
                {companies.map((c, i) => (
                  <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded-full px-2.5 py-0.5 font-medium">{c}</span>
                ))}
              </div>
            )}

            {/* 컴팩트 드롭존 */}
            <div
              onDrop={onDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-3 border border-dashed border-gray-200 rounded-lg px-4 py-3 cursor-pointer hover:border-orange-300 hover:bg-orange-50 transition-colors"
            >
              <Plus className="w-4 h-4 text-gray-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-500">사진 추가 (드래그 또는 클릭)</p>
                <p className="text-xs text-gray-400">JPG · PNG · HEIC · 최대 30장 · 장당 20MB</p>
              </div>
              {files.length > 0 && (
                <span className="ml-auto text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-0.5">{files.length}장</span>
              )}
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => e.target.files && void addFiles(e.target.files)} />
            </div>

            {/* 사진 캐러셀 뷰어 */}
            {files.length > 0 && (
              <div className="space-y-3">
                {/* 대형 사진 + 네비게이션 */}
                <div className="relative bg-gray-900 rounded-xl overflow-hidden" style={{ height: "360px" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previews[currentIdx]}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                  {/* 이전 버튼 */}
                  {currentIdx > 0 && (
                    <button
                      onClick={() => setCurrentIdx(currentIdx - 1)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                  )}
                  {/* 다음 버튼 */}
                  {currentIdx < files.length - 1 && (
                    <button
                      onClick={() => setCurrentIdx(currentIdx + 1)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  )}
                  {/* 카운터 + 삭제 */}
                  <div className="absolute top-2 left-0 right-0 flex justify-between px-3">
                    <span className="text-xs bg-black/50 text-white px-2 py-1 rounded-full tabular-nums">
                      {currentIdx + 1} / {files.length}
                    </span>
                    <button
                      onClick={() => removeFile(currentIdx)}
                      className="bg-black/50 hover:bg-red-600 text-white rounded-full p-1 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {/* 현재 사진의 선택된 제약사 표시 */}
                  {curPhotoCompanies.length > 0 && (
                    <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
                      {curPhotoCompanies.map((c, i) => (
                        <span key={i} className="text-[10px] bg-orange-500 text-white rounded-full px-2 py-0.5 font-medium">{c}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 제약사 체크박스 (사진별) */}
                {selectedClient && companies.length > 0 && (
                  <div className="bg-gray-50 rounded-lg px-4 py-3">
                    <p className="text-xs font-semibold text-gray-500 mb-2">이 사진의 제약사 선택</p>
                    <div className="flex flex-wrap gap-2">
                      {companies.map((c) => (
                        <label key={c} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={curPhotoCompanies.includes(c)}
                            onChange={() => toggleCompany(c)}
                            className="w-3.5 h-3.5 accent-orange-500"
                          />
                          <span className="text-sm text-gray-700">{c}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* 썸네일 스트립 */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {previews.map((src, i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentIdx(i)}
                      className={`relative shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-colors ${i === currentIdx ? "border-orange-500" : "border-transparent"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="w-full h-full object-cover" />
                      {(photoCompanies[i] ?? []).length > 0 && (
                        <span className="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-orange-500" />
                      )}
                    </button>
                  ))}
                </div>

                {/* 저장명 미리보기 */}
                <div className="bg-gray-50 rounded-lg px-4 py-2.5 text-xs text-gray-500">
                  저장명 예시:{" "}
                  <span className="font-mono text-gray-700">
                    {year}년{month}월_{clientName || "병원명"}
                    {curPhotoCompanies.length > 0 ? `_${curPhotoCompanies.join("+")}` : ""}
                    _1.jpg ~ {files.length}.jpg
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" />{error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-4 py-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />{success}
              </div>
            )}

            <button onClick={handleSubmit} disabled={uploading || !storageReady || !files.length}
              className="w-full py-2.5 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors">
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin" />업로드 중...</> : <><Upload className="w-4 h-4" />사진 업로드</>}
            </button>
          </div>

          {/* 업로드 이력 */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-800">업로드 이력</h2>
              </div>
              {loadingHistory && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
            </div>
            {batches.length === 0 ? (
              <div className="px-5 py-10 text-center text-xs text-gray-400">업로드 이력이 없습니다</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {batches.map((b) => (
                  <div key={b.batchKey}>
                    <button
                      onClick={() => setOpenBatch(openBatch === b.batchKey ? null : b.batchKey)}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="text-xs font-semibold text-gray-400 tabular-nums w-14">{b.year}년{b.month}월</div>
                        <div className="text-sm font-medium text-gray-700">{b.clientName}</div>
                        <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{b.fileCount}장</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        {new Date(b.createdAt).toLocaleDateString("ko-KR")}
                        {openBatch === b.batchKey ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                    {openBatch === b.batchKey && (
                      <div className="px-4 pb-3 bg-gray-50">
                        {/* 이력 사진 그리드 — 클릭 시 라이트박스 */}
                        <div className="grid grid-cols-4 gap-2 mb-2">
                          {b.files.map((f) => (
                            <button
                              key={f.id}
                              onClick={() => f.viewUrl && setLightbox({ url: f.viewUrl, name: f.storedName })}
                              className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 hover:border-orange-400 group"
                            >
                              {f.viewUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={f.viewUrl} alt={f.storedName} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                                  <ImageIcon className="w-5 h-5 text-gray-300" />
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {b.files.map((f) => (
                            <div key={f.id} className="flex items-center gap-1.5 bg-white border border-gray-100 rounded-lg px-2.5 py-1.5">
                              <span className="text-xs text-gray-600 max-w-[160px] truncate">{f.storedName}</span>
                              {f.downloadUrl && (
                                <a href={f.downloadUrl} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-0.5 text-xs text-green-700 hover:underline shrink-0">
                                  <Download className="w-3 h-3" />내려받기
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 라이트박스 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-4xl max-h-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.name} className="max-w-full max-h-[85vh] object-contain rounded-lg" />
            <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-3 py-2 rounded-b-lg">
              {lightbox.name}
            </div>
            <button onClick={() => setLightbox(null)} className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
