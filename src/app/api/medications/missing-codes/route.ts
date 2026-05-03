import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import * as XLSX from "xlsx";

// GET /api/medications/missing-codes
// ?format=json  → 카운트 + 샘플만 (기본)
// ?format=excel → 전체 목록 Excel 다운로드
// ?format=excel&hasInsuranceCode=true → 보험코드 있는 것만 (sync 타겟 우선순위)

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const format = req.nextUrl.searchParams.get("format") ?? "json";
  const hasInsuranceCode = req.nextUrl.searchParams.get("hasInsuranceCode") === "true";

  const where = {
    ingredientCode: null,
    ...(hasInsuranceCode ? { insuranceCode: { not: null } } : {}),
  };

  if (format === "json") {
    const [missingCount, total, sample] = await Promise.all([
      prisma.medication.count({ where }),
      prisma.medication.count(),
      prisma.medication.findMany({
        where,
        select: {
          productName: true, insuranceCode: true, companyName: true, ingredientName: true,
        },
        take: 10,
        orderBy: { companyName: "asc" },
      }),
    ]);
    return NextResponse.json({ missingCount, total, sample });
  }

  // Excel 다운로드
  const rows = await prisma.medication.findMany({
    where,
    select: {
      productName: true,
      insuranceCode: true,
      companyName: true,
      ingredientName: true,
      categoryA: true,
      categoryB: true,
    },
    orderBy: [{ companyName: "asc" }, { productName: "asc" }],
  });

  const header = ["품목명", "보험코드(EDI)", "제약사", "성분명(현재)", "분류A", "ATC분류"];
  const data = rows.map((r) => [
    r.productName ?? "",
    r.insuranceCode ?? "",
    r.companyName ?? "",
    r.ingredientName ?? "",
    r.categoryA ?? "",
    r.categoryB ?? "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws["!cols"] = [30, 14, 20, 30, 20, 12].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "주성분코드 공란");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const label = hasInsuranceCode ? "보험코드있음_주성분코드공란" : "주성분코드공란_전체";
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${label}_${dateStr}.xlsx`)}`,
    },
  });
}
