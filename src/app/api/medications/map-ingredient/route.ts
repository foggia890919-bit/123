import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) return NextResponse.json({ error: "파일이 없어요." }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: "" });

    // 제품코드 → 주성분코드 맵 생성
    const codeMap = new Map<string, string>();
    for (const row of rows) {
      const ingredientCode = String(row["주성분코드"] ?? "").trim();
      const productCode = String(row["제품코드"] ?? "").trim();
      if (ingredientCode && productCode) {
        codeMap.set(productCode, ingredientCode);
      }
    }

    if (codeMap.size === 0) {
      return NextResponse.json({ error: "유효한 데이터가 없어요. 주성분코드/제품코드 컬럼을 확인해주세요." }, { status: 400 });
    }

    const allCodes = Array.from(codeMap.keys());
    let updated = 0;
    const BATCH = 1000;

    for (let i = 0; i < allCodes.length; i += BATCH) {
      const batch = allCodes.slice(i, i + BATCH);
      // insuranceCode가 쉼표 구분 다중값일 수 있으므로 UNNEST로 각 코드 매칭
      const matchRows = await prisma.$queryRaw<{ id: string; matched: string }[]>`
        SELECT m.id, TRIM(code) AS matched
        FROM "Medication" m,
             UNNEST(string_to_array(m."insuranceCode", ',')) AS code
        WHERE m."insuranceCode" IS NOT NULL
          AND TRIM(code) = ANY(${batch})
      `;

      // 같은 id에 여러 코드가 매칭될 수 있으므로 첫 번째만 사용
      const seen = new Set<string>();
      for (const row of matchRows) {
        if (seen.has(row.id)) continue;
        const categoryB = codeMap.get(row.matched);
        if (!categoryB) continue;
        seen.add(row.id);
        await prisma.medication.update({
          where: { id: row.id },
          data: { ingredientCode: categoryB, updatedAt: new Date() },
        });
        updated++;
      }
    }

    return NextResponse.json({ success: true, mapped: codeMap.size, updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `오류: ${msg}` }, { status: 500 });
  }
}
