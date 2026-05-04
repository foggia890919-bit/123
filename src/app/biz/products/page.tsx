"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Loader2, Search, RefreshCw, Package, AlertCircle,
  CheckCircle2, Sparkles, FileSpreadsheet, ChevronLeft, ChevronRight,
} from "lucide-react";

interface Product {
  id: string; priceCode: string; productName: string; manufacturer: string;
  spec: string | null; productGroup: string | null; ingredient: string | null;
  basePrice: number;
}
interface SyncLog {
  id: string; startedAt: string; finishedAt: string | null; status: string;
  source: string; rowsTotal: number; rowsInserted: number; rowsUpdated: number; errorMsg: string | null;
}

const PAGE_SIZE = 50;

function fmtMoney(v: number | string) {
  const n = Number(v);
  return isFinite(n) ? n.toLocaleString("ko-KR") : "—";
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ProductsContent() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async (q: string, p: number) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set("q", q);
      sp.set("page", String(p));
      sp.set("size", String(PAGE_SIZE));
      const r = await fetch(`/api/products?${sp.toString()}`);
      if (r.ok) {
        const body = await r.json();
        setProducts(body.products ?? []);
        setTotal(body.total ?? 0);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search, page), 300);
    return () => clearTimeout(t);
  }, [search, page, load]);

  const loadLogs = useCallback(async () => {
    const r = await fetch("/api/products/logs").catch(() => null);
    if (r && r.ok) { const body = await r.json(); setLogs(body.logs ?? []); }
  }, []);
  useEffect(() => { loadLogs(); }, [loadLogs]);

  async function triggerWorkerSync() {
    if (!confirm("워커가 이팜스 마스터 계정으로 자동 로그인 → 전체엑셀다운 → 임포트합니다.\n5~10분 소요 가능. 진행할까요?")) return;
    setSyncing(true);
    try {
      const r = await fetch("/api/products/sync", { method: "POST" });
      const body = await r.json();
      if (!r.ok) alert(body.error || "트리거 실패");
      else alert("워커가 시작되었습니다. 5~10분 후 새로고침으로 확인하세요.");
    } finally { setSyncing(false); }
  }

  async function uploadExcel(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("source", "excel-upload");
      const r = await fetch("/api/products/upload", { method: "POST", body: form });
      const body = await r.json();
      if (!r.ok) { alert(body.error || "업로드 실패"); return; }
      alert(`임포트 완료: 신규 ${body.inserted}건 / 갱신 ${body.updated}건 / 총 ${body.total}건`);
      setPage(1);
      await load(search, 1);
      await loadLogs();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-600" /> 이팜스 상품 마스터
          </h1>
          <p className="text-sm text-gray-500 mt-1">자동주문 시스템의 상품 카탈로그. 워커 자동 동기화 또는 엑셀 직접 업로드.</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadExcel(f); }} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            엑셀 업로드
          </button>
          <button onClick={triggerWorkerSync} disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            워커 자동 동기화
          </button>
        </div>
      </div>

      {logs.length > 0 && (
        <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs">
          <div className="font-semibold text-gray-700 mb-1.5 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> 최근 동기화</div>
          <div className="space-y-0.5">
            {logs.slice(0, 3).map((l) => (
              <div key={l.id} className="flex items-center gap-3">
                {l.status === "ok" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                  : l.status === "error" ? <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                  : <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />}
                <span className="text-gray-500">{fmtDate(l.startedAt)}</span>
                <span className="text-gray-700">{l.source}</span>
                {l.status === "ok" && <span className="text-gray-600">신규 {l.rowsInserted} / 갱신 {l.rowsUpdated} / 총 {l.rowsTotal}</span>}
                {l.status === "error" && <span className="text-red-700 truncate">{l.errorMsg}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative max-w-md mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="상품명 / 제약사 / 성분명 / 코드 검색"
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">제약사</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">상품명</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">규격</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase font-mono">코드</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">기본단가</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> 검색 중…</td></tr>}
            {!loading && products.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">{search ? "검색 결과 없음" : "등록된 상품이 없습니다. 위 버튼으로 동기화하세요."}</td></tr>}
            {products.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 text-sm text-gray-700">{p.manufacturer}</td>
                <td className="px-4 py-2 text-sm text-gray-900 font-medium">{p.productName}</td>
                <td className="px-4 py-2 text-xs text-gray-500">{p.spec ?? "—"}</td>
                <td className="px-4 py-2 text-xs text-gray-500 font-mono">{p.priceCode}</td>
                <td className="px-4 py-2 text-sm text-right font-mono">{fmtMoney(p.basePrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
          <div>
            전체 <span className="font-semibold text-gray-900">{total.toLocaleString("ko-KR")}</span>건
            <span className="text-gray-400 ml-2">({(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} 표시)</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}
              className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft className="w-4 h-4" /> 이전
            </button>
            <span className="text-gray-700">{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}
              className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
              다음 <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (<BizLayout><ProductsContent /></BizLayout>);
}
