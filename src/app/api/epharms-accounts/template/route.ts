import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function GET() {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "ADMIN" && user.role !== "BIZ") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const reps = await prisma.user.findMany({
    where: { role: "SALES_REP", approved: true },
    select: { name: true, email: true },
    orderBy: [{ name: "asc" }],
  });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ePharms 계정");
  ws.columns = [
    { header: "거래처명",   key: "clientName", width: 24 },
    { header: "사업자번호", key: "bizNumber",  width: 16 },
    { header: "EPHARMS_ID", key: "loginId",    width: 18 },
    { header: "EPHARMS_PW", key: "loginPw",    width: 14 },
    { header: "영업사원",   key: "salesRep",   width: 32 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  ws.addRow({
    clientName: "예시) 브라운성형외과",
    bizNumber:  "2110948285",
    loginId:    "2110948285",
    loginPw:    "7777",
    salesRep:   reps[0] ? `${reps[0].name ?? ""}(${reps[0].email})` : "",
  });
  const formulaList = reps.map((r) => `${(r.name ?? "").replace(/"/g, "")}(${r.email})`).join(",");
  for (let i = 2; i <= 1000; i++) {
    ws.getCell(`E${i}`).dataValidation = {
      type: "list", allowBlank: true, formulae: [`"${formulaList}"`],
      showErrorMessage: true, errorTitle: "영업사원 선택",
      error: "드롭다운에서 영업사원을 선택해주세요.",
    };
  }
  const help = wb.addWorksheet("작성안내");
  help.columns = [{ header: "안내", key: "msg", width: 80 }];
  help.addRows([
    { msg: "■ 거래처명 / 사업자번호 / EPHARMS_ID / EPHARMS_PW: 필수" },
    { msg: "■ 사업자번호: 숫자만 (예: 2110948285)" },
    { msg: "■ 영업사원: E열 드롭다운 선택. 비워두면 매핑 없음." },
    { msg: "■ 같은 사업자번호가 있으면 갱신됩니다." },
    { msg: "■ 첫 행(예시)은 자동 무시 안 됩니다 — 지우고 작성하세요." },
  ]);
  help.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="epharms-accounts-template.xlsx"',
    },
  });
}
