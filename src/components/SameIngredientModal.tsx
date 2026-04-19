"use client";

import { useState, useEffect } from "react";
import { X, ShoppingCart } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import AddToProposalDialog from "./AddToProposalDialog";
import type { MedicationItem } from "@/types";

interface Props {
  ingredientName: string;
  userId?: string;
  onClose: () => void;
}

export default function SameIngredientModal({ ingredientName, userId, onClose }: Props) {
  const [medications, setMedications] = useState<MedicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [proposalTarget, setProposalTarget] = useState<MedicationItem | null>(null);

  useEffect(() => {
    const uid = userId ? `&userId=${userId}` : "";
    fetch(`/api/medications/search?q=${encodeURIComponent(ingredientName)}${uid}&limit=200`)
      .then((r) => r.json())
      .then((d) => { setMedications(d.medications || []); setTotal(d.total || 0); })
      .finally(() => setLoading(false));
  }, [ingredientName, userId]);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
            <div>
              <h2 className="font-bold text-gray-900">동일성분 검색</h2>
              <p className="text-xs text-gray-500 mt-0.5">{ingredientName} · 총 {total}개 품목</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="overflow-auto flex-1">
            {loading ? (
              <div className="flex justify-center py-16 text-gray-400 text-sm">검색 중...</div>
            ) : medications.length === 0 ? (
              <div className="flex justify-center py-16 text-gray-400 text-sm">결과가 없어요.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                  <tr className="text-xs text-gray-500 font-semibold">
                    <th className="px-4 py-3 text-left">제품명</th>
                    <th className="px-4 py-3 text-left">성분명</th>
                    <th className="px-4 py-3 text-left">제약사</th>
                    <th className="px-4 py-3 text-left">보험코드</th>
                    <th className="px-4 py-3 text-right">약가</th>
                    {medications.some((m) => m.commissionRate != null) && (
                      <th className="px-4 py-3 text-right">수수료</th>
                    )}
                    <th className="px-4 py-3 text-center w-24">제안서</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {medications.map((med) => (
                    <tr key={med.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-gray-900 text-xs">{med.productName}</p>
                        {med.categoryA && <span className="text-xs text-gray-400">{med.categoryA}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[160px] truncate">{med.ingredientName}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">{med.companyName}</td>
                      <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{med.insuranceCode || "-"}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-700">{formatPrice(med.price)}</td>
                      {medications.some((m) => m.commissionRate != null) && (
                        <td className="px-4 py-2.5 text-right text-xs text-blue-600 font-medium">
                          {med.commissionRate != null ? `${med.commissionRate}%` : "-"}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-center">
                        {userId ? (
                          <button onClick={() => setProposalTarget(med)}
                            className="text-xs text-white bg-green-600 hover:bg-green-700 rounded px-2 py-1 flex items-center gap-1 mx-auto whitespace-nowrap">
                            <ShoppingCart className="w-3 h-3" />추가
                          </button>
                        ) : (
                          <span className="text-xs text-gray-300">로그인 필요</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {proposalTarget && userId && (
        <AddToProposalDialog
          medication={proposalTarget}
          userId={userId}
          onClose={() => setProposalTarget(null)}
        />
      )}
    </>
  );
}
