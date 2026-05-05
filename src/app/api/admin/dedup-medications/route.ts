import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export const maxDuration = 300;

// GET: 중복 현황 통계
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const dryRun = req.nextUrl.searchParams.get("dryRun") !== "false";

  // 보험코드 없는 약품 중 (productName + companyName) 중복 건수
  const dupes = await prisma.$queryRaw<{ product_name: string; company_name: string; cnt: bigint }[]>`
    SELECT "productName" AS product_name, "companyName" AS company_name, COUNT(*) AS cnt
    FROM "Medication"
    WHERE "insuranceCode" IS NULL
    GROUP BY "productName", "companyName"
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 50
  `;

  const totalDupeGroups = dupes.length;
  const totalExtraRows = dupes.reduce((s, r) => s + Number(r.cnt) - 1, 0);

  return NextResponse.json({
    dryRun,
    totalDupeGroups,
    totalExtraRows,
    samples: dupes.slice(0, 10).map((r) => ({
      productName: r.product_name,
      companyName: r.company_name,
      count: Number(r.cnt),
    })),
  });
}

// POST: 실제 중복 제거 (가장 오래된 1건만 남기고 나머지 삭제)
export async function POST() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  try {
    // 중복 그룹에서 MIN(id) (가장 먼저 생성된 것)만 남기고 나머지 삭제
    // ProposalItem FK 참조가 없는 것만 삭제 (참조 있는 건 보존)
    const result = await prisma.$executeRaw`
      DELETE FROM "Medication"
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY "productName", "companyName"
                   ORDER BY "createdAt" ASC
                 ) AS rn
          FROM "Medication"
          WHERE "insuranceCode" IS NULL
        ) ranked
        WHERE rn > 1
      )
      AND id NOT IN (
        SELECT DISTINCT "originalMedicationId" FROM "ProposalItem" WHERE "originalMedicationId" IS NOT NULL
        UNION
        SELECT DISTINCT "altMedicationId" FROM "ProposalItem" WHERE "altMedicationId" IS NOT NULL
      )
    `;

    const deleted = Number(result);
    const total = await prisma.medication.count();

    return NextResponse.json({ success: true, deleted, totalAfter: total });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
