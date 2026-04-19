"use client";

import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/utils";
import type { MedicationItem } from "@/types";

interface Props {
  medications: MedicationItem[];
  loading?: boolean;
}

export default function MedicationTable({ medications, loading }: Props) {
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

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-gray-400">
        검색 중...
      </div>
    );
  }

  if (medications.length === 0) {
    return (
      <div className="flex justify-center py-16 text-gray-400">
        검색 결과가 없어요.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-4 py-3 text-left font-semibold text-gray-600">성분명</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-600">품목명</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-600">제약사</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-600">생동/생산</th>
            <th className="px-4 py-3 text-right font-semibold text-gray-600">약가</th>
            <th className="px-4 py-3 text-right font-semibold text-gray-600">수수료율</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-600">보험코드</th>
            <th className="px-4 py-3 text-left font-semibold text-gray-600">정산</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {medications.map((med) => (
            <tr key={med.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 text-gray-700">{med.ingredientName}</td>
              <td className="px-4 py-3 font-medium text-gray-900">{med.productName}</td>
              <td className="px-4 py-3 text-gray-600">{med.companyName}</td>
              <td className="px-4 py-3">
                {med.bioStatus && (
                  <Badge variant={med.bioStatus.includes("생동") ? "success" : "secondary"}>
                    {med.bioStatus}
                  </Badge>
                )}
              </td>
              <td className="px-4 py-3 text-right text-gray-700">{formatPrice(med.price)}</td>
              <td className="px-4 py-3 text-right font-medium text-blue-600">
                {med.commissionRate != null ? `${med.commissionRate}%` : "-"}
              </td>
              <td className="px-4 py-3 text-gray-500 font-mono text-xs">{med.insuranceCode || "-"}</td>
              <td className="px-4 py-3">
                {med.isSettlement ? (
                  <Badge variant="success">정산</Badge>
                ) : (
                  <Badge variant="secondary">비정산</Badge>
                )}
              </td>
              <td className="px-4 py-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addToProposal(med)}
                  title="제안서에 추가"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
