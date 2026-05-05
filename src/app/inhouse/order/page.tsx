"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  ShoppingCart, Search, Plus, Minus, Trash2, Loader2, ChevronDown,
  X, CheckCircle2, ClipboardList, TrendingUp, Package, Send,
  ChevronRight, Clock, RotateCcw, CalendarDays,
} from "lucide-react";
import RequireRole from "@/components/RequireRole";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InhouseClient {
  id: string;
  clientName: string;
  bizNumber: string;
}

interface Product {
  priceCode: string;
  productName: string;
  manufacturer: string;
  spec: string | null;
  productGroup: string | null;
  ingredient: string | null;
  basePrice: number;
  suggestedPrice?: { value: number; source: string } | null;
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

interface OrderItem {
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
  items: OrderItem[];
}

interface RecentProduct {
  priceCode: string;
  productName: string;
  manufacturer: string;
  spec: string | null;
  lastBasePrice: number;
  lastUnitPrice: number;
  totalQty: number;
  orderCount: number;
  lastOrderDate: string;
}

interface LedgerEntry {
  id: string;
  entryDate: string;
  itemName: string;
  sales: number;
  payment: number;
  balance: number;
}

// ─── 도우미 ────────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString("ko-KR"); }

function margin(sell: number, buy: number) {
  if (!buy) return { pct: 0, color: "text-gray-400" };
  const pct = ((sell - buy) / buy) * 100;
  return { pct, color: pct > 20 ? "text-emerald-600" : pct > 0 ? "text-blue-600" : "text-red-500" };
}

function dateKST(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING:   { label: "대기",     color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  CONFIRMED: { label: "확인",     color: "bg-blue-50 text-blue-700 border-blue-200" },
  ORDERED:   { label: "주문완료", color: "bg-green-50 text-green-700 border-green-200" },
  REJECTED:  { label: "반려",     color: "bg-red-50 text-red-600 border-red-200" },
};

type Period = "1m" | "3m" | "custom";

// ─── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function InhouseOrderPage() {
  const { data: session } = useSession();

  // 거래처
  const [clients, setClients] = useState<InhouseClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<InhouseClient | null>(null);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const clientMenuRef = useRef<HTMLDivElement>(null);

  // 기간 필터
  const [period, setPeriod] = useState<Period>("1m");
  const [customFrom, setCustomFrom] = useState(dateKST(30));
  const [customTo, setCustomTo] = useState(dateKST(0));

  const periodFrom = useMemo(() => {
    if (period === "1m") return dateKST(30);
    if (period === "3m") return dateKST(90);
    return customFrom;
  }, [period, customFrom]);
  const periodTo = period === "custom" ? customTo : dateKST(0);

  // 전체 주문 내역 (최근 상품 + 히스토리 공용)
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // 이팜스 매출원장
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // 제품 검색
  const [searchQ, setSearchQ] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // 수량 입력 (테이블 인라인)
  const [qtyInput, setQtyInput] = useState<Record<string, string>>({});

  // 장바구니
  const [cart, setCart] = useState<Map<string, CartItem>>(new Map());

  // 과거 주문 펼치기
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // 주문 제출
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // 거래처 메뉴 외부 클릭 닫기
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (clientMenuRef.current && !clientMenuRef.current.contains(e.target as Node))
        setClientMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 내 거래처 로드
  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/epharms-accounts?own=true")
      .then((r) => r.json())
      .then((d) => setClients(Array.isArray(d.items) ? d.items : []));
  }, [session?.user?.id]);

  // 주문 내역 로드
  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await fetch("/api/inhouse-orders?limit=200");
      const data = await res.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } finally {
      setOrdersLoading(false);
    }
  }, []);
  useEffect(() => { loadOrders(); }, [loadOrders]);

  const loadLedger = useCallback(async (biz: string, from: string, to: string) => {
    setLedgerLoading(true);
    try {
      const r = await fetch(`/api/ledger?bizNumber=${biz.replace(/\D/g, "")}&from=${from}&to=${to}`);
      if (!r.ok) { setLedgerEntries([]); return; }
      const d = await r.json();
      setLedgerEntries(Array.isArray(d.entries) ? d.entries : []);
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClient) loadLedger(selectedClient.bizNumber, periodFrom, periodTo);
    else setLedgerEntries([]);
  }, [selectedClient, periodFrom, periodTo, loadLedger]);

  // 선택 거래처 + 기간 기준 최근 주문 상품 집계
  const recentProducts = useMemo((): RecentProduct[] => {
    if (!selectedClient) return [];
    const biz = selectedClient.bizNumber.replace(/\D/g, "");
    const fromDate = new Date(periodFrom);
    const toDate = new Date(periodTo + "T23:59:59");

    const filteredOrders = orders.filter((o) => {
      const d = new Date(o.createdAt);
      return (
        o.bizNumber.replace(/\D/g, "") === biz &&
        d >= fromDate &&
        d <= toDate &&
        o.status !== "REJECTED"
      );
    });

    const map = new Map<string, RecentProduct>();
    for (const order of filteredOrders) {
      for (const item of order.items) {
        const existing = map.get(item.priceCode);
        if (existing) {
          existing.totalQty += item.quantity;
          existing.orderCount += 1;
          if (order.createdAt > existing.lastOrderDate) {
            existing.lastOrderDate = order.createdAt;
            existing.lastBasePrice = item.basePrice;
            existing.lastUnitPrice = item.unitPrice;
          }
        } else {
          map.set(item.priceCode, {
            priceCode: item.priceCode,
            productName: item.productName,
            manufacturer: item.manufacturer,
            spec: item.spec,
            lastBasePrice: item.basePrice,
            lastUnitPrice: item.unitPrice,
            totalQty: item.quantity,
            orderCount: 1,
            lastOrderDate: order.createdAt,
          });
        }
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime()
    );
  }, [orders, selectedClient, periodFrom, periodTo]);

  // 제품 검색 (q 미입력 시 전체 로드)
  async function handleSearch(e?: React.FormEvent, overrideQ?: string) {
    e?.preventDefault();
    const q = overrideQ !== undefined ? overrideQ : searchQ;
    setProductLoading(true);
    setSearched(true);
    try {
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

  // 거래처 선택 시 자동 전체 로드
  useEffect(() => {
    if (selectedClient) handleSearch(undefined, searchQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient]);

  // 장바구니 추가 (Product or RecentProduct)
  function addToCart(item: {
    priceCode: string; productName: string; manufacturer: string; spec: string | null;
    basePrice: number; unitPrice?: number; suggestedPrice?: { value: number } | null;
  }) {
    if (!selectedClient) { alert("거래처를 먼저 선택해주세요."); return; }
    const qty = parseInt(qtyInput[item.priceCode] ?? "1", 10) || 1;
    const unitPrice = item.unitPrice ?? item.suggestedPrice?.value ?? item.basePrice;
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(item.priceCode);
      if (existing) {
        next.set(item.priceCode, { ...existing, quantity: existing.quantity + qty });
      } else {
        next.set(item.priceCode, {
          priceCode: item.priceCode,
          productName: item.productName,
          manufacturer: item.manufacturer,
          spec: item.spec,
          basePrice: item.basePrice,
          unitPrice,
          quantity: qty,
        });
      }
      return next;
    });
    setQtyInput((prev) => ({ ...prev, [item.priceCode]: "1" }));
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
      const res = await fetch("/api/inhouse-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: selectedClient.clientName,
          bizNumber: selectedClient.bizNumber.replace(/\D/g, ""),
          note: note.trim() || null,
          items: Array.from(cart.values()).map((c) => ({
            priceCode: c.priceCode,
            productName: c.productName,
            manufacturer: c.manufacturer,
            spec: c.spec ?? "",
            basePrice: c.basePrice,
            unitPrice: c.unitPrice,
            quantity: c.quantity,
          })),
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

  const clientOrders = useMemo(() => {
    if (!selectedClient) return [];
    const biz = selectedClient.bizNumber.replace(/\D/g, "");
    return orders
      .filter((o) => o.bizNumber.replace(/\D/g, "") === biz)
      .slice(0, 30);
  }, [orders, selectedClient]);

  const cartItems = Array.from(cart.values());
  const cartTotal = cartItems.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
  const cartBuyTotal = cartItems.reduce((s, c) => s + c.basePrice * c.quantity, 0);

  // ─── 공통 테이블 행 렌더 ───────────────────────────────────────────────────

  function ProductRow({
    priceCode, productName, manufacturer, spec, basePrice, sellPrice, badge,
  }: {
    priceCode: string; productName: string; manufacturer: string; spec: string | null;
    basePrice: number; sellPrice: number; badge?: React.ReactNode;
  }) {
    const { pct, color } = margin(sellPrice, basePrice);
    const inCart = cart.has(priceCode);
    return (
      <tr className={`hover:bg-blue-50/30 transition-colors ${inCart ? "bg-blue-50/20" : ""}`}>
        <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[100px] truncate">{manufacturer}</td>
        <td className="px-3 py-2.5">
          <div className="flex items-start gap-1.5">
            <div className="min-w-0">
              <p className="font-medium text-gray-800 leading-snug text-sm">{productName}</p>
              <p className="text-[11px] text-gray-400 font-mono">{priceCode}</p>
            </div>
            {badge}
          </div>
        </td>
        <td className="px-3 py-2.5 text-xs text-gray-500">{spec ?? "—"}</td>
        <td className="px-3 py-2.5 text-right text-sm font-mono text-gray-600">{fmt(basePrice)}</td>
        <td className="px-3 py-2.5 text-right text-sm font-mono font-medium text-blue-700">{fmt(sellPrice)}</td>
        <td className={`px-3 py-2.5 text-right text-xs font-medium ${color}`}>
          {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
        </td>
        <td className="px-3 py-2.5">
          <input
            type="number" min={1}
            value={qtyInput[priceCode] ?? "1"}
            onChange={(e) => setQtyInput((prev) => ({ ...prev, [priceCode]: e.target.value }))}
            className="w-14 px-1.5 py-1 text-sm text-center border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </td>
        <td className="px-3 py-2.5 text-center">
          <button
            onClick={() => addToCart({ priceCode, productName, manufacturer, spec, basePrice, unitPrice: sellPrice })}
            className={`p-1.5 rounded-lg transition-colors ${
              inCart ? "bg-blue-100 text-blue-600 hover:bg-blue-200" : "bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
          </button>
        </td>
      </tr>
    );
  }

  function TableHead() {
    return (
      <thead>
        <tr className="border-b border-gray-100 bg-gray-50/50">
          <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 w-24">제조사</th>
          <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500">상품명</th>
          <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 w-24">규격</th>
          <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 w-24">매입원가</th>
          <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 w-24">매출가</th>
          <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 w-16">이익율</th>
          <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 w-16">수량</th>
          <th className="px-3 py-2.5 w-12" />
        </tr>
      </thead>
    );
  }

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  const clientSelected = !!selectedClient;

  return (
    <RequireRole minRole="BASIC">
      <div className="space-y-4">

        {/* ── 상단: 거래처 선택 + 기간 ── */}
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <Package className="w-5 h-5 text-blue-600 shrink-0" />
          <h1 className="text-base font-bold text-gray-900 shrink-0">원내거래 주문</h1>

          {/* 거래처 선택 */}
          <div className="relative" ref={clientMenuRef}>
            <button
              onClick={() => setClientMenuOpen((v) => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                selectedClient
                  ? "bg-blue-50 border-blue-300 text-blue-800 font-medium"
                  : "bg-gray-50 border-gray-300 text-gray-500 hover:bg-gray-100"
              }`}
            >
              {selectedClient ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                  {selectedClient.clientName}
                  <span className="text-xs text-blue-400 font-mono">{selectedClient.bizNumber}</span>
                </>
              ) : (
                <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4" />거래처 선택 (필수)</span>
              )}
              <ChevronDown className={`w-4 h-4 transition-transform ${clientMenuOpen ? "rotate-180" : ""}`} />
              {selectedClient && (
                <span onClick={(e) => { e.stopPropagation(); setSelectedClient(null); setProducts([]); setSearched(false); }}
                  className="hover:text-red-500 ml-0.5"><X className="w-3.5 h-3.5" /></span>
              )}
            </button>
            {clientMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg w-72">
                <div className="p-2 border-b border-gray-100">
                  <input autoFocus value={clientQuery} onChange={(e) => setClientQuery(e.target.value)}
                    placeholder="거래처명 또는 사업자번호..."
                    className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="max-h-52 overflow-y-auto py-1">
                  {filteredClients.length === 0
                    ? <p className="text-center text-sm text-gray-400 py-4">등록된 거래처 없음</p>
                    : filteredClients.map((c) => (
                      <button key={c.id} onClick={() => { setSelectedClient(c); setClientMenuOpen(false); setClientQuery(""); }}
                        className={`w-full text-left px-4 py-2.5 hover:bg-blue-50 ${selectedClient?.id === c.id ? "bg-blue-50" : ""}`}>
                        <p className="text-sm font-medium text-gray-800">{c.clientName}</p>
                        <p className="text-xs text-gray-400 font-mono">{c.bizNumber}</p>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* 기간 필터 (거래처 선택 시만 표시) */}
          {clientSelected && (
            <div className="flex items-center gap-1.5 ml-auto">
              <Clock className="w-4 h-4 text-gray-400 shrink-0" />
              {(["1m", "3m", "custom"] as Period[]).map((p) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                    period === p ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                  }`}>
                  {p === "1m" ? "1개월" : p === "3m" ? "3개월" : "직접설정"}
                </button>
              ))}
              {period === "custom" && (
                <>
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  <span className="text-xs text-gray-400">~</span>
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </>
              )}
            </div>
          )}
        </div>

        {/* 거래처 미선택 시 안내 */}
        {!clientSelected && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
            <CalendarDays className="w-10 h-10 text-amber-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-amber-800">거래처를 먼저 선택해주세요</p>
            <p className="text-xs text-amber-600 mt-1">선택하면 해당 거래처의 최근 주문 상품과 단가가 표시됩니다</p>
          </div>
        )}

        {/* 거래처 선택 후 메인 */}
        {clientSelected && (
          <div className="flex gap-4 items-start">
            {/* ── 좌측: 상품 테이블 ── */}
            <div className="flex-1 min-w-0 space-y-4">

              {/* 최근 주문 상품 */}
              {ordersLoading ? (
                <div className="bg-white border border-gray-200 rounded-xl p-6 flex items-center justify-center gap-2 text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">주문내역 로딩 중...</span>
                </div>
              ) : recentProducts.length > 0 ? (
                <div className="bg-white border border-blue-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-blue-600 text-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RotateCcw className="w-4 h-4" />
                      <span className="font-semibold text-sm">최근 주문 상품</span>
                      <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{recentProducts.length}품목</span>
                    </div>
                    <span className="text-xs text-blue-200">
                      {period === "1m" ? "최근 1개월" : period === "3m" ? "최근 3개월" : `${periodFrom} ~ ${periodTo}`} 기준
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <TableHead />
                      <tbody className="divide-y divide-gray-50">
                        {recentProducts.map((p) => (
                          <ProductRow
                            key={p.priceCode}
                            priceCode={p.priceCode}
                            productName={p.productName}
                            manufacturer={p.manufacturer}
                            spec={p.spec}
                            basePrice={p.lastBasePrice}
                            sellPrice={p.lastUnitPrice}
                            badge={
                              <span className="shrink-0 text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                {p.orderCount}회 · {p.totalQty}개
                              </span>
                            }
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : ledgerLoading ? (
                <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-center gap-2 text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">이팜스 구매이력 로딩 중...</span>
                </div>
              ) : ledgerEntries.length > 0 ? (
                <div className="bg-white border border-purple-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-purple-600 text-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="w-4 h-4" />
                      <span className="font-semibold text-sm">이팜스 구매이력</span>
                      <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{ledgerEntries.length}건</span>
                    </div>
                    <span className="text-xs text-purple-200">
                      {period === "1m" ? "최근 1개월" : period === "3m" ? "최근 3개월" : `${periodFrom} ~ ${periodTo}`} 기준
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">날짜</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">품목</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-medium w-24">금액</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {ledgerEntries.map((e) => (
                          <tr key={e.id} className="hover:bg-purple-50/30">
                            <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{e.entryDate.slice(0, 10)}</td>
                            <td className="px-3 py-2 text-gray-800">{e.itemName}</td>
                            <td className="px-3 py-2 text-right font-mono text-gray-700">{fmt(e.sales)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 text-gray-400">
                  <RotateCcw className="w-4 h-4 shrink-0" />
                  <p className="text-sm">
                    {period === "1m" ? "최근 1개월" : period === "3m" ? "최근 3개월" : "선택 기간"} 내 구매 이력이 없습니다
                  </p>
                </div>
              )}

              {/* 전체 상품 검색 */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <form onSubmit={handleSearch} className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
                        placeholder="상품명 / 성분명 / 제조사 / 코드 검색"
                        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <button type="submit"
                      className="flex items-center gap-1.5 px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-lg">
                      <Search className="w-4 h-4" />검색
                    </button>
                    {searched && (
                      <button type="button" onClick={() => { setSearchQ(""); handleSearch(undefined, ""); }}
                        className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </form>
                </div>

                {!searched ? (
                  <div className="p-8 text-center text-sm text-gray-400">
                    거래처를 선택하면 자동으로 상품 목록이 로드됩니다
                  </div>
                ) : productLoading ? (
                  <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                ) : products.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">검색 결과가 없습니다</div>
                ) : (
                  <>
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                      <p className="text-xs text-gray-500">
                        {searchQ.trim() ? "검색결과" : "전체 상품"} <span className="font-semibold text-gray-700">{products.length}개</span>
                        <span className="ml-2 text-blue-600">· {selectedClient.clientName} 단가 적용</span>
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <TableHead />
                        <tbody className="divide-y divide-gray-50">
                          {products.map((p) => (
                            <ProductRow
                              key={p.priceCode}
                              priceCode={p.priceCode}
                              productName={p.productName}
                              manufacturer={p.manufacturer}
                              spec={p.spec}
                              basePrice={p.basePrice}
                              sellPrice={p.suggestedPrice?.value ?? p.basePrice}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── 우측 패널 ── */}
            <div className="w-72 shrink-0 space-y-4">

              {/* 장바구니 */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-blue-600 text-white flex items-center justify-between">
                  <h2 className="font-semibold flex items-center gap-2 text-sm">
                    <ShoppingCart className="w-4 h-4" />장바구니
                  </h2>
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{cartItems.length}품목</span>
                </div>

                {cartItems.length === 0 ? (
                  <div className="p-6 text-center">
                    <ShoppingCart className="w-7 h-7 text-gray-200 mx-auto mb-1" />
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
                              <p className="text-xs font-medium text-gray-800 leading-tight truncate">{item.productName}</p>
                              <p className="text-[11px] text-gray-400">{item.spec ?? item.manufacturer}</p>
                            </div>
                            <button onClick={() => removeFromCart(item.priceCode)}
                              className="text-gray-300 hover:text-red-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <div>
                              <p className="text-[10px] text-gray-400">매입원가</p>
                              <p className="text-xs font-mono text-gray-600">{fmt(item.basePrice)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-400">매출가</p>
                              <input type="number" value={item.unitPrice}
                                onChange={(e) => updateCartItem(item.priceCode, "unitPrice", Number(e.target.value) || 0)}
                                className="w-full px-1.5 py-0.5 text-xs font-mono border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
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

                {cartItems.length > 0 && (
                  <div className="border-t border-gray-100 p-3 space-y-2">
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between text-gray-500">
                        <span>매입 합계</span><span className="font-mono">{fmt(cartBuyTotal)}</span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span>매출 합계</span><span className="font-mono text-blue-700">{fmt(cartTotal)}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-100 pt-1">
                        <span className="text-gray-500">예상 이익</span>
                        <span className={`font-mono font-medium ${cartTotal >= cartBuyTotal ? "text-emerald-600" : "text-red-500"}`}>
                          {cartTotal >= cartBuyTotal ? "+" : ""}{fmt(cartTotal - cartBuyTotal)}
                          {cartBuyTotal > 0 && <span className="ml-1 text-[10px]">({((cartTotal - cartBuyTotal) / cartBuyTotal * 100).toFixed(1)}%)</span>}
                        </span>
                      </div>
                    </div>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="배송 요청사항 (선택)" rows={2}
                      className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    {submitError && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{submitError}</p>}
                    {submitSuccess && (
                      <p className="text-xs text-green-700 bg-green-50 p-2 rounded flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />주문이 등록됐습니다!
                      </p>
                    )}
                    <button onClick={handleSubmit} disabled={submitting}
                      className="w-full flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                      {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />등록 중...</> : <><Send className="w-4 h-4" />주문 등록</>}
                    </button>
                    <button onClick={() => setCart(new Map())} className="w-full text-xs text-gray-400 hover:text-red-500">
                      장바구니 비우기
                    </button>
                  </div>
                )}
              </div>

              {/* 이익율 범례 */}
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <p className="text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />이익율
                </p>
                <div className="space-y-1 text-xs text-gray-500">
                  <div className="flex gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 mt-0.5 shrink-0" />20% 초과</div>
                  <div className="flex gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 mt-0.5 shrink-0" />0~20%</div>
                  <div className="flex gap-2"><span className="w-2 h-2 rounded-full bg-red-500 mt-0.5 shrink-0" />0% 미만</div>
                </div>
              </div>

              {/* 이팜스 구매내역 */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-gray-500" />이팜스 구매내역
                  </h2>
                  <span className="text-xs text-gray-400">{ledgerEntries.length}건</span>
                </div>
                {ledgerLoading ? (
                  <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-300" /></div>
                ) : ledgerEntries.length === 0 ? (
                  <div className="py-6 text-center text-xs text-gray-400">구매내역 없음</div>
                ) : (
                  <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                    {ledgerEntries.map((e) => (
                      <div key={e.id} className="px-3 py-2.5">
                        <div className="flex justify-between items-start gap-1">
                          <p className="text-xs text-gray-700 leading-tight flex-1 min-w-0 break-words">{e.itemName}</p>
                          <p className="text-xs font-mono text-gray-600 shrink-0 ml-1">{fmt(e.sales)}</p>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">{e.entryDate.slice(0, 10)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </RequireRole>
  );
}
