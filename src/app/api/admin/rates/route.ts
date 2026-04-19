import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

// 특정 회원의 제약사별 추가수수료 조회
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId 필요" }, { status: 400 });

  // DB에 있는 모든 제약사 목록
  const companies = await prisma.medication.findMany({
    where: { isSettlement: true },
    select: { companyName: true },
    distinct: ["companyName"],
    orderBy: { companyName: "asc" },
  });

  // 해당 회원의 설정된 추가수수료
  const rates = await prisma.memberCompanyRate.findMany({ where: { userId } });
  const rateMap = Object.fromEntries(rates.map((r) => [r.companyName, r.additionalRate]));

  const result = companies.map((c) => ({
    companyName: c.companyName,
    additionalRate: rateMap[c.companyName] ?? 0,
  }));

  return NextResponse.json(result);
}

// 엑셀 업로드로 추가수수료 일괄 등록
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const userId = formData.get("userId") as string;
  const file = formData.get("file") as File;

  if (!userId || !file) return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<{ A: string; B: number }>(sheet, {
    header: ["A", "B"], range: 1,
  });

  const data = rows
    .filter((r) => r.A && r.B != null && !isNaN(Number(r.B)))
    .map((r) => ({ companyName: String(r.A).trim(), additionalRate: Number(r.B) }));

  let count = 0;
  for (const { companyName, additionalRate } of data) {
    await prisma.memberCompanyRate.upsert({
      where: { userId_companyName: { userId, companyName } },
      update: { additionalRate, updatedAt: new Date() },
      create: { userId, companyName, additionalRate, updatedAt: new Date() },
    });
    count++;
  }

  return NextResponse.json({ success: true, count });
}

// 제약사 목록 엑셀 다운로드
export async function PUT(req: NextRequest) {
  const { userId } = await req.json();

  const companies = await prisma.medication.findMany({
    where: { isSettlement: true },
    select: { companyName: true },
    distinct: ["companyName"],
    orderBy: { companyName: "asc" },
  });

  const rates = userId
    ? await prisma.memberCompanyRate.findMany({ where: { userId } })
    : [];
  const rateMap = Object.fromEntries(rates.map((r) => [r.companyName, r.additionalRate]));

  const rows = [
    ["제약사명", "추가수수료(%)"],
    ...companies.map((c) => [c.companyName, rateMap[c.companyName] ?? 0]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 30 }, { wch: 15 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "추가수수료");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="additional_rates.xlsx"`,
    },
  });
}
