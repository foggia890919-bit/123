import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { normalizeCompanyKey, normalizeProductKey } from "@/lib/utils";

export const maxDuration = 300;

// 같은 약품이 두 개의 레코드로 분리 존재하는 케이스를 머지:
//   - PUBLIC_API source, insuranceCode = NULL (loser)
//   - 정규화 productName+companyName 일치하는 레코드, insuranceCode 있음 (winner)
// 발생 원인: MFDS 허가정보 API 가 비급여 약의 EDI_CODE 를 비워서 보내면 sync 가
// insuranceCode=NULL 인 신규 레코드를 생성하던 버그. sync 코드는 이미 fix 됐지만
// 과거에 양산된 중복 레코드는 이 cleanup 으로 제거 필요.
//
// 안전장치:
//   - 정확히 1개 winner 매칭될 때만 머지 (모호한 경우 skip → 수동 확인)
//   - ProposalItem FK 는 winner 로 옮겨서 보존
//   - dry-run 모드(GET / POST?dryRun=true) 로 미리 확인 가능

interface MedRow {
  id: string;
  productName: string;
  companyName: string;
  insuranceCode: string | null;
}

async function planMerge() {
  const orphans: MedRow[] = await prisma.medication.findMany({
    where: { insuranceCode: null },
    select: { id: true, productName: true, companyName: true, insuranceCode: true },
  });

  const named: MedRow[] = await prisma.medication.findMany({
    where: { insuranceCode: { not: null } },
    select: { id: true, productName: true, companyName: true, insuranceCode: true },
  });

  const namedByKey = new Map<string, MedRow[]>();
  for (const n of named) {
    const key = `${normalizeProductKey(n.productName)}|${normalizeCompanyKey(n.companyName)}`;
    if (key === "|") continue;
    const list = namedByKey.get(key);
    if (list) list.push(n); else namedByKey.set(key, [n]);
  }

  const plan: { loserId: string; winnerId: string; loserProduct: string; loserCompany: string; winnerInsuranceCode: string | null }[] = [];
  let ambiguous = 0;
  let noMatch = 0;
  for (const o of orphans) {
    const key = `${normalizeProductKey(o.productName)}|${normalizeCompanyKey(o.companyName)}`;
    if (key === "|") { noMatch++; continue; }
    const matches = namedByKey.get(key);
    if (!matches || matches.length === 0) { noMatch++; continue; }
    if (matches.length > 1) { ambiguous++; continue; }
    plan.push({
      loserId: o.id,
      winnerId: matches[0].id,
      loserProduct: o.productName,
      loserCompany: o.companyName,
      winnerInsuranceCode: matches[0].insuranceCode,
    });
  }
  return { plan, ambiguous, noMatch, orphanTotal: orphans.length, namedTotal: named.length };
}

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const { plan, ambiguous, noMatch, orphanTotal, namedTotal } = await planMerge();
  return NextResponse.json({
    dryRun: true,
    orphanTotal,
    namedTotal,
    willMerge: plan.length,
    ambiguous,
    noMatch,
    samples: plan.slice(0, 10),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "true";

  const { plan, ambiguous, noMatch } = await planMerge();
  if (dryRun) {
    return NextResponse.json({ dryRun: true, willMerge: plan.length, ambiguous, noMatch, samples: plan.slice(0, 20) });
  }

  // 실제 머지: ProposalItem FK 이전 후 loser 삭제. 트랜잭션으로 원자성 보장.
  let merged = 0;
  let failed = 0;
  const errors: { loserId: string; error: string }[] = [];
  for (const { loserId, winnerId } of plan) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.proposalItem.updateMany({
          where: { originalMedicationId: loserId },
          data: { originalMedicationId: winnerId },
        });
        await tx.proposalItem.updateMany({
          where: { altMedicationId: loserId },
          data: { altMedicationId: winnerId },
        });
        await tx.medication.delete({ where: { id: loserId } });
      });
      merged++;
    } catch (e) {
      failed++;
      errors.push({ loserId, error: e instanceof Error ? e.message : String(e) });
      if (errors.length > 20) break; // 너무 많이 실패하면 조기 종료
    }
  }

  const total = await prisma.medication.count();
  return NextResponse.json({
    success: true,
    merged,
    failed,
    ambiguous,
    noMatch,
    totalAfter: total,
    errors: errors.slice(0, 10),
  });
}
