"use client";

import { ShoppingCart, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/utils";
import type { MedicationItem } from "@/types";

interface Props {
  medications: MedicationItem[];
  loading?: boolean;
  showStock?: boolean;
  showRate?: boolean;
}

function StockBadge() {
  return <Badge variant="secondary">-</Badge>;
}

export default function MedicationTable({ medications, loading, showStock, showRate }: Props) {
  function addToProposal(med: MedicationItem) {
    const stored = localStorage.getItem("proposalCart");
    const cart = stored ? JSON.parse(stored) : [];
    const exists = cart.find((item: { altMedication: MedicationItem }) => item.altMedication?.id === med.id);
    if (!exists) {
      cart.push({ id: crypto.randomUUID(), altMedication: med, quantity: 1, order: cart.length });
      localStorage.setItem("proposalCart", JSON.stringify(cart));
      alert(`"${med.productName}" 제안서에 추가됐어요.`);
    } else {
      alert("이미 제안서에 담긴 품목이에요.");
    }
  }

  function searchSameIngredient(ingredientName: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("q", ingredientName);
    window.location.href = url.toString();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-gray-400 text-sm">검색 중...</div>
    );
  }

  if (medications.length === 0) {
    return (
      <div className="flex justify-center py-16 text-gray-400 text-sm">검색 결과가 없어요.</div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 font-semibold">
            <th className="px-4 py-3 text-left">제품명</th>
            <th className="px-4 py-3 text-left">성분명</th>
            <th className="px-4 py-3 text-center w-28"></th>
            {showStock && <th className="px-4 py-3 text-center">재고</th>}
            <th className="px-4 py-3 text-right">약가</th>
            {showRate && (
              <>
                <th className="px-4 py-3 text-right">기본수수료</th>
                <th className="px-4 py-3 text-right">추가수수료</th>
                <th className="px-4 py-3 text-right">합계수수료</th>
                <th className="px-4 py-3 text-right">정산금액</th>
              </>
            )}
            <th className="px-4 py-3 text-center w-24"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {medications.map((med) => (
            <tr key={med.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-start gap-2">
                  {med.categoryA && (
                    <span className="mt-0.5 shrink-0 text-xs border border-gray-300 text-gray-500 rounded px-1.5 py-0.5 whitespace-nowrap">
                      {med.categoryA}
                    </span>
                  )}
                  <div>
                    <p className="font-medium text-gray-900">{med.productName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{med.companyName}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                {med.ingredientName}
              </td>
              <td className="px-4 py-3 text-center">
                <button
                  onClick={() => searchSameIngredient(med.ingredientName)}
                  className="text-xs text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded px-2 py-1 whitespace-nowrap transition-colors"
                >
                  <Search className="w-3 h-3 inline mr-1" />
                  동일성분
                </button>
              </td>
              {showStock && (
                <td className="px-4 py-3 text-center">
                  <StockBadge />
                </td>
              )}
              <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">
                {formatPrice(med.price)}
              </td>
              {showRate && (() => {
                const base = med.commissionRate ?? null;
                const extra = med.additionalRate ?? null;
                const total = base != null ? base + (extra ?? 0) : null;
                const settlement = med.price != null && total != null
                  ? Math.round(med.price * total / 100)
                  : null;
                return (
                  <>
                    <td className="px-4 py-3 text-right text-blue-600 font-medium whitespace-nowrap">
                      {base != null ? `${base}%` : "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                      {extra != null ? `${extra}%` : "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-blue-700 whitespace-nowrap">
                      {total != null ? `${total}%` : "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700 whitespace-nowrap">
                      {settlement != null ? `${settlement.toLocaleString()}원` : "-"}
                    </td>
                  </>
                );
              })()}
              <td className="px-4 py-3 text-center">
                <button
                  onClick={() => addToProposal(med)}
                  className="text-xs text-white bg-green-600 hover:bg-green-700 rounded px-3 py-1.5 whitespace-nowrap transition-colors flex items-center gap-1 mx-auto"
                >
                  <ShoppingCart className="w-3 h-3" />
                  제안서 추가
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
