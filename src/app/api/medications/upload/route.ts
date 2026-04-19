import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const isSettlement = formData.get("isSettlement") === "true";

    if (!file) {
      return NextResponse.json({ error: "파일이 없어요." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: "" });

    const medications = rows
      .filter((row) => row["성분명"] || row["품목명"])
      .map((row) => ({
        categoryA: String(row["분류(A)"] || row["분류A"] || "").trim() || null,
        ingredientName: String(row["성분명"] || "").trim(),
        categoryB: String(row["분류(B)"] || row["분류B"] || "").trim() || null,
        commissionRate: parseFloat(String(row["코드"] || "")) || null,
        companyName: String(row["제약사명"] || "").trim(),
        bioStatus: String(row["생동/생산"] || "").trim() || null,
        productName: String(row["품목명"] || "").trim(),
        price: parseInt(String(row["약가"] || "")) || null,
        originalDrug: String(row["오리지날/대조약"] || "").trim() || null,
        insuranceCode: String(row["보험코드"] || "").trim() || null,
        notes: String(row["특이사항"] || "").trim() || null,
        isSettlement,
        source: "EXCEL" as const,
      }))
      .filter((m) => m.ingredientName && m.productName);

    if (medications.length === 0) {
      return NextResponse.json({ error: "유효한 데이터가 없어요. 컬럼명을 확인해주세요." }, { status: 400 });
    }

    await prisma.medication.createMany({ data: medications, skipDuplicates: false });

    return NextResponse.json({ success: true, count: medications.length });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "업로드 중 오류가 발생했어요." }, { status: 500 });
  }
}
