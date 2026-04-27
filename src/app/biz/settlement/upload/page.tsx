"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FileUp, Upload, FileSpreadsheet, Loader2, CheckCircle, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BizLayout } from "../../page";

interface Template {
  id: string;
  corpName: string;
  fileName: string;
  updatedAt: string;
}

interface Doc {
  id: string;
  corpName: string;
  fileName: string;
  period: string;
  status: string;
  template: { corpName: string } | null;
  createdAt: string;
}

const CORPS = [
  "메디펄스", "뉴아이즈", "대웅바이오(CNS)", "대화제약", "보령컨슈머",
  "에스디코아", "엠디파머", "와이케이메디", "케이에스제약", "테라젠이텍스",
  "이음메디컬", "서원파마",
];

const STATUS_LABEL: Record<string, string> = {
  PENDING: "대기", PROCESSING: "처리중", DONE: "완료", ERROR: "오류",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  PROCESSING: "bg-blue-100 text-blue-700",
  DONE: "bg-green-100 text-green-700",
  ERROR: "bg-red-100 text-red-700",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function SettlementUploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("");

  // upload state
  const [uploads, setUploads] = useState<{ corpName: string; file: File | null }[]>([
    { corpName: "", file: null },
  ]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

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

  function addRow() {
    setUploads((p) => [...p, { corpName: "", file: null }]);
  }

  function setRow(idx: number, patch: Partial<{ corpName: string; file: File | null }>) {
    setUploads((p) => p.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function removeRow(idx: number) {
    setUploads((p) => p.filter((_, i) => i !== idx));
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setSaveError("");
    if (!period) { setSaveError("정산월을 선택하세요"); return; }
    const valid = uploads.filter((u) => u.corpName && u.file);
    if (valid.length === 0) { setSaveError("법인명과 파일을 입력하세요"); return; }

    setSaving(true);
    const results = await Promise.allSettled(valid.map(async (u) => {
      const fileData = await fileToBase64(u.file!);
      return fetch("/api/settlement/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corpName: u.corpName, fileName: u.file!.name, fileData, period }),
      }).then((r) => r.json());
    }));
    setSaving(false);

    const newDocs = results
      .filter((r): r is PromiseFulfilledResult<Doc> => r.status === "fulfilled" && !r.value.error)
      .map((r) => r.value);

    if (newDocs.length > 0) {
      setDocs((p) => [...newDocs, ...p]);
      setUploads([{ corpName: "", file: null }]);
    }
    const errors = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.error));
    if (errors.length > 0) setSaveError(`${errors.length}개 파일 업로드 실패`);
  }

  async function deleteDoc(id: string) {
    await fetch(`/api/settlement/documents?id=${id}`, { method: "DELETE" });
    setDocs((p) => p.filter((d) => d.id !== id));
  }

  // group by period
  const byPeriod: Record<string, Doc[]> = {};
  for (const d of docs) {
    if (!byPeriod[d.period]) byPeriod[d.period] = [];
    byPeriod[d.period].push(d);
  }
  const periods = Object.keys(byPeriod).sort().reverse();

  const templateCorps = new Set(templates.map((t) => t.corpName));

  return (
    <BizLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">정산내역서 업로드</h2>
          <p className="text-xs text-gray-500 mt-0.5">법인별 정산 엑셀 파일을 업로드합니다</p>
        </div>

        {/* 업로드 폼 */}
        <form onSubmit={handleUpload} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">정산월</label>
              <Input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="text-sm w-40"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-600">법인별 파일</label>
            {uploads.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="relative w-44">
                  <Input
                    list="corp-list"
                    placeholder="법인명"
                    value={row.corpName}
                    onChange={(e) => setRow(idx, { corpName: e.target.value })}
                    className="text-sm"
                  />
                  <datalist id="corp-list">
                    {CORPS.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div
                  className="flex-1 flex items-center gap-2 border border-gray-200 rounded-md px-3 py-2 cursor-pointer hover:bg-gray-50 text-sm min-w-0"
                  onClick={() => fileRefs.current[idx]?.click()}
                >
                  <FileSpreadsheet className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className={`truncate ${row.file ? "text-gray-700" : "text-gray-400"}`}>
                    {row.file ? row.file.name : "엑셀 파일 선택"}
                  </span>
                  {row.corpName && templateCorps.has(row.corpName) && (
                    <span className="shrink-0 text-xs text-green-600 font-medium">양식있음</span>
                  )}
                  <input
                    ref={(el) => { fileRefs.current[idx] = el; }}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => setRow(idx, { file: e.target.files?.[0] ?? null })}
                  />
                </div>
                {uploads.length > 1 && (
                  <button type="button" onClick={() => removeRow(idx)} className="text-gray-300 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addRow} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
              <Plus className="w-3.5 h-3.5" /> 법인 추가
            </button>
          </div>

          {saveError && <p className="text-xs text-red-600">{saveError}</p>}
          <Button type="submit" disabled={saving} className="w-full gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {saving ? "업로드 중..." : "업로드"}
          </Button>
        </form>

        {/* 업로드 이력 */}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : periods.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-8">업로드된 내역이 없습니다</div>
        ) : (
          <div className="space-y-4">
            {periods.map((p) => (
              <div key={p}>
                <p className="text-xs font-semibold text-gray-500 mb-2">
                  {p.replace("-", "년 ")}월 ({byPeriod[p].length}개)
                </p>
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="divide-y divide-gray-50">
                    {byPeriod[p].map((d) => (
                      <div key={d.id} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <FileSpreadsheet className="w-4 h-4 text-gray-400 shrink-0" />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-800">{d.corpName}</p>
                              {d.template && (
                                <span className="text-xs text-green-600 flex items-center gap-0.5 font-medium">
                                  <CheckCircle className="w-3 h-3" /> 양식매칭
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400">{d.fileName}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[d.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {STATUS_LABEL[d.status] ?? d.status}
                          </span>
                          <button onClick={() => deleteDoc(d.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </BizLayout>
  );
}
