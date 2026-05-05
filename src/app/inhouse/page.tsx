"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import {
  ShoppingCart, Search, Plus, Minus, Trash2, Loader2, ChevronDown,
  X, CheckCircle2, ClipboardList, TrendingUp, Package, Send,
  ChevronRight, AlertCircle,
} from "lucide-react";
import RequireRole from "@/components/RequireRole";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserClient {
  id: string;
  clientName: string;
  bizNumber: string;
  dealerType?: string | null;
}

interface Product {
  priceCode: string;
  productName: string;
  manufacturer: string;
  spec: string | null;
  productGroup: string | null;
  ingredient: string | null;
  basePrice: number;
  suggestedPrice?: { value: number; source: string; setAt: string } | null;
  recentLedger?: { entryDate: string; sales: number } | null;
}

interface CartItem {
  priceCode: string;
  productName: string;
  manufacturer: string;
  spec: string | null;
  basePrice: number;
  unitPrice: number;
  quantity: number;
}

interface Order {
  id: string;
  clientName: string;
  bizNumber: string;
  status: string;
  note: string | null;
  createdAt: string;
  confirmedAt: string | null;
  orderedAt: string | null;
  items: { priceCode: string; productName: string; unitPrice: number; quantity: number; spec: string | null }[];
}

// ─── 도우미 ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("ko-KR");
}

