"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  FileSpreadsheet, Upload, Trash2, Plus, Loader2,
  ArrowLeft, FolderOpen, CheckCircle, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

interface Template {
  id: string;
  corpName: string;
  fileName: string;
  columnMap: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface Doc {
  id: string;
  corpName: string;
  fileName: string;
  period: string;
  status: string;
  createdAt: string;
  template: { corpName: string; columnMap: Record<string, string> } | null;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "대기중",
  PROCESSING: "처리중",
  DONE: "완료",
  ERROR: "오류",
};
const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-700",
  PROCESSING: "bg-blue-100 text-blue-700",
  DONE: "bg-green-100 text-green-700",
  ERROR: "bg-red-100 text-red-700",
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function TemplateCard({ tmpl, onDelete }: { tmpl: Template; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`"${tmpl.corpName}" 템플릿을 삭제할까요?`)) return;
    setDeleting(true);
    await fetch(`/api/settlement/templates?id=${tmpl.id}`, { method: "DELETE" });
    onDelete(tmpl.id);
  }

  return (
    <div className="flex items-start justify-between p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-2 bg-green-50 rounded-lg">
          <FileSpreadsheet className="w-5 h-5 text-green-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">{tmpl.corpName}</p>
          <p className="text-xs text-gray-500 mt-0.5">{tmpl.fileName}</p>
          <p className="text-xs text-gray-400 mt-1">
            {new Date(tmpl.updatedAt).toLocaleDateString("ko-KR")} 업데이트
          </p>
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="text-gray-300 hover:text-red-500 transition-colors"
      >
        {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
      </button>
    </div>
  );
}

function AddTemplateForm({ onAdded }: { onAdded: (t: Template) => void }) {
  const [corpName, setCorpName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!corpName.trim() || !file) { setError("법인명과 파일을 입력하세요"); return; }
    setSaving(true);
    setError("");
    const fileData = await fileToBase64(file);
    const res = await fetch("/api/settlement/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corpName: corpName.trim(), fileName: file.name, fileData, columnMap: {} }),
    });
    setSaving(false);
    if (res.ok) {
      const tmpl = await res.json();
      onAdded(tmpl);
      setCorpName("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } else {
      const d = await res.json();
      setError(d.error ?? "저장 실패");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-dashed border-gray-300 rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
        <Plus className="w-4 h-4" /> 템플릿 추가
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder="법인명 (예: 한미약품)"
          value={corpName}
          onChange={(e) => setCorpName(e.target.value)}
          className="text-sm"
        />
        <div
          className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-2 cursor-pointer hover:bg-gray-50 text-sm"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <span className={file ? "text-gray-700 truncate" : "text-gray-400"}>
            {file ? file.name : "엑셀 파일 선택"}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button type="submit" size="sm" disabled={saving} className="w-full">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
        저장
      </Button>
    </form>
  );
}

function UploadDocForm({ templates, onUploaded }: { templates: Template[]; onUploaded: (d: Doc) => void }) {
  const [corpName, setCorpName] = useState("");
  const [period, setPeriod] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!corpName.trim() || !period || !file) { setError("모든 항목을 입력하세요"); return; }
    setSaving(true);
    setError("");
    const fileData = await fileToBase64(file);
    const res = await fetch("/api/settlement/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corpName: corpName.trim(), period, fileName: file.name, fileData }),
    });
    setSaving(false);
    if (res.ok) {
      const doc = await res.json();
      onUploaded(doc);
      setCorpName("");
      setPeriod("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } else {
      const d = await res.json();
      setError(d.error ?? "업로드 실패");
    }
  }

  const corpOptions = templates.map((t) => t.corpName);

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-dashed border-gray-300 rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
        <Upload className="w-4 h-4" /> 정산서 업로드
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <Input
            list="corp-options"
            placeholder="법인명"
            value={corpName}
            onChange={(e) => setCorpName(e.target.value)}
            className="text-sm"
          />
          <datalist id="corp-options">
            {corpOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <Input
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="text-sm"
        />
      </div>
      <div
        className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-2 cursor-pointer hover:bg-gray-50 text-sm"
        onClick={() => fileRef.current?.click()}
      >
        <FileSpreadsheet className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className={file ? "text-gray-700 truncate" : "text-gray-400"}>
          {file ? file.name : "정산 엑셀 파일 선택"}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button type="submit" size="sm" disabled={saving} className="w-full">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
        업로드
      </Button>
    </form>
  );
}

