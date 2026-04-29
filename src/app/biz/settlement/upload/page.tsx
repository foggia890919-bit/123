"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  FileUp, Upload, FileSpreadsheet, Loader2, CheckCircle,
  Trash2, Download, ChevronDown, Settings2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as XLSX from "xlsx";
import { BizLayout } from "../../page";

const CANONICAL_COLS = [
  "사업자등록번호", "담당자명", "병의원명", "제약사명",
  "품목명", "보험코드", "약가", "수량",
  "매출금액", "정산서요율(%)", "처방월", "비고",
];

const STATUS_LABEL: Record<string, string> = {
  PENDING: "대기", PROCESSING: "처리중", DONE: "완료", ERROR: "오류",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING:    "bg-yellow-100 text-yellow-700",
  PROCESSING: "bg-blue-100 text-blue-700",
  DONE:       "bg-green-100 text-green-700",
  ERROR:      "bg-red-100 text-red-700",
};

interface Dealer {
  id: string;
  clientName: string;
  isSettlementTarget: boolean;
}

interface Template { id: string; corpName: string; columnMap: Record<string, string> }
interface Doc {
  id: string;
  corpName: string;
  fileName: string;
  period: string;
  status: string;
  templateId?: string | null;
  createdAt: string; // ISO
  template: { corpName: string; columnMap: Record<string, string> } | null;
}

function currentYearMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function downloadDoc(id: string, fileName: string) {
  const res = await fetch(`/api/settlement/documents/download?id=${id}`);
  if (!res.ok) { alert("다운로드 실패"); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ─── Mapping Editor ────────────────────────────────────────────────────────
function MappingEditor({ corp, template, onSaved }: {
  corp: string;
  template: Template | null;
  onSaved: (t: Template) => void;
}) {
  const [map, setMap] = useState<Record<string, string>>(() => {
    if (!template) return {};
    const inv: Record<string, string> = {};
    for (const [src, canon] of Object.entries(template.columnMap)) inv[canon] = src;
    return inv;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!template) { setMap({}); return; }
    const inv: Record<string, string> = {};
    for (const [src, canon] of Object.entries(template.columnMap)) inv[canon] = src;
    setMap(inv);
  }, [template]);

  async function handleSave() {
    const columnMap: Record<string, string> = {};
    for (const [canon, src] of Object.entries(map)) {
      if (src.trim()) columnMap[src.trim()] = canon;
    }
    setSaving(true);
    const res = await fetch("/api/settlement/templates/excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corp, columnMap }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved({ id: template?.id ?? "", corpName: corp, columnMap });
    }
  }

  async function handleDownload() {
    const res = await fetch(`/api/settlement/templates/excel?corp=${encodeURIComponent(corp)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `매핑템플릿_${corp}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }

  async function handleMappingUpload(file: File) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
    const mappingRow = rows[1];
    if (!mappingRow) return;
    const newMap: Record<string, string> = {};
    for (let i = 2; i < mappingRow.length; i++) {
      const canon = CANONICAL_COLS[i - 2];
      const src = mappingRow[i];
      if (canon && src && String(src).trim()) newMap[canon] = String(src).trim();
    }
    setMap(newMap);
  }

  const mappingFileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-600">{corp} 컬럼 매핑</p>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={handleDownload} className="gap-1.5 text-xs h-7 px-2.5">
            <Download className="w-3 h-3" /> 템플릿
          </Button>
          <Button variant="outline" size="sm" onClick={() => mappingFileRef.current?.click()} className="gap-1.5 text-xs h-7 px-2.5">
            <Upload className="w-3 h-3" /> 불러오기
          </Button>
          <input ref={mappingFileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMappingUpload(f); }} />
        </div>
      </div>
      <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
        <div className="grid grid-cols-2 bg-gray-50 border-b border-gray-200 px-3 py-1.5 font-semibold text-gray-500">
          <span>기준 컬럼</span><span>{corp} 원본 컬럼명</span>
        </div>
        <div className="divide-y divide-gray-100">
          {CANONICAL_COLS.map((col) => (
            <div key={col} className="grid grid-cols-2 items-center px-3 py-1.5">
              <span className="text-gray-700 font-medium">{col}</span>
              <Input value={map[col] ?? ""} onChange={(e) => setMap((p) => ({ ...p, [col]: e.target.value }))}
                placeholder="원본 컬럼명" className="h-6 text-xs py-0" />
            </div>
          ))}
        </div>
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving} className="w-full gap-1.5">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle className="w-3.5 h-3.5" /> : null}
        {saved ? "저장 완료!" : "매핑 저장"}
      </Button>
    </div>
  );
}

