"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  AlertCircle, CheckCircle2, ChevronLeft, ChevronRight,
  FileSpreadsheet, Loader2, Package,
  Plus, RefreshCw, Search, ShoppingCart, Sparkles, Trash2, X,
} from "lucide-react";

const PAGE_SIZE = 50;

interface Product {
  id: string;
  priceCode: string;
  productName: string;
  manufacturer: string;
  spec: string | null;
  productGroup: string | null;
  ingredient: string | null;
  basePrice: number;
  unitPrice?: number | null; // 거래처별 단가 (bizNumber 제공 시)
}

interface SyncLog {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  source: string;
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  errorMsg: string | null;
}

interface CartItem {
  priceCode: string;
  productName: string;
  manufacturer: string;
  spec: string | null;
  basePrice: number;
  unitPrice: number | null;
  quantity: number;
}

function fmtMoney(v: number | string | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  return isFinite(n) ? n.toLocaleString("ko-KR") : "—";
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ──────────────────────────────────────────────
// 장바구니 드로어
// ──────────────────────────────────────────────
function CartDrawer({
  cart,
  onClose,
  onUpdateQty,
  onRemove,
  onSubmit,
}: {
  cart: CartItem[];
  onClose: () => void;
  onUpdateQty: (priceCode: string, qty: number) => void;
  onRemove: (priceCode: string) => void;
  onSubmit: (data: { clientName: string; bizNumber: string; note: string }) => Promise<void>;
}) {
  const [clientName, setClientName] = useState("");
  const [bizNumber, setBizNumber] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!clientName.trim()) { alert("거래처명을 입력하세요."); return; }
    if (cart.length === 0) { alert("장바구니가 비어있습니다."); return; }
    setSubmitting(true);
    try {
      await onSubmit({ clientName, bizNumber, note });
      setClientName(""); setBizNumber(""); setNote("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md h-full flex flex-col shadow-xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2 font-semibold text-gray-900">
            <ShoppingCart className="w-5 h-5 text-blue-600" />
            장바구니
            <span className="bg-blue-600 text-white text-xs rounded-full px-2 py-0.5">{cart.length}</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
        </div>

        {/* 아이템 목록 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {cart.length === 0 && (
            <div className="text-center text-gray-400 py-12 text-sm">담긴 상품이 없습니다.</div>
          )}
          {cart.map((item) => (
            <div key={item.priceCode} className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{item.productName}</div>
                  <div className="text-xs text-gray-500">{item.manufacturer}{item.spec ? ` · ${item.spec}` : ""}</div>
                  <div className="text-xs text-gray-400 font-mono mt-0.5">{item.priceCode}</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    단가:{" "}
                    {item.unitPrice != null
                      ? <span className="font-medium text-blue-700">{fmtMoney(item.unitPrice)}원</span>
                      : <span className="text-gray-400">{fmtMoney(item.basePrice)}원 (기본)</span>}
                  </div>
                </div>
                <button onClick={() => onRemove(item.priceCode)} className="p-1 hover:bg-red-50 rounded text-red-400">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <label className="text-xs text-gray-500">수량</label>
                <div className="flex items-center border border-gray-200 rounded">
                  <button
                    onClick={() => onUpdateQty(item.priceCode, Math.max(1, item.quantity - 1))}
                    className="px-2 py-1 text-gray-600 hover:bg-gray-50 text-sm"
                  >−</button>
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) => onUpdateQty(item.priceCode, Math.max(1, Number(e.target.value) || 1))}
                    className="w-12 text-center text-sm border-x border-gray-200 py-1 focus:outline-none"
                  />
                  <button
                    onClick={() => onUpdateQty(item.priceCode, item.quantity + 1)}
                    className="px-2 py-1 text-gray-600 hover:bg-gray-50 text-sm"
                  >+</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 주문 정보 입력 */}
        <div className="border-t px-4 py-3 space-y-2.5 bg-gray-50">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">거래처명 <span className="text-red-500">*</span></label>
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="예) ○○의원"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">사업자번호</label>
            <input
              value={bizNumber}
              onChange={(e) => setBizNumber(e.target.value)}
              placeholder="예) 123-45-67890"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">메모</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="배송 관련 요청사항, 긴급 여부 등"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || cart.length === 0}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
            주문 요청 ({cart.length}품목) · 카톡 알람 발송
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 메인 컨텐츠
// ──────────────────────────────────────────────
function ProductsContent() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [bizNumberFilter, setBizNumberFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableTopRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (q: string, biz: string, p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (biz) params.set("bizNumber", biz);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((p - 1) * PAGE_SIZE));
      const r = await fetch(`/api/products?${params}`);
      if (r.ok) {
        const body = await r.json();
        setProducts(body.products ?? []);
        setTotal(body.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setPage(1); }, [search, bizNumberFilter]);

  useEffect(() => {
    const t = setTimeout(() => load(search, bizNumberFilter, page), 300);
    return () => clearTimeout(t);
  }, [search, bizNumberFilter, page, load]);

  useEffect(() => {
    tableTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [page]);

  const loadLogs = useCallback(async () => {
    const r = await fetch("/api/products/logs").catch(() => null);
    if (r?.ok) {
      const body = await r.json();
      setLogs(body.logs ?? []);
    }
  }, []);
  useEffect(() => { loadLogs(); }, [loadLogs]);

  async function triggerWorkerSync() {
    if (!confirm("워커가 이팜스 마스터 계정으로 자동 로그인 → 상품 전체 동기화합니다.\n5~10분 소요. 진행할까요?")) return;
    setSyncing(true);
    try {
      const r = await fetch("/api/products/sync", { method: "POST" });
      const body = await r.json();
      if (!r.ok) alert(body.error || "트리거 실패");
      else alert("워커가 시작됐습니다. 5~10분 후 새로고침으로 확인하세요.");
    } finally {
      setSyncing(false);
    }
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
      await load(search, bizNumberFilter, page);
      await loadLogs();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((i) => i.priceCode === product.priceCode);
      if (existing) return prev.map((i) => i.priceCode === product.priceCode ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, {
        priceCode: product.priceCode,
        productName: product.productName,
        manufacturer: product.manufacturer,
        spec: product.spec,
        basePrice: product.basePrice,
        unitPrice: product.unitPrice ?? null,
        quantity: 1,
      }];
    });
  }

  function updateQty(priceCode: string, qty: number) {
    setCart((prev) => prev.map((i) => i.priceCode === priceCode ? { ...i, quantity: qty } : i));
  }

  function removeFromCart(priceCode: string) {
    setCart((prev) => prev.filter((i) => i.priceCode !== priceCode));
  }

  async function submitOrder({ clientName, bizNumber, note }: { clientName: string; bizNumber: string; note: string }) {
    const r = await fetch("/api/inhouse-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientName,
        bizNumber: bizNumber || null,
        note: note || null,
        items: cart.map((i) => ({
          priceCode: i.priceCode,
          productName: i.productName,
          manufacturer: i.manufacturer,
          spec: i.spec,
          basePrice: i.basePrice,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
        })),
      }),
    });
    const body = await r.json();
    if (!r.ok) { alert(body.error || "주문 요청 실패"); return; }
    alert(`주문 요청 완료! 담당자에게 카톡 알람이 발송됐습니다.\n주문 ID: ${body.order.id}`);
    setCart([]);
    setCartOpen(false);
  }

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-600" /> 이팜스 상품 마스터
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            상품을 검색해 장바구니에 담고 주문 요청하세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 장바구니 버튼 */}
          <button
            onClick={() => setCartOpen(true)}
            className="relative flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg"
          >
            <ShoppingCart className="w-4 h-4" />
            장바구니
            {cartCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {cartCount > 9 ? "9+" : cartCount}
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadExcel(f); }}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            엑셀 업로드
          </button>
          <button
            onClick={triggerWorkerSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            워커 자동 동기화
          </button>
        </div>
      </div>

      {/* 동기화 로그 */}
      {logs.length > 0 && (
        <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs">
          <div className="font-semibold text-gray-700 mb-1.5 flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> 최근 동기화
          </div>
          <div className="space-y-0.5">
            {logs.slice(0, 3).map((l) => (
              <div key={l.id} className="flex items-center gap-3">
                {l.status === "ok"
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                  : l.status === "error"
                  ? <AlertCircle className="w-3.5 h-3.5 text-red-600" />
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

      {/* 검색 + 사업자번호 필터 */}
      <div ref={tableTopRef} className="flex gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="상품명 / 제약사 / 성분명 / 코드 검색"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <input
          value={bizNumberFilter}
          onChange={(e) => setBizNumberFilter(e.target.value)}
          placeholder="사업자번호 (거래처 단가 조회)"
          className="w-48 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* 상품 테이블 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">제약사</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">상품명</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">규격</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase font-mono">코드</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">기본단가</th>
              {bizNumberFilter && (
                <th className="px-4 py-3 text-right text-xs font-semibold text-blue-600 uppercase">거래처단가</th>
              )}
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">담기</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={bizNumberFilter ? 7 : 6} className="px-4 py-12 text-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> 검색 중…
              </td></tr>
            )}
            {!loading && products.length === 0 && (
              <tr><td colSpan={bizNumberFilter ? 7 : 6} className="px-4 py-12 text-center text-gray-400">
                {search ? "검색 결과 없음" : "등록된 상품이 없습니다. 위 버튼으로 동기화하세요."}
              </td></tr>
            )}
            {products.map((p) => {
              const inCart = cart.some((i) => i.priceCode === p.priceCode);
              return (
                <tr key={p.id} className={inCart ? "bg-amber-50" : "hover:bg-gray-50"}>
                  <td className="px-4 py-2 text-sm text-gray-700">{p.manufacturer}</td>
                  <td className="px-4 py-2 text-sm text-gray-900 font-medium">{p.productName}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{p.spec ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 font-mono">{p.priceCode}</td>
                  <td className="px-4 py-2 text-sm text-right font-mono">{fmtMoney(p.basePrice)}</td>
                  {bizNumberFilter && (
                    <td className="px-4 py-2 text-sm text-right font-mono text-blue-700 font-semibold">
                      {p.unitPrice != null ? fmtMoney(p.unitPrice) : "—"}
                    </td>
                  )}
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => { addToCart(p); setCartOpen(true); }}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                        inCart
                          ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                          : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                      }`}
                    >
                      {inCart ? <ShoppingCart className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      {inCart ? "추가" : "담기"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
          <span>총 {total.toLocaleString()}개 중 {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, total).toLocaleString()}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30">
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(7, Math.ceil(total / PAGE_SIZE)) }, (_, i) => {
              const totalPages = Math.ceil(total / PAGE_SIZE);
              let pageNum: number;
              if (totalPages <= 7) pageNum = i + 1;
              else if (page <= 4) pageNum = i + 1;
              else if (page >= totalPages - 3) pageNum = totalPages - 6 + i;
              else pageNum = page - 3 + i;
              return (
                <button key={pageNum} onClick={() => setPage(pageNum)}
                  className={`w-8 h-8 rounded text-sm font-medium ${page === pageNum ? "bg-blue-600 text-white" : "hover:bg-gray-100"}`}>
                  {pageNum}
                </button>
              );
            })}
            <button onClick={() => setPage((p) => Math.min(Math.ceil(total / PAGE_SIZE), p + 1))} disabled={page >= Math.ceil(total / PAGE_SIZE)} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 장바구니 드로어 */}
      {cartOpen && (
        <CartDrawer
          cart={cart}
          onClose={() => setCartOpen(false)}
          onUpdateQty={updateQty}
          onRemove={removeFromCart}
          onSubmit={submitOrder}
        />
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <BizLayout>
      <ProductsContent />
    </BizLayout>
  );
}