export default function SettlementPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<"templates" | "documents">("templates");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    if (session.user.role !== "BIZ" && session.user.role !== "ADMIN") {
      router.push("/mypage");
      return;
    }
    Promise.all([
      fetch("/api/settlement/templates").then((r) => r.json()),
      fetch("/api/settlement/documents").then((r) => r.json()),
    ]).then(([tmplData, docData]) => {
      setTemplates(Array.isArray(tmplData) ? tmplData : []);
      setDocs(Array.isArray(docData) ? docData : []);
    }).finally(() => setLoading(false));
  }, [session, status, router]);

  async function deleteDoc(id: string) {
    await fetch(`/api/settlement/documents?id=${id}`, { method: "DELETE" });
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  // group docs by period
  const docsByPeriod: Record<string, Doc[]> = {};
  for (const d of docs) {
    if (!docsByPeriod[d.period]) docsByPeriod[d.period] = [];
    docsByPeriod[d.period].push(d);
  }
  const sortedPeriods = Object.keys(docsByPeriod).sort().reverse();

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 mt-4 pb-8">
      <div className="flex items-center gap-3">
        <Link href="/mypage">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            마이페이지
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-bold text-gray-900">정산서 관리</h1>
          <p className="text-xs text-gray-500">법인별 템플릿 등록 및 정산서 취합</p>
        </div>
      </div>

      {/* tab switcher */}
      <div className="flex border-b border-gray-200">
        {([["templates", "양식 템플릿"], ["documents", "정산서 내역"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "templates" && (
        <div className="space-y-3">
          <AddTemplateForm onAdded={(t) => setTemplates((prev) => {
            const idx = prev.findIndex((x) => x.id === t.id);
            if (idx >= 0) { const next = [...prev]; next[idx] = t; return next; }
            return [t, ...prev];
          })} />

          {templates.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-8">
              등록된 양식 템플릿이 없습니다
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => (
                <TemplateCard
                  key={t.id}
                  tmpl={t}
                  onDelete={(id) => setTemplates((prev) => prev.filter((x) => x.id !== id))}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "documents" && (
        <div className="space-y-3">
          <UploadDocForm
            templates={templates}
            onUploaded={(d) => setDocs((prev) => [d, ...prev])}
          />

          {docs.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-8">
              업로드된 정산서가 없습니다
            </div>
          ) : (
            <div className="space-y-4">
              {sortedPeriods.map((period) => (
                <div key={period}>
                  <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5" />
                    {period.replace("-", "년 ")}월
                  </p>
                  <div className="space-y-2">
                    {docsByPeriod[period].map((d) => (
                      <div key={d.id} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg">
                        <div className="flex items-center gap-3">
                          <FileSpreadsheet className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-gray-800">{d.corpName}</p>
                            <p className="text-xs text-gray-400">{d.fileName}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[d.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {STATUS_LABELS[d.status] ?? d.status}
                          </span>
                          {d.template && (
                            <span className="text-xs text-green-600 flex items-center gap-0.5">
                              <CheckCircle className="w-3 h-3" /> 양식매칭
                            </span>
                          )}
                          {!d.template && (
                            <span className="text-xs text-yellow-600 flex items-center gap-0.5">
                              <Clock className="w-3 h-3" /> 미매칭
                            </span>
                          )}
                          <button
                            onClick={() => deleteDoc(d.id)}
                            className="text-gray-300 hover:text-red-500 transition-colors"
                          >
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
    </div>
  );
}
