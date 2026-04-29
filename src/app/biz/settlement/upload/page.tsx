"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  FileUp, Upload, FileSpreadsheet, Loader2, CheckCircle,
  Trash2, Download, ChevronDown, Settings2, Plus, X,
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

const CORPS = [
  "메디펄스", "뉴아이즈", "대웅바이오(CNS)", "대화제약", "보령컨슈머",
  "에스디코아", "엠디파머", "와이케이메디", "케이에스제약", "테라젠이텍스",
  "이음메디컬", "서원파마",
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

interface Template { id: string; corpName: string; columnMap: Record<string, string> }
interface Doc {
  id: string; corpName: string; fileName: string;
  period: string; status: string;
  template: { corpName: string } | null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
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

// ─── Corp Row (드롭다운 선택 후 개별 행) ──────────────────────────────────
function CorpUploadRow({
  corp, template, file, onFileChange, onRemove,
}: {
  corp: string;
  template: Template | null;
  file: File | null;
  onFileChange: (f: File | null) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  // 매핑된 컬럼명 → 원본 컬럼명 미리보기
  const mappedCols = template
    ? CANONICAL_COLS.map((c) => {
        const inv: Record<string, string> = {};
        for (const [src, canon] of Object.entries(template.columnMap)) inv[canon] = src;
        return inv[c] ? `${c}(${inv[c]})` : c;
      })
    : null;

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">{corp}</span>
          {template
            ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">컬럼 매핑 완료</span>
            : <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full">컬럼 매핑 없음</span>}
        </div>
        <button onClick={onRemove} className="text-gray-300 hover:text-red-500 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 기준 컬럼 미리보기 */}
      {mappedCols && (
        <div className="bg-gray-50 rounded-lg px-3 py-2">
          <p className="text-[10px] font-semibold text-gray-400 mb-1.5">컬럼 매핑 미리보기</p>
          <div className="flex flex-wrap gap-1">
            {mappedCols.map((c, i) => (
              <span key={i} className="text-[10px] bg-white border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 파일 선택 */}
      <div
        onClick={() => fileRef.current?.click()}
        className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-lg py-3 cursor-pointer transition-colors ${
          file ? "border-green-300 bg-green-50" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/30"
        }`}
      >
        <FileSpreadsheet className={`w-4 h-4 ${file ? "text-green-600" : "text-gray-400"}`} />
        <span className={`text-sm truncate max-w-[240px] ${file ? "text-green-700 font-medium" : "text-gray-400"}`}>
          {file ? file.name : "파일을 클릭하거나 끌어다 놓으세요 (.xlsx)"}
        </span>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)} />
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function SettlementUploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"upload" | "mapping">("upload");

  // 매핑탭
  const [expandedCorps, setExpandedCorps] = useState<Set<string>>(new Set());

  // 업로드 상태
  const [period, setPeriod] = useState("");
  const [selectedCorps, setSelectedCorps] = useState<string[]>([]);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // 드롭다운
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") { router.push("/"); return; }
    Promise.all([
      fetch("/api/settlement/templates").then((r) => r.json()),
      fetch("/api/settlement/documents").then((r) => r.json()),
    ]).then(([t, d]) => {
      setTemplates(Array.isArray(t) ? t : []);
      setDocs(Array.isArray(d) ? d : []);
    }).finally(() => setLoading(false));
  }, [session, status, router]);

  const templateMap = Object.fromEntries(templates.map((t) => [t.corpName, t]));

  function addCorp(corp: string) {
    if (!selectedCorps.includes(corp)) setSelectedCorps((p) => [...p, corp]);
    setDropdownOpen(false);
  }

  function removeCorp(corp: string) {
    setSelectedCorps((p) => p.filter((c) => c !== corp));
    setFiles((p) => { const n = { ...p }; delete n[corp]; return n; });
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setSaveError("");
    if (!period) { setSaveError("정산월을 선택하세요"); return; }
    const targets = selectedCorps.filter((c) => files[c]);
    if (targets.length === 0) { setSaveError("파일을 선택하세요"); return; }

    setSaving(true);
    const results = await Promise.allSettled(targets.map(async (corp) => {
      const file = files[corp]!;
      const fileData = await fileToBase64(file);
      return fetch("/api/settlement/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corpName: corp, fileName: file.name, fileData, period }),
      }).then((r) => r.json());
    }));
    setSaving(false);

    const newDocs = results
      .filter((r): r is PromiseFulfilledResult<Doc> => r.status === "fulfilled" && !r.value?.error)
      .map((r) => r.value);
    if (newDocs.length > 0) setDocs((p) => [...newDocs, ...p]);
    const errCount = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value?.error)).length;
    if (errCount > 0) setSaveError(`${errCount}개 업로드 실패`);
    else { setFiles({}); setSelectedCorps([]); }
  }

  async function deleteDoc(id: string) {
    await fetch(`/api/settlement/documents?id=${id}`, { method: "DELETE" });
    setDocs((p) => p.filter((d) => d.id !== id));
  }

  const handleTmplSaved = useCallback((t: Template) => {
    setTemplates((p) => {
      const idx = p.findIndex((x) => x.corpName === t.corpName);
      if (idx >= 0) { const n = [...p]; n[idx] = t; return n; }
      return [...p, t];
    });
  }, []);

  const byPeriod: Record<string, Doc[]> = {};
  for (const d of docs) {
    if (!byPeriod[d.period]) byPeriod[d.period] = [];
    byPeriod[d.period].push(d);
  }
  const periods = Object.keys(byPeriod).sort().reverse();
  const availableCorps = CORPS.filter((c) => !selectedCorps.includes(c));

  if (loading) return <BizLayout><div className="flex justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div></BizLayout>;

  return (
    <BizLayout>
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900">정산내역서 업로드</h2>
          <p className="text-xs text-gray-500 mt-0.5">법인별 정산 파일 업로드 및 컬럼 매핑 설정</p>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-gray-200">
          {([["upload", "📤 파일 업로드"], ["mapping", "⚙️ 컬럼 매핑 설정"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── 업로드 탭 ── */}
        {tab === "upload" && (
          <div className="space-y-5">
            <form onSubmit={handleUpload} className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">

              {/* 정산월 */}
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">정산월</label>
                <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)}
                  className="text-sm w-44" required />
              </div>

              {/* 법인 선택 드롭다운 */}
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">법인 선택 및 파일 첨부</label>

                <div ref={dropdownRef} className="relative w-60">
                  <button type="button" onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="flex items-center justify-between w-full px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                    <span className="flex items-center gap-1.5 text-gray-600">
                      <Plus className="w-4 h-4" /> 법인 추가
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
                  </button>
                  {dropdownOpen && (
                    <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                      {availableCorps.length === 0
                        ? <p className="px-3 py-2 text-xs text-gray-400">모든 법인이 추가됨</p>
                        : availableCorps.map((corp) => (
                          <button key={corp} type="button" onMouseDown={() => addCorp(corp)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between">
                            <span className="text-gray-800">{corp}</span>
                            {templateMap[corp] && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 선택된 법인별 파일 업로드 행 */}
              {selectedCorps.length > 0 && (
                <div className="space-y-3">
                  {selectedCorps.map((corp) => (
                    <CorpUploadRow
                      key={corp}
                      corp={corp}
                      template={templateMap[corp] ?? null}
                      file={files[corp] ?? null}
                      onFileChange={(f) => setFiles((p) => f ? { ...p, [corp]: f } : (() => { const n = { ...p }; delete n[corp]; return n; })())}
                      onRemove={() => removeCorp(corp)}
                    />
                  ))}
                </div>
              )}

              {selectedCorps.length === 0 && (
                <div className="flex items-center justify-center py-6 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400">
                  위 드롭다운에서 법인을 선택해주세요
                </div>
              )}

              {saveError && <p className="text-xs text-red-600">{saveError}</p>}

              <Button type="submit" disabled={saving || selectedCorps.length === 0} className="w-full gap-1.5">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                {saving ? "업로드 중..." : `${selectedCorps.filter((c) => files[c]).length}개 법인 업로드`}
              </Button>
            </form>

            {/* 업로드 이력 */}
            {periods.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-gray-700">업로드 이력</p>
                {periods.map((p) => (
                  <div key={p}>
                    <p className="text-xs font-semibold text-gray-500 mb-2">
                      {p.replace("-", "년 ")}월 ({byPeriod[p].length}개)
                    </p>
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                      {byPeriod[p].map((d) => (
                        <div key={d.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                          <div className="flex items-center gap-3">
                            <FileSpreadsheet className="w-4 h-4 text-gray-400 shrink-0" />
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-gray-800">{d.corpName}</p>
                                {d.template && <span className="text-xs text-green-600 font-medium">양식매칭</span>}
                              </div>
                              <p className="text-xs text-gray-400">{d.fileName}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[d.status] ?? "bg-gray-100 text-gray-500"}`}>
                              {STATUS_LABEL[d.status] ?? d.status}
                            </span>
                            <button onClick={() => deleteDoc(d.id)} className="text-gray-300 hover:text-red-500">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 매핑 설정 탭 ── */}
        {tab === "mapping" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              각 법인의 원본 컬럼명을 기준 컬럼에 매핑하세요.
              템플릿 엑셀을 다운로드 → 2행에 매핑 입력 → 불러오기로 한번에 설정할 수 있습니다.
            </p>
            {CORPS.map((corp) => {
              const hasTmpl = !!templateMap[corp];
              const isOpen = expandedCorps.has(corp);
              return (
                <div key={corp} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
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
