import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import * as XLSX from "xlsx";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) return NextResponse.json({ error: "파일이 없어요." }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: "" });

    // 컬럼명 공백 제거 후 정규화
    const rows = rawRows.map((row) => {
      const r: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(row)) r[k.trim()] = v;
      return r;
    });

    // 보험코드 + 약가 파싱
    type PriceRow = { code: string; price: number };
    const priceRows: PriceRow[] = [];
    for (const row of rows) {
      const code = String(
        row["보험코드"] ?? row["급여코드"] ?? row["EDI코드"] ?? row["ediCode"] ?? ""
      ).trim().replace(/[\s\-]/g, "").toUpperCase();
      const priceRaw = parseInt(String(row["약가"] ?? row["상한금액"] ?? row["단가"] ?? ""));
      if (code && !isNaN(priceRaw) && priceRaw > 0) {
        priceRows.push({ code, price: priceRaw });
      }
    }

    if (priceRows.length === 0) {
      return NextResponse.json({ error: "유효한 데이터가 없어요. 보험코드·약가 컬럼을 확인해주세요." }, { status: 400 });
    }

    const codes = priceRows.map((r) => r.code);
    const priceMap = new Map(priceRows.map((r) => [r.code, r.price]));

    // DB에서 보험코드 매칭 (정규화 비교)
    const targets = await prisma.$queryRaw<{ id: string; matched: string }[]>`
      SELECT m.id,
             UPPER(REPLACE(REPLACE(REPLACE(TRIM(code), '-', ''), ' ', ''), E'\t', '')) AS matched
      FROM "Medication" m,
           UNNEST(string_to_array(m."insuranceCode", ',')) AS code
      WHERE m."insuranceCode" IS NOT NULL
        AND UPPER(REPLACE(REPLACE(REPLACE(TRIM(code), '-', ''), ' ', ''), E'\t', '')) = ANY(${codes})
    `;

    // 중복 제거 (한 코드에 여러 레코드면 모두 업데이트)
    const updates = new Map<string, number>();
    for (const t of targets) {
      const price = priceMap.get(t.matched);
      if (price) updates.set(t.id, price);
    }

    if (updates.size === 0) {
      return NextResponse.json({ updated: 0, parsed: priceRows.length, message: "매칭되는 약품이 없어요." });
    }

    // 배치 업데이트
    const CHUNK = 200;
    const ids = Array.from(updates.keys());
    let updated = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: (string | number)[] = [];
      let p = 1;
      for (const id of slice) {
        tuples.push(`($${p++}::text, $${p++}::int)`);
        params.push(id, updates.get(id)!);
      }
      await prisma.$executeRawUnsafe(`
        UPDATE "Medication" AS m
        SET "price" = v.price, "updatedAt" = NOW()
        FROM (VALUES ${tuples.join(", ")}) AS v(id, price)
        WHERE m.id = v.id
      `, ...params);
      updated += slice.length;
    }

    const nullPriceMeds = await prisma.medication.count({ where: { price: null } });
    return NextResponse.json({ success: true, parsed: priceRows.length, matched: targets.length, updated, nullPriceMeds });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
