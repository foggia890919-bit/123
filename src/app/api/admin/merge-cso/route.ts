import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// EXCEL 레코드의 CSO(isSettlement=true) 수수료·분류 데이터를
// 보험코드 정규화 매칭으로 PUBLIC_API 레코드에 반영
export async function POST() {
  try {
    // ① EXCEL 소스 중 isSettlement=true 인 레코드만 추출 (보험코드 있는 것)
    const excelRows = await prisma.$queryRawUnsafe<{
      id: string;
      insuranceCode: string;
      commissionRate: number | null;
      isSettlement: boolean;
      settlementType: string | null;
      categoryA: string | null;
      categoryB: string | null;
    }[]>(`
      SELECT id, "insuranceCode", "commissionRate", "isSettlement", "settlementType",
             "categoryA", "categoryB"
      FROM "Medication"
      WHERE source = 'EXCEL'
        AND "isSettlement" = true
        AND "insuranceCode" IS NOT NULL
    `);

    if (excelRows.length === 0) {
      return NextResponse.json({ ok: true, updated: 0, message: "머지할 EXCEL CSO 데이터가 없어요. 요율표를 먼저 업로드해주세요." });
    }

    // ② 각 EXCEL 레코드의 보험코드를 정규화한 뒤 PUBLIC_API 레코드와 매칭·업데이트
    //    EXCEL의 insuranceCode도 쉼표 구분 가능 → UNNEST 처리
    //    PUBLIC_API insuranceCode도 쉼표 구분 가능 → UNNEST 처리
    let totalUpdated = 0;

    const CHUNK = 100;
    for (let i = 0; i < excelRows.length; i += CHUNK) {
      const slice = excelRows.slice(i, i + CHUNK);

      // 각 EXCEL 행의 정규화된 코드 → (normalizedCode, commissionRate, isSettlement, settlementType) 매핑
      const params: unknown[] = [];
      const valueTuples: string[] = [];
      let p = 1;

      for (const row of slice) {
        // 쉼표 구분 코드 지원
        const codes = row.insuranceCode.split(",").map((c) => c.trim()).filter(Boolean);
        for (const code of codes) {
          const normalized = code.replace(/[\s\-]/g, "").toUpperCase();
          valueTuples.push(`($${p++}::text, $${p++}::numeric, $${p++}::boolean, $${p++}::text)`);
          params.push(normalized, row.commissionRate, row.isSettlement, row.settlementType);
        }
      }

      if (valueTuples.length === 0) continue;

      const sql = `
        WITH excel_data(norm_code, commission_rate, is_settlement, settlement_type) AS (
          VALUES ${valueTuples.join(", ")}
        ),
        matched_pub AS (
          SELECT DISTINCT ON (pub.id)
                 pub.id,
                 ed.commission_rate,
                 ed.is_settlement,
                 ed.settlement_type
          FROM "Medication" pub,
               UNNEST(string_to_array(pub."insuranceCode", ',')) AS raw_code,
               excel_data ed
          WHERE pub.source = 'PUBLIC_API'
            AND pub."insuranceCode" IS NOT NULL
            AND UPPER(REPLACE(REPLACE(TRIM(raw_code), '-', ''), ' ', '')) = ed.norm_code
          ORDER BY pub.id
        )
        UPDATE "Medication" m
        SET "commissionRate"  = mp.commission_rate,
            "isSettlement"    = mp.is_settlement,
            "settlementType"  = mp.settlement_type,
            "updatedAt"       = NOW()
        FROM matched_pub mp
        WHERE m.id = mp.id
      `;

      const result = await prisma.$executeRawUnsafe(sql, ...params);
      totalUpdated += Number(result);
    }

    return NextResponse.json({ ok: true, updated: totalUpdated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "머지 실패" }, { status: 500 });
  }
}
