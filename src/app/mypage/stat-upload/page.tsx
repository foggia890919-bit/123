"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Upload, ImageIcon, X, CheckCircle2, Download, ChevronDown, ChevronUp, Loader2, AlertCircle, FolderOpen } from "lucide-react";

const MONTH_LABELS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

interface UserClient { id: string; clientName: string; bizNumber: string; }
interface Company { companyName: string; }
interface BatchFile { id: string; storedName: string; viewUrl: string | null; downloadUrl: string; }
interface Batch { batchKey: string; year: number; month: number; clientName: string; fileCount: number; createdAt: string; files: BatchFile[]; }

export default function StatUploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [clients, setClients] = useState<UserClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  // 등록 거래처 로드
  useEffect(() => {
    fetch("/api/user-clients")
      .then((r) => r.json())
      .then((data) => setClients(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // 선택 거래처의 거래가능 제약사 로드
  useEffect(() => {
    if (!selectedClient) { setCompanies([]); return; }
    fetch(`/api/mypage/client-companies?clientId=${selectedClient}`)
      .then((r) => r.json())
      .then((names: string[]) => setCompanies(names.map((n) => ({ companyName: n }))))
      .catch(() => setCompanies([]));
  }, [selectedClient]);

  // 업로드 이력 로드
  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    fetch("/api/mypage/stat-upload")
      .then((r) => r.json())
      .then((data) => {
        setBatches(data.batches ?? []);
        setStorageReady(data.storageEnabled ?? false);
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, []);

  useEffect(() => {
    const uid = (session as { user?: { id?: string } } | null)?.user?.id;
    if (uid) loadHistory();
  }, [(session as { user?: { id?: string } } | null)?.user?.id, loadHistory]); // eslint-disable-line

  const handleFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((f) => f.type.startsWith("image/"));
    const next = [...files, ...arr].slice(0, 30);
    setFiles(next);
    const newPreviews = next.map((f) => URL.createObjectURL(f));
    previews.forEach((p) => URL.revokeObjectURL(p));
    setPreviews(newPreviews);
    setError(null);
  };

  const removeFile = (idx: number) => {
    URL.revokeObjectURL(previews[idx]);
    setFiles((f) => f.filter((_, i) => i !== idx));
    setPreviews((p) => p.filter((_, i) => i !== idx));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const handleSubmit = async () => {
    if (!files.length) { setError("사진을 선택해주세요"); return; }
    if (!year || !month) { setError("통계월을 선택해주세요"); return; }
    setUploading(true); setError(null); setSuccess(null);

    const form = new FormData();
    form.append("year", String(year));
    form.append("month", String(month));
    if (selectedClient) form.append("clientId", selectedClient);
    files.forEach((f) => form.append("files", f));

    const res = await fetch("/api/mypage/stat-upload", { method: "POST", body: form });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) { setError(data.error ?? "업로드 실패"); return; }
    setSuccess(`${data.count}개 파일이 저장됐습니다.`);
    setFiles([]); previews.forEach((p) => URL.revokeObjectURL(p)); setPreviews([]);
    loadHistory();
  };

  const clientName = clients.find((c) => c.id === selectedClient)?.clientName ?? "";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-50 rounded-lg"><Upload className="w-5 h-5 text-orange-600" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">통계업로드</h1>
          <p className="text-sm text-gray-500">처방통계 사진을 업로드합니다 (최대 30장)</p>
        </div>
      </div>

      {!storageReady && (
        <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          스토리지가 설정되지 않았습니다. 관리자에게 문의하세요.
        </div>
      )}

      {/* 업로드 폼 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
        {/* 통계월 + 병원 선택 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">통계월</label>
            <div className="flex gap-2">
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                {[2024,2025,2026,2027].map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                {MONTH_LABELS.map((l, i) => <option key={i} value={i + 1}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">병원 (거래처)</label>
            <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
              <option value="">병원 선택</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.clientName}</option>)}
            </select>
          </div>
        </div>

        {/* 거래가능 제약사 표시 */}
        {selectedClient && (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">거래가능 제약사</p>
            {companies.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {companies.map((c, i) => (
                  <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded-full px-2.5 py-0.5 font-medium">
                    {c.companyName}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">거래가능 승인된 제약사가 없습니다</p>
            )}
          </div>
        )}

        {/* 파일 드롭존 */}
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-orange-300 hover:bg-orange-50 transition-colors"
        >
          <ImageIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-500">사진을 드래그하거나 클릭해서 선택</p>
          <p className="text-xs text-gray-400 mt-1">JPG, PNG, HEIC 등 · 최대 30장 · 장당 20MB</p>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        </div>

        {/* 선택된 파일 미리보기 */}
        {files.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500">{files.length}장 선택됨</p>
              <button onClick={() => { files.forEach((_, i) => URL.revokeObjectURL(previews[i])); setFiles([]); setPreviews([]); }}
                className="text-xs text-gray-400 hover:text-red-500">전체 제거</button>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {previews.map((src, i) => (
                <div key={i} className="relative group aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="w-full h-full object-cover rounded-lg border border-gray-100" />
                  <button onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                  <span className="absolute bottom-1 left-1 text-[9px] bg-black/50 text-white px-1 rounded">{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 저장명 미리보기 */}
        {files.length > 0 && (
          <div className="bg-gray-50 rounded-lg px-4 py-2.5 text-xs text-gray-500">
            저장명 예시: <span className="font-mono text-gray-700">{year}년{month}월_{clientName || "병원명"}_1.jpg ~ {files.length}.jpg</span>
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
                  <div className="px-5 pb-3 bg-gray-50">
                    <div className="grid grid-cols-1 gap-1.5">
                      {b.files.map((f) => (
                        <div key={f.id} className="flex items-center justify-between bg-white rounded-lg border border-gray-100 px-3 py-2">
                          <span className="text-xs text-gray-600 truncate max-w-[60%]">{f.storedName}</span>
                          <div className="flex items-center gap-2">
                            {f.viewUrl && (
                              <a href={f.viewUrl} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline">보기</a>
                            )}
                            {f.downloadUrl && (
                              <a href={f.downloadUrl} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-green-700 hover:underline">
                                <Download className="w-3 h-3" />내려받기
                              </a>
                            )}
                          </div>
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
  );
}
