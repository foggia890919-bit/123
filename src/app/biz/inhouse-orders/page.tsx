"use client";

import { useState, useEffect, useCallback } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Package,
  ShoppingCart,
} from "lucide-react";

type OrderStatus = "PENDING" | "CONFIRMED" | "ORDERED" | "REJECTED";

interface OrderItem {
  id: string;
  priceCode: string;
  productName: string;
  manufacturer: string;
  spec: string | null;
  basePrice: number | null;
  unitPrice: number | null;
  quantity: number;
}

interface Order {
  id: string;
  clientName: string;
  bizNumber: string | null;
  status: OrderStatus;
  note: string | null;
  confirmedAt: string | null;
  orderedAt: string | null;
  createdAt: string;
  items: OrderItem[];
  user: { id: string; name: string | null; email: string; salesCode: string | null };
}

const STATUS_META: Record<OrderStatus, { label: string; color: string; icon: React.ReactNode }> = {
  PENDING: {
    label: "접수",
    color: "bg-yellow-100 text-yellow-800",
    icon: <Clock className="w-3 h-3" />,
  },
  CONFIRMED: {
    label: "확인",
    color: "bg-blue-100 text-blue-800",
    icon: <CheckCircle className="w-3 h-3" />,
  },
  ORDERED: {
    label: "주문완료",
    color: "bg-green-100 text-green-800",
    icon: <Package className="w-3 h-3" />,
  },
  REJECTED: {
    label: "반려",
    color: "bg-red-100 text-red-800",
    icon: <XCircle className="w-3 h-3" />,
  },
};

const STATUS_TABS: Array<{ key: OrderStatus | "ALL"; label: string }> = [
  { key: "ALL", label: "전체" },
  { key: "PENDING", label: "접수" },
  { key: "CONFIRMED", label: "확인" },
  { key: "ORDERED", label: "주문완료" },
  { key: "REJECTED", label: "반려" },
];

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: "CONFIRMED",
  CONFIRMED: "ORDERED",
};

function formatKST(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmt(n: number | null) {
  if (n === null) return "-";
  return n.toLocaleString("ko-KR") + "원";
}

export default function InhouseOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [tab, setTab] = useState<OrderStatus | "ALL">("PENDING");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [patching, setPatching] = useState<Set<string>>(new Set());

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const qs = tab !== "ALL" ? `?status=${tab}` : "";
      const res = await fetch(`/api/inhouse-orders${qs}`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function patchStatus(id: string, status: OrderStatus) {
    setPatching((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/inhouse-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === id
              ? { ...o, status, confirmedAt: status === "CONFIRMED" ? new Date().toISOString() : o.confirmedAt, orderedAt: status === "ORDERED" ? new Date().toISOString() : o.orderedAt }
              : o
          )
        );
      }
    } finally {
      setPatching((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function rejectOrder(id: string) {
    if (!confirm("이 주문을 반려하시겠습니까?")) return;
    await patchStatus(id, "REJECTED");
  }

  const filtered = tab === "ALL" ? orders : orders.filter((o) => o.status === tab);

  return (
    <BizLayout>
      <div className="space-y-4">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              원내거래 주문관리
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              영업사원이 요청한 원내거래 주문을 확인하고 처리합니다
            </p>
          </div>
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </button>
        </div>

        {/* 상태 탭 */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === key
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
              {key !== "ALL" && (
                <span className="ml-1 text-xs text-gray-400">
                  ({orders.filter((o) => o.status === key).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 주문 목록 */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">주문이 없습니다</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((order) => {
              const meta = STATUS_META[order.status];
              const isExpanded = expanded.has(order.id);
              const isPending = patching.has(order.id);
              const nextStatus = NEXT_STATUS[order.status];

              return (
                <div
                  key={order.id}
                  className="bg-white border border-gray-200 rounded-xl overflow-hidden"
                >
                  {/* 주문 요약 행 */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => toggleExpand(order.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                    )}

                    <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center">
                      {/* 거래처 + 담당자 */}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {order.clientName}
                          {order.bizNumber && (
                            <span className="text-xs text-gray-400 font-normal ml-1">
                              ({order.bizNumber})
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          {order.user.name ?? order.user.email}
                          {order.user.salesCode && (
                            <span className="ml-1 text-gray-400">· {order.user.salesCode}</span>
                          )}
                          {" · "}
                          {order.items.length}개 품목
                          {" · "}
                          {formatKST(order.createdAt)}
                        </p>
                      </div>

                      {/* 상태 뱃지 */}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${meta.color}`}
                      >
                        {meta.icon}
                        {meta.label}
                      </span>

                      {/* 다음 단계 버튼 */}
                      {nextStatus && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            patchStatus(order.id, nextStatus);
                          }}
                          disabled={isPending}
                          className="px-3 py-1 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
                        >
                          {isPending
                            ? "처리 중..."
                            : nextStatus === "CONFIRMED"
                            ? "확인"
                            : "주문완료"}
                        </button>
                      )}

                      {/* 반려 버튼 (PENDING/CONFIRMED에서만) */}
                      {(order.status === "PENDING" || order.status === "CONFIRMED") && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            rejectOrder(order.id);
                          }}
                          disabled={isPending}
                          className="px-3 py-1 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          반려
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 확장 - 품목 상세 */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                      {order.note && (
                        <p className="text-xs text-gray-600 mb-2 bg-yellow-50 border border-yellow-100 rounded px-2 py-1">
                          📝 {order.note}
                        </p>
                      )}

                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400 border-b border-gray-200">
                              <th className="text-left py-1.5 pr-3 font-medium">품목명</th>
                              <th className="text-left py-1.5 pr-3 font-medium">제조사</th>
                              <th className="text-left py-1.5 pr-3 font-medium">규격</th>
                              <th className="text-right py-1.5 pr-3 font-medium">기준가</th>
                              <th className="text-right py-1.5 pr-3 font-medium">단가</th>
                              <th className="text-right py-1.5 font-medium">수량</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {order.items.map((item) => (
                              <tr key={item.id} className="text-gray-700">
                                <td className="py-1.5 pr-3 font-medium">{item.productName}</td>
                                <td className="py-1.5 pr-3 text-gray-500">{item.manufacturer || "-"}</td>
                                <td className="py-1.5 pr-3 text-gray-500">{item.spec || "-"}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(item.basePrice)}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(item.unitPrice)}</td>
                                <td className="py-1.5 text-right font-semibold">{item.quantity}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* 타임스탬프 */}
                      <div className="flex gap-4 mt-2 text-[11px] text-gray-400">
                        <span>접수: {formatKST(order.createdAt)}</span>
                        {order.confirmedAt && <span>확인: {formatKST(order.confirmedAt)}</span>}
                        {order.orderedAt && <span>주문완료: {formatKST(order.orderedAt)}</span>}
                      </div>
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