function margin(sell: number, buy: number): { pct: number; color: string } {
  if (!buy || buy === 0) return { pct: 0, color: "text-gray-400" };
  const pct = ((sell - buy) / buy) * 100;
  if (pct > 20) return { pct, color: "text-green-600" };
  if (pct > 0) return { pct, color: "text-blue-600" };
  return { pct, color: "text-red-500" };
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING:   { label: "대기",      color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  CONFIRMED: { label: "확인",      color: "bg-blue-50 text-blue-700 border-blue-200" },
  ORDERED:   { label: "주문완료",  color: "bg-green-50 text-green-700 border-green-200" },
  REJECTED:  { label: "반려",      color: "bg-red-50 text-red-600 border-red-200" },
};

// ─── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function InhouseOrderPage() {
  const { data: session } = useSession();

  // 거래처
  const [clients, setClients] = useState<UserClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<UserClient | null>(null);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");

  // 제품 검색
  const [searchQ, setSearchQ] = useState("");
  const [searchMfr, setSearchMfr] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // 수량 입력 (테이블 인라인)
  const [qtyInput, setQtyInput] = useState<Record<string, string>>({});

  // 장바구니
  const [cart, setCart] = useState<Map<string, CartItem>>(new Map());

  // 주문 내역
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // 주문 제출
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const clientMenuRef = useRef<HTMLDivElement>(null);

  // 내 거래처 로드
  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/user-clients")
      .then((r) => r.json())
      .then((d) => setClients(Array.isArray(d) ? d : []));
  }, [session?.user?.id]);

  // 거래처 메뉴 외부 클릭 닫기
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (clientMenuRef.current && !clientMenuRef.current.contains(e.target as Node)) {
        setClientMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 주문 내역 로드
  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await fetch("/api/inhouse-orders?limit=50");
      const data = await res.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // 제품 검색
  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!searchQ.trim() && !searchMfr.trim()) return;
    setProductLoading(true);
    setSearched(true);
    try {
      const q = [searchQ, searchMfr].filter(Boolean).join(" ");
      const url = `/api/products?q=${encodeURIComponent(q)}&limit=50${
        selectedClient ? `&bizNumber=${selectedClient.bizNumber.replace(/\D/g, "")}` : ""
      }`;
      const res = await fetch(url);
      const data = await res.json();
      setProducts(Array.isArray(data.products) ? data.products : []);
    } finally {
      setProductLoading(false);
    }
  }

  // 제품 검색 (거래처 바뀌면 재검색)
  useEffect(() => {
    if (searched) handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient]);

  // 장바구니 추가
  function addToCart(product: Product) {
    if (!selectedClient) { alert("거래처를 먼저 선택해주세요."); return; }
    const qty = parseInt(qtyInput[product.priceCode] ?? "1", 10) || 1;
    const unitPrice = product.suggestedPrice?.value ?? product.basePrice;
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(product.priceCode);
      if (existing) {
        next.set(product.priceCode, { ...existing, quantity: existing.quantity + qty });
      } else {
        next.set(product.priceCode, {
          priceCode: product.priceCode,
          productName: product.productName,
          manufacturer: product.manufacturer,
          spec: product.spec,
          basePrice: product.basePrice,
          unitPrice,
          quantity: qty,
        });
      }
      return next;
    });
    setQtyInput((prev) => ({ ...prev, [product.priceCode]: "1" }));
  }

  function removeFromCart(priceCode: string) {
    setCart((prev) => { const n = new Map(prev); n.delete(priceCode); return n; });
  }

  function updateCartItem(priceCode: string, field: "quantity" | "unitPrice", value: number) {
    setCart((prev) => {
      const n = new Map(prev);
      const item = n.get(priceCode);
      if (!item) return prev;
      n.set(priceCode, { ...item, [field]: value });
      return n;
    });
  }

  // 주문 제출
  async function handleSubmit() {
    if (!selectedClient) { setSubmitError("거래처를 선택해주세요."); return; }
    if (cart.size === 0) { setSubmitError("장바구니가 비어 있습니다."); return; }
    setSubmitError("");
    setSubmitting(true);
    try {
      const items = Array.from(cart.values()).map((c) => ({
        priceCode: c.priceCode,
        productName: c.productName,
        manufacturer: c.manufacturer,
        spec: c.spec ?? "",
        basePrice: c.basePrice,
        unitPrice: c.unitPrice,
        quantity: c.quantity,
      }));
      const res = await fetch("/api/inhouse-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: selectedClient.clientName,
          bizNumber: selectedClient.bizNumber.replace(/\D/g, ""),
          note: note.trim() || null,
          items,
        }),
      });
      if (res.ok) {
        setCart(new Map());
        setNote("");
        setSubmitSuccess(true);
        setTimeout(() => setSubmitSuccess(false), 4000);
        await loadOrders();
      } else {
        const d = await res.json();
        setSubmitError(d.error ?? "주문 실패");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const filteredClients = clientQuery.trim()
    ? clients.filter((c) => c.clientName.includes(clientQuery) || c.bizNumber.includes(clientQuery))
    : clients;

  const clientOrders = selectedClient
    ? orders.filter((o) => o.bizNumber.replace(/\D/g, "") === selectedClient.bizNumber.replace(/\D/g, ""))
    : orders;

  const cartItems = Array.from(cart.values());
  const cartTotal = cartItems.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
  const cartBuyTotal = cartItems.reduce((s, c) => s + c.basePrice * c.quantity, 0);

  return (
    <RequireRole minRole="BASIC">
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />원내거래 주문
          </h1>

          {/* 거래처 선택 */}
          <div className="relative" ref={clientMenuRef}>
            <button
              type="button"
              onClick={() => setClientMenuOpen((v) => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                selectedClient
                  ? "bg-blue-50 border-blue-300 text-blue-800"
                  : "bg-white border-gray-300 text-gray-500 hover:bg-gray-50"
              }`}
            >
              {selectedClient ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                  <span className="font-medium">{selectedClient.clientName}</span>
                  <span className="text-xs text-blue-500 font-mono">{selectedClient.bizNumber}</span>
                </>
              ) : (
                <span>거래처 선택</span>
              )}
              <ChevronDown className={`w-4 h-4 transition-transform ${clientMenuOpen ? "rotate-180" : ""}`} />
              {selectedClient && (
                <span
                  onClick={(e) => { e.stopPropagation(); setSelectedClient(null); }}
                  className="ml-1 hover:text-red-500"
                >
                  <X className="w-3.5 h-3.5" />
                </span>
              )}
            </button>
            {clientMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg w-72">
                <div className="p-2 border-b border-gray-100">
                  <input
                    autoFocus
                    value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                    placeholder="거래처명 또는 사업자번호 검색..."
                    className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="max-h-52 overflow-y-auto py-1">
                  {filteredClients.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-4">등록된 거래처가 없습니다</p>
                  ) : filteredClients.map((c) => (
                    <button key={c.id} type="button"
                      onClick={() => { setSelectedClient(c); setClientMenuOpen(false); setClientQuery(""); }}
                      className={`w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors ${
                        selectedClient?.id === c.id ? "bg-blue-50" : ""
                      }`}>
                      <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                      <p className="text-xs text-gray-400 font-mono">{c.bizNumber}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 검색 바 */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="상품명 / 성분명"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <input
            value={searchMfr}
            onChange={(e) => setSearchMfr(e.target.value)}
            placeholder="제조사"
            className="w-40 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit"
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
            <Search className="w-4 h-4" />검색
          </button>
          {searched && (
            <button type="button" onClick={() => { setSearchQ(""); setSearchMfr(""); setProducts([]); setSearched(false); }}
              className="px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
              초기화
            </button>
          )}
        </form>

        {/* 메인 레이아웃 */}
        <div className="flex gap-4 items-start">
          {/* 제품 테이블 */}
          <div className="flex-1 min-w-0">
            {!searched ? (
              <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
                <Package className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">상품명 또는 성분명으로 검색하세요</p>
                {!selectedClient && (
                  <p className="text-xs text-amber-500 mt-1">거래처를 선택하면 매출가(거래처 단가)가 함께 표시됩니다</p>
                )}
              </div>
            ) : productLoading ? (
              <div className="bg-white border border-gray-200 rounded-xl p-10 flex justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : products.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
                <AlertCircle className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-gray-400">검색 결과가 없습니다</p>
                <p className="text-xs text-gray-400 mt-1">상품 동기화가 필요하면 BIZ 관리자에게 문의하세요</p>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <p className="text-xs text-gray-500">검색결과 <span className="font-semibold text-gray-700">{products.length}개</span>
                    {selectedClient && <span className="ml-2 text-blue-600">· {selectedClient.clientName} 단가 적용</span>}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/50">
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 w-24">제조사</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">상품명</th>
                        <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 w-24">규격</th>
                        <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 w-24">매입원가</th>
                        {selectedClient && (
                          <>
                            <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 w-24">매출가</th>
                            <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 w-16">이익율</th>
                          </>
                        )}
                        <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 w-24">수량</th>
                        <th className="px-3 py-2.5 w-12" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {products.map((p) => {
                        const sellPrice = p.suggestedPrice?.value ?? p.basePrice;
                        const { pct, color } = margin(sellPrice, p.basePrice);
                        const inCart = cart.has(p.priceCode);
                        return (
                          <tr key={p.priceCode} className={`hover:bg-blue-50/30 transition-colors ${inCart ? "bg-blue-50/20" : ""}`}>
                            <td className="px-3 py-2.5 text-xs text-gray-500 truncate max-w-[96px]">{p.manufacturer}</td>
                            <td className="px-3 py-2.5">
                              <p className="font-medium text-gray-800 leading-snug">{p.productName}</p>
                              <p className="text-[11px] text-gray-400 font-mono mt-0.5">{p.priceCode}</p>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-500">{p.spec ?? "-"}</td>
                            <td className="px-3 py-2.5 text-right text-sm font-mono text-gray-700">
                              {fmt(p.basePrice)}
                            </td>
                            {selectedClient && (
                              <>
                                <td className="px-3 py-2.5 text-right">
                                  <span className={`text-sm font-mono font-medium ${p.suggestedPrice ? "text-blue-700" : "text-gray-500"}`}>
                                    {fmt(sellPrice)}
                                  </span>
                                  {p.suggestedPrice && (
                                    <span className="block text-[10px] text-gray-400">{p.suggestedPrice.source}</span>
                                  )}
                                </td>
                                <td className={`px-3 py-2.5 text-right text-xs font-medium ${color}`}>
                                  {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                                </td>
                              </>
                            )}
                            <td className="px-3 py-2.5">
                              <input
                                type="number"
                                min={1}
                                value={qtyInput[p.priceCode] ?? "1"}
                                onChange={(e) => setQtyInput((prev) => ({ ...prev, [p.priceCode]: e.target.value }))}
                                className="w-16 px-2 py-1 text-sm text-center border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <button
                                onClick={() => addToCart(p)}
                                title="장바구니에 추가"
                                className={`p-1.5 rounded-lg transition-colors ${
                                  inCart
                                    ? "bg-blue-100 text-blue-600 hover:bg-blue-200"
                                    : "bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
                                }`}
                              >
                                <ShoppingCart className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* 우측 패널 */}
          <div className="w-80 shrink-0 space-y-4">
            {/* 장바구니 */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-blue-600 text-white flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4" />장바구니
                </h2>
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{cartItems.length}품목</span>
              </div>

              {cartItems.length === 0 ? (
                <div className="p-6 text-center">
                  <ShoppingCart className="w-8 h-8 text-gray-200 mx-auto mb-1" />
                  <p className="text-xs text-gray-400">상품을 추가해주세요</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {cartItems.map((item) => {
                    const { pct, color } = margin(item.unitPrice, item.basePrice);
                    return (
                      <div key={item.priceCode} className="px-3 py-2.5 space-y-1.5">
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-gray-800 leading-snug truncate">{item.productName}</p>
                            <p className="text-[11px] text-gray-400">{item.spec ?? item.manufacturer}</p>
                          </div>
                          <button onClick={() => removeFromCart(item.priceCode)}
                            className="text-gray-300 hover:text-red-500 transition-colors shrink-0">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-gray-400">매입원가</p>
                            <p className="text-xs font-mono text-gray-600">{fmt(item.basePrice)}</p>
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-[10px] text-gray-400">매출가 (수정가능)</p>
                            <input
                              type="number"
                              value={item.unitPrice}
                              onChange={(e) => updateCartItem(item.priceCode, "unitPrice", Number(e.target.value) || 0)}
                              className="w-full px-1.5 py-0.5 text-xs font-mono border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => updateCartItem(item.priceCode, "quantity", Math.max(1, item.quantity - 1))}
                              className="w-5 h-5 flex items-center justify-center bg-gray-100 rounded hover:bg-gray-200">
                              <Minus className="w-2.5 h-2.5" />
                            </button>
                            <span className="text-xs font-medium w-6 text-center">{item.quantity}</span>
                            <button onClick={() => updateCartItem(item.priceCode, "quantity", item.quantity + 1)}
                              className="w-5 h-5 flex items-center justify-center bg-gray-100 rounded hover:bg-gray-200">
                              <Plus className="w-2.5 h-2.5" />
                            </button>
                          </div>
                          <div className="text-right">
                            <p className={`text-[10px] font-medium ${color}`}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</p>
                            <p className="text-xs font-mono font-semibold text-gray-800">{fmt(item.unitPrice * item.quantity)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 합계 + 주문 */}
              {cartItems.length > 0 && (
                <div className="border-t border-gray-100 p-3 space-y-2">
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between text-gray-500">
                      <span>매입원가 합계</span>
                      <span className="font-mono">{fmt(cartBuyTotal)}</span>
                    </div>
                    <div className="flex justify-between font-medium text-gray-800">
                      <span>매출가 합계</span>
                      <span className="font-mono text-blue-700">{fmt(cartTotal)}</span>
                    </div>
                    <div className="flex justify-between text-gray-500">
                      <span>예상 이익</span>
                      <span className={`font-mono ${cartTotal > cartBuyTotal ? "text-green-600" : "text-red-500"}`}>
                        {cartTotal > cartBuyTotal ? "+" : ""}{fmt(cartTotal - cartBuyTotal)}
                        {cartBuyTotal > 0 && <span className="ml-1 text-[10px]">({((cartTotal - cartBuyTotal) / cartBuyTotal * 100).toFixed(1)}%)</span>}
                      </span>
                    </div>
                  </div>

                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="요청사항 (선택)"
                    rows={2}
                    className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />

                  {submitError && (
                    <p className="text-xs text-red-600 bg-red-50 p-2 rounded-lg">{submitError}</p>
                  )}
                  {submitSuccess && (
                    <p className="text-xs text-green-700 bg-green-50 p-2 rounded-lg flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />주문이 등록되었습니다!
                    </p>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={submitting || !selectedClient}
                    className="w-full flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {submitting
                      ? <><Loader2 className="w-4 h-4 animate-spin" />등록 중...</>
                      : <><Send className="w-4 h-4" />주문 등록</>}
                  </button>
                  {!selectedClient && (
                    <p className="text-[10px] text-center text-gray-400">거래처를 선택해야 주문할 수 있습니다</p>
                  )}
                  <button onClick={() => setCart(new Map())}
                    className="w-full text-xs text-gray-400 hover:text-red-500 transition-colors">
                    장바구니 비우기
                  </button>
                </div>
              )}
            </div>

            {/* 과거 주문내역 */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-gray-500" />
                  과거 주문내역
                  {selectedClient && <span className="text-xs font-normal text-gray-400">· {selectedClient.clientName}</span>}
                </h2>
                <span className="text-xs text-gray-400">{clientOrders.length}건</span>
              </div>

              {ordersLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
              ) : clientOrders.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">
                  {selectedClient ? "해당 거래처 주문내역 없음" : "주문내역이 없습니다"}
                </div>
              ) : (
                <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                  {clientOrders.map((o) => {
                    const st = STATUS_LABELS[o.status] ?? { label: o.status, color: "bg-gray-100 text-gray-600" };
                    const isExpanded = expandedOrder === o.id;
                    const total = o.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
                    return (
                      <div key={o.id}>
                        <button
                          type="button"
                          onClick={() => setExpandedOrder(isExpanded ? null : o.id)}
                          className="w-full px-3 py-2.5 hover:bg-gray-50 text-left flex items-start gap-2"
                        >
                          <ChevronRight className={`w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${st.color}`}>{st.label}</span>
                              <span className="text-xs text-gray-500">{o.clientName}</span>
                            </div>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-[11px] text-gray-400">{new Date(o.createdAt).toLocaleDateString("ko-KR")} · {o.items.length}품목</span>
                              <span className="text-xs font-mono text-gray-700">{fmt(total)}</span>
                            </div>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-2.5 space-y-1">
                            {o.note && <p className="text-[11px] text-gray-500 bg-gray-50 rounded px-2 py-1">{o.note}</p>}
                            <div className="border border-gray-100 rounded-lg overflow-hidden">
                              <table className="w-full text-[11px]">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-2 py-1.5 text-left text-gray-500 font-medium">품목</th>
                                    <th className="px-2 py-1.5 text-right text-gray-500 font-medium">단가</th>
                                    <th className="px-2 py-1.5 text-right text-gray-500 font-medium">수량</th>
                                    <th className="px-2 py-1.5 text-right text-gray-500 font-medium">금액</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {o.items.map((item, i) => (
                                    <tr key={i}>
                                      <td className="px-2 py-1.5">
                                        <p className="font-medium text-gray-700 leading-tight">{item.productName}</p>
                                        <p className="text-gray-400">{item.spec}</p>
                                      </td>
                                      <td className="px-2 py-1.5 text-right font-mono text-gray-600">{fmt(item.unitPrice)}</td>
                                      <td className="px-2 py-1.5 text-right text-gray-600">{item.quantity}</td>
                                      <td className="px-2 py-1.5 text-right font-mono font-medium text-gray-800">{fmt(item.unitPrice * item.quantity)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot className="border-t border-gray-100 bg-gray-50">
                                  <tr>
                                    <td colSpan={3} className="px-2 py-1.5 text-right text-gray-500 font-medium">합계</td>
                                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-blue-700">{fmt(total)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                            {o.confirmedAt && (
                              <p className="text-[10px] text-gray-400">확인: {new Date(o.confirmedAt).toLocaleDateString("ko-KR")}</p>
                            )}
                            {o.orderedAt && (
                              <p className="text-[10px] text-gray-400">주문완료: {new Date(o.orderedAt).toLocaleDateString("ko-KR")}</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 이익율 범례 */}
            {selectedClient && products.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <p className="text-xs font-medium text-gray-600 mb-2 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />이익율 기준
                </p>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 shrink-0" /><span className="text-gray-600">20% 초과</span></div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" /><span className="text-gray-600">0 ~ 20%</span></div>
                  <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0" /><span className="text-gray-600">0% 미만</span></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </RequireRole>
  );
}
