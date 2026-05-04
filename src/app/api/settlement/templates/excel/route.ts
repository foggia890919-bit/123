import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isNextResponse } from "@/lib/auth-guard";
import ExcelJS from "exceljs";

export const CANONICAL_COLS = [
  "사업자등록번호", "담당자명", "병의원명", "제약사명",
  "품목명", "보험코드", "약가", "수량",
  "매출금액", "정산서요율(%)", "처방월", "비고",
];

// GET /api/settlement/templates/excel?corp=뉴아이즈
// Returns an .xlsx template with:
//   Row1: A=매핑  B=메디펄스  C..N = canonical headers
//   Row2: A=매핑  B={corp}    C..N = mapped source columns (from saved templateif any)
//   Row3: (empty)
//   Row4: A=추가  B={corp}    C..  = all source cols (mapped ones in red)
//         -- source cols come from parsedHeaders saved on the template, if any
export async function GET(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const corp = req.nextUrl.searchParams.get("corp");
  if (!corp) return NextResponse.json({ error: "corp 필요" }, { status: 400 });

  // load saved template
  const tmpl = await prisma.settlementTemplate.findUnique({
    where: { userId_corpName: { userId: user.id, corpName: corp } },
    select: { columnMap: true },
  });

  const columnMap = (tmpl?.columnMap ?? {}) as Record<string, string>;
  // invert: canonical -> source
  const canonToSource: Record<string, string> = {};
  for (const [src, canon] of Object.entries(columnMap)) {
    canonToSource[canon] = src;
  }
  const mappedSourceCols = new Set(Object.keys(columnMap));

  // source headers (all known from columnMap keys)
  const allSourceCols = Object.keys(columnMap);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("매핑");

  // ── Row 1: 메디펄스 기준 헤더 ──────────────────────────────
  const row1 = ws.addRow(["매핑", "메디펄스", ...CANONICAL_COLS]);
  row1.eachCell((cell, colNum) => {
    cell.font = { bold: true };
    if (colNum === 1) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    } else if (colNum === 2) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    } else {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    }
    cell.border = {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" },
    };
  });

  // ── Row 2: 법인 매핑 행 (사용자가 채워넣거나 기존 매핑 표시) ──
  const mappingValues = CANONICAL_COLS.map((col) => canonToSource[col] ?? "");
  const row2 = ws.addRow(["매핑", corp, ...mappingValues]);
  row2.eachCell((cell, colNum) => {
    if (colNum === 1) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    } else if (colNum === 2) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
      cell.font = { bold: true, color: { argb: "FF1D4ED8" } };
    } else {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
      cell.font = { color: { argb: "FF1D4ED8" }, bold: true };
    }
    cell.border = {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" },
    };
  });

  // ── Row 3: 빈 행 구분선 ──────────────────────────────────────
  ws.addRow([]);

  // ── Row 4: 추가 행 — 법인의 전체 헤더 (매핑된 것 빨간색) ────
  if (allSourceCols.length > 0) {
    const row4 = ws.addRow(["추가", corp, ...allSourceCols]);
    row4.eachCell((cell, colNum) => {
      const val = cell.value as string;
      if (colNum === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      } else if (colNum === 2) {
        cell.font = { bold: true };
      } else if (mappedSourceCols.has(val)) {
        cell.font = { color: { argb: "FFDC2626" }, bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
      }
      cell.border = {
        top: { style: "thin" }, bottom: { style: "thin" },
        left: { style: "thin" }, right: { style: "thin" },
      };
    });
  } else {
    // placeholder row
    const row4 = ws.addRow(["추가", corp, "← 이 행에 법인의 전체 컬럼명을 붙여넣고 매핑된 것만 빨간색으로 표시"]);
    row4.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    row4.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  }

  // column widths
  ws.columns = [
    { width: 10 }, { width: 16 },
    ...CANONICAL_COLS.map(() => ({ width: 16 })),
    ...Array(30).fill({ width: 16 }),
  ];

  const buf = await wb.xlsx.writeBuffer();
  const body = new Uint8Array(buf as ArrayBuffer);
  return new NextResponse(body as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`매핑템플릿_${corp}.xlsx`)}`,
    },
  });
}

// POST /api/settlement/templates/excel
// Body: multipart OR JSON { corp, columnMap: {source: canonical} }
// Reads the mapping from uploaded xlsx (row 2 = mapping row) and saves to SettlementTemplate
export async function POST(req: NextRequest) {
  const user = await requireRole("BIZ");
  if (isNextResponse(user)) return user;

  const body = await req.json();
  const { corp, columnMap } = body as { corp: string; columnMap: Record<string, string> };

  if (!corp || !columnMap) {
    return NextResponse.json({ error: "corp, columnMap 필요" }, { status: 400 });
  }

  const existing = await prisma.settlementTemplate.findUnique({
    where: { userId_corpName: { userId: user.id, corpName: corp } },
    select: { id: true },
  });

  if (existing) {
    await prisma.settlementTemplate.update({
      where: { id: existing.id },
      data: { columnMap, updatedAt: new Date() },
    });
  } else {
    await prisma.settlementTemplate.create({
      data: {
        userId: user.id,
        corpName: corp,
        fileName: "매핑설정",
        fileKey: "",
        columnMap,
      },
    });
  }

  return NextResponse.json({ success: true });
}
