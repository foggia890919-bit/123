import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MedRow = Record<string, any>;
type MedicationWithRate = MedRow & { additionalRate: number | null };

type Criteria = "commission" | "stock" | "settlement" | "ai";

interface InputRow {
  id: string;
  ingredientCode: string | null;
  originalMedicationId: string | null;
  originalProductName?: string;
  ingredientName?: string;
}

const SelectionSchema = z.object({
  selections: z.array(
    z.object({
      rowId: z.string(),
      medicationId: z.string().nullable(),
    })
  ),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rows: InputRow[] = Array.isArray(body?.rows) ? body.rows : [];
  const criteria: Criteria = body?.criteria ?? "commission";
  const userId: string | null = body?.userId ?? null;

  const validRows = rows.filter((r) => r.ingredientCode);
  if (validRows.length === 0) {
    return NextResponse.json({ results: rows.map((r) => ({ rowId: r.id, medication: null })) });
  }

  const ingredientCodeCodes = [...new Set(validRows.map((r) => r.ingredientCode as string))];

  const allMeds = await prisma.medication.findMany({
    where: { ingredientCode: { in: ingredientCodeCodes } },
    orderBy: [{ isSettlement: "desc" }, { commissionRate: "desc" }],
  });

  const rateMap: Record<string, number> = {};
  if (userId) {
    const rates = await prisma.memberCompanyRate.findMany({ where: { userId } });
    for (const r of rates) rateMap[normalizeCompanyKey(r.companyName)] = r.additionalRate;
  }

  const medsWithRate: MedicationWithRate[] = allMeds.map((m) => ({
    ...m,
    additionalRate: rateMap[normalizeCompanyKey(m.companyName)] ?? null,
  }));

  const medsByIngredientCode = new Map<string, MedicationWithRate[]>();
  for (const m of medsWithRate) {
    if (!m.ingredientCode) continue;
    if (!medsByIngredientCode.has(m.ingredientCode)) medsByIngredientCode.set(m.ingredientCode, []);
    medsByIngredientCode.get(m.ingredientCode)!.push(m);
  }

  const medById = new Map(medsWithRate.map((m) => [m.id, m]));

  if (criteria === "commission") {
    const results = rows.map((row) => {
      if (!row.ingredientCode) return { rowId: row.id, medication: null };
      const alts = (medsByIngredientCode.get(row.ingredientCode) ?? [])
        .filter((m) => m.id !== row.originalMedicationId)
        .sort((a, b) => {
          const ar = (a.commissionRate ?? 0) + (a.additionalRate ?? 0);
          const br = (b.commissionRate ?? 0) + (b.additionalRate ?? 0);
          return br - ar;
        });
      return { rowId: row.id, medication: alts[0] ?? null };
    });
    return NextResponse.json({ results });
  }

  if (criteria === "stock") {
    const results = rows.map((row) => {
      if (!row.ingredientCode) return { rowId: row.id, medication: null };
      const alts = (medsByIngredientCode.get(row.ingredientCode) ?? [])
        .filter((m) => m.id !== row.originalMedicationId)
        .sort((a, b) => {
          const as_ = a.stock ?? -1;
          const bs = b.stock ?? -1;
          return bs - as_;
        });
      return { rowId: row.id, medication: alts[0] ?? null };
    });
    return NextResponse.json({ results });
  }

  if (criteria === "settlement") {
    const results = rows.map((row) => {
      if (!row.ingredientCode) return { rowId: row.id, medication: null };
      const alts = (medsByIngredientCode.get(row.ingredientCode) ?? [])
        .filter((m) => m.id !== row.originalMedicationId)
        .sort((a, b) => {
          const aRate = (a.commissionRate ?? 0) + (a.additionalRate ?? 0);
          const bRate = (b.commissionRate ?? 0) + (b.additionalRate ?? 0);
          const aSettlement = (a.price ?? 0) * aRate / 100;
          const bSettlement = (b.price ?? 0) * bRate / 100;
          return bSettlement - aSettlement;
        });
      return { rowId: row.id, medication: alts[0] ?? null };
    });
    return NextResponse.json({ results });
  }

  // AI mode — Claude picks balancing commission rate + stock
  const rowsForAI = rows
    .filter((r) => r.ingredientCode)
    .map((row) => {
      const alts = (medsByIngredientCode.get(row.ingredientCode!) ?? [])
        .filter((m) => m.id !== row.originalMedicationId)
        .slice(0, 20);
      return {
        rowId: row.id,
        originalProduct: row.originalProductName ?? "",
        ingredient: row.ingredientName ?? "",
        alternatives: alts.map((m) => ({
          id: m.id,
          product: m.productName,
          company: m.companyName,
          totalRate: (m.commissionRate ?? 0) + (m.additionalRate ?? 0),
          stock: m.stock,
        })),
      };
    })
    .filter((r) => r.alternatives.length > 0);

  if (rowsForAI.length === 0) {
    return NextResponse.json({ results: rows.map((r) => ({ rowId: r.id, medication: null })) });
  }

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: "claude-opus-4-7",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content: `당신은 의약품 영업 전문가입니다. 각 품목에 대해 동일성분 대체 의약품 후보 중에서 최적의 한 가지를 선택해주세요.

선택 기준:
1. 수수료율(totalRate)이 높을수록 좋습니다.
2. 재고(stock)가 있고 많을수록 좋습니다. stock이 null이면 재고 정보 없음입니다.
3. 두 기준을 균형 있게 고려하세요.

품목 목록:
${JSON.stringify(rowsForAI, null, 2)}

각 rowId에 대해 가장 적합한 medicationId를 하나 선택하세요. 적합한 후보가 없으면 null을 반환하세요.`,
      },
    ],
    output_config: { format: zodOutputFormat(SelectionSchema) },
  });

  const parsed = response.parsed_output;
  const selectionMap = new Map<string, string | null>();
  if (parsed) {
    for (const sel of parsed.selections) {
      selectionMap.set(sel.rowId, sel.medicationId);
    }
  }

  const results = rows.map((row) => {
    const medId = selectionMap.get(row.id);
    const medication = medId ? (medById.get(medId) ?? null) : null;
    return { rowId: row.id, medication };
  });

  return NextResponse.json({ results });
}