// ─── Dealer Upload Row ─────────────────────────────────────────────────────
function DealerUploadRow({
  dealer, template, file, doc, yearMonth, onFileChange, onDocUploaded, onDocDeleted,
}: {
  dealer: Dealer;
  template: Template | null;
  file: File | null;
  doc: Doc | null;
  yearMonth: string;
  onFileChange: (f: File | null) => void;
  onDocUploaded: (d: Doc) => void;
  onDocDeleted: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(f: File) {
    if (!yearMonth) return;
    setUploading(true);
    try {
      const fileData = await fileToBase64(f);
      const res = await fetch("/api/settlement/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corpName: dealer.clientName, fileName: f.name, fileData, period: yearMonth }),
      });
      if (res.ok) {
        const d: Doc = await res.json();
        onDocUploaded(d);
        onFileChange(null);
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/settlement/documents?id=${id}`, { method: "DELETE" });
    onDocDeleted(id);
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-4">
        {/* 좌: 법인명 + 매핑 뱃지 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800 truncate">{dealer.clientName}</span>
            {template
              ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full shrink-0">컬럼 매핑 완료</span>
              : <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full shrink-0">컬럼 매핑 없음</span>}
          </div>
        </div>

        {/* 중: 파일 선택 영역 */}
        <div
          onClick={() => { if (!doc) fileRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f && !doc) { onFileChange(f); handleUpload(f); }
          }}
          className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-lg py-2.5 px-3 w-56 shrink-0 transition-colors ${
            doc ? "border-gray-100 bg-gray-50 cursor-default"
            : file ? "border-green-300 bg-green-50 cursor-pointer"
            : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 cursor-pointer"
          }`}
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          ) : doc ? (
            <span className="text-xs text-gray-400">업로드 완료</span>
          ) : (
            <>
              <FileSpreadsheet className={`w-4 h-4 shrink-0 ${file ? "text-green-600" : "text-gray-400"}`} />
              <span className={`text-xs truncate ${file ? "text-green-700 font-medium" : "text-gray-400"}`}>
                {file ? file.name : "파일 선택 또는 드롭"}
              </span>
            </>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { onFileChange(f); handleUpload(f); }
            }} />
        </div>

        {/* 우: 업로드 결과 */}
        <div className="w-48 shrink-0">
          {doc ? (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-gray-400">{new Date(doc.createdAt).toLocaleDateString("ko-KR")}</p>
                <p className="text-xs text-gray-700 font-medium truncate">{doc.fileName}</p>
              </div>
              <button onClick={() => downloadDoc(doc.id, doc.fileName)} className="text-gray-400 hover:text-blue-500 shrink-0">
                <Download className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => handleDelete(doc.id)} className="text-gray-300 hover:text-red-500 shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 h-full">
              <span className="text-xs text-gray-400">미업로드</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function SettlementUploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"upload" | "mapping">("upload");

  const [yearMonth, setYearMonth] = useState<string>(currentYearMonth());
  const [files, setFiles] = useState<Record<string, File>>({});
  const [expandedCorps, setExpandedCorps] = useState<Set<string>>(new Set());

  async function loadData() {
    const [d, t, docs] = await Promise.all([
      fetch("/api/dealer?isSettlementTarget=true").then((r) => r.json()),
      fetch("/api/settlement/templates").then((r) => r.json()),
      fetch(`/api/settlement/documents?yearMonth=${yearMonth}`).then((r) => r.json()),
    ]);
    setDealers(Array.isArray(d) ? d : []);
    setTemplates(Array.isArray(t) ? t : []);
    setDocs(Array.isArray(docs) ? docs : []);
  }

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") { router.push("/"); return; }
    loadData().finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status, router]);

  useEffect(() => {
    if (!loading) {
      fetch(`/api/settlement/documents?yearMonth=${yearMonth}`)
        .then((r) => r.json())
        .then((d) => setDocs(Array.isArray(d) ? d : []));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearMonth]);

  const templateMap = Object.fromEntries(templates.map((t) => [t.corpName, t]));

  // docs for current yearMonth keyed by corpName (latest per corp)
  const docByCorpName: Record<string, Doc> = {};
  for (const d of docs) {
    if (d.period === yearMonth && !docByCorpName[d.corpName]) {
      docByCorpName[d.corpName] = d;
    }
  }

  const handleTmplSaved = useCallback((t: Template) => {
    setTemplates((p) => {
      const idx = p.findIndex((x) => x.corpName === t.corpName);
      if (idx >= 0) { const n = [...p]; n[idx] = t; return n; }
      return [...p, t];
    });
  }, []);

  if (loading) return <BizLayout><div className="flex justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div></BizLayout>;

  return (
    <BizLayout>
      <div className="space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">정산내역서 업로드</h2>
            <p className="text-xs text-gray-500 mt-0.5">법인별 정산 파일 업로드 및 컬럼 매핑 설정</p>
          </div>
          <button onClick={() => { setLoading(true); loadData().finally(() => setLoading(false)); }}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </button>
        </div>

        {/* 적용월 picker */}
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1.5 block">적용월</label>
          <Input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="text-sm w-44"
          />
        </div>

        {/* 탭 */}
        <div className="flex border-b border-gray-200">
          {([["upload", "파일 업로드"], ["mapping", "컬럼 매핑 설정"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* 빈 상태: 정산 대상 법인 없음 */}
        {dealers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-200 rounded-xl text-center">
            <FileSpreadsheet className="w-8 h-8 text-gray-300 mb-2" />
            <p className="text-sm font-medium text-gray-500">정산 대상 법인이 없어요.</p>
            <p className="text-xs text-gray-400 mt-1">
              <a href="/biz/dealers" className="text-blue-500 hover:underline">/biz/dealers</a>에서 정산 토글을 켜주세요.
            </p>
          </div>
        )}

        {/* ── 업로드 탭 ── */}
        {tab === "upload" && dealers.length > 0 && (
          <div className="space-y-3">
            {dealers.map((dealer) => (
              <DealerUploadRow
                key={dealer.id}
                dealer={dealer}
                template={templateMap[dealer.clientName] ?? null}
                file={files[dealer.clientName] ?? null}
                doc={docByCorpName[dealer.clientName] ?? null}
                yearMonth={yearMonth}
                onFileChange={(f) => setFiles((p) =>
                  f ? { ...p, [dealer.clientName]: f }
                    : (() => { const n = { ...p }; delete n[dealer.clientName]; return n; })()
                )}
                onDocUploaded={(d) => setDocs((p) => [d, ...p])}
                onDocDeleted={(id) => setDocs((p) => p.filter((x) => x.id !== id))}
              />
            ))}
          </div>
        )}

        {/* ── 매핑 설정 탭 ── */}
        {tab === "mapping" && dealers.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              각 법인의 원본 컬럼명을 기준 컬럼에 매핑하세요.
              템플릿 엑셀을 다운로드 → 2행에 매핑 입력 → 불러오기로 한번에 설정할 수 있습니다.
            </p>
            {dealers.map((dealer) => {
              const corp = dealer.clientName;
              const hasTmpl = !!templateMap[corp];
              const isOpen = expandedCorps.has(corp);
              return (
                <div key={dealer.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedCorps((p) => { const n = new Set(p); n.has(corp) ? n.delete(corp) : n.add(corp); return n; })}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2.5">
                      <Settings2 className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-semibold text-gray-800">{corp}</span>
                      {hasTmpl
                        ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">매핑완료</span>
                        : <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">미설정</span>}
                    </div>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                      <MappingEditor corp={corp} template={templateMap[corp] ?? null} onSaved={handleTmplSaved} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BizLayout>
  );
}
