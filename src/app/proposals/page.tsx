"use client";

import { useState, useEffect } from "react";
import { Trash2, FileDown, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/utils";
import type { ProposalCartItem } from "@/types";
import * as XLSX from "xlsx";
import RequireAuth from "@/components/RequireAuth";

export default function ProposalsPage() {
  const [cart, setCart] = useState<ProposalCartItem[]>([]);
  const [title, setTitle] = useState("제안서");

  useEffect(() => {
    const stored = localStorage.getItem("proposalCart");
    if (stored) setCart(JSON.parse(stored));
  }, []);

  function removeItem(id: string) {
    const updated = cart.filter((item) => item.id !== id);
    setCart(updated);
    localStorage.setItem("proposalCart", JSON.stringify(updated));
  }

  function clearCart() {
    setCart([]);
    localStorage.removeItem("proposalCart");
  }

  function exportToExcel() {
    const rows = cart.map((item, index) => ({
      순번: index + 1,
      "기존 품목명": item.originalMedication?.productName || "-",
      "기존 성분명": item.originalMedication?.ingredientName || "-",
      "기존 약가": item.originalMedication?.price || "-",
      "대체 품목명": item.altMedication?.productName || "-",
      "대체 성분명": item.altMedication?.ingredientName || "-",
      제약사: item.altMedication?.companyName || "-",
      약가: item.altMedication?.price || "-",
      "수수료율(%)": item.altMedication?.commissionRate || "-",
      보험코드: item.altMedication?.insuranceCode || "-",
      수량: item.quantity,
      비고: item.note || "",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "제안서");
    XLSX.writeFile(wb, `${title}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function exportToPDF() {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;

    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text(title, 14, 15);
    doc.setFontSize(9);
    doc.text(`작성일: ${new Date().toLocaleDateString("ko-KR")}`, 14, 22);

    autoTable(doc, {
      startY: 28,
      head: [["순번", "기존 품목명", "대체 품목명", "제약사", "약가", "수수료율", "보험코드", "수량"]],
      body: cart.map((item, i) => [
        i + 1,
        item.originalMedication?.productName || "-",
        item.altMedication?.productName || "-",
        item.altMedication?.companyName || "-",
        item.altMedication?.price ? `${item.altMedication.price.toLocaleString()}원` : "-",
        item.altMedication?.commissionRate ? `${item.altMedication.commissionRate}%` : "-",
        item.altMedication?.insuranceCode || "-",
        item.quantity,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
    });

    doc.save(`${title}_${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  return (
    <RequireAuth>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">제안서</h1>
          <p className="text-gray-500 mt-1">담긴 품목: {cart.length}개</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportToExcel} disabled={cart.length === 0}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            엑셀 출력
          </Button>
          <Button variant="outline" onClick={exportToPDF} disabled={cart.length === 0}>
            <FileDown className="w-4 h-4 mr-2" />
            PDF 출력
          </Button>
          <Button variant="destructive" onClick={clearCart} disabled={cart.length === 0}>
            전체 삭제
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">제안서 제목</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="max-w-xs" />
      </div>

      {cart.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 bg-white rounded-lg border border-gray-200">
          <p>담긴 품목이 없어요.</p>
          <p className="text-sm mt-1">검색 결과에서 장바구니 버튼을 눌러 추가하세요.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-semibold text-gray-600 w-8">#</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">기존 품목</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">대체 품목명</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">제약사</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">약가</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">수수료율</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">보험코드</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">수량</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cart.map((item, index) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-400">{index + 1}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {item.originalMedication?.productName || "-"}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {item.altMedication?.productName || "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.altMedication?.companyName || "-"}</td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {formatPrice(item.altMedication?.price)}
                  </td>
                  <td className="px-4 py-3 text-right text-blue-600 font-medium">
                    {item.altMedication?.commissionRate != null ? `${item.altMedication.commissionRate}%` : "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                    {item.altMedication?.insuranceCode || "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{item.quantity}</td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeItem(item.id)}
                      className="text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </RequireAuth>
  );
}
