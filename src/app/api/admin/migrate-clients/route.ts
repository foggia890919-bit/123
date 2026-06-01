import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

function stripBiz(s: string): string {
  return s.replace(/\D/g, "");
}
function fmtBiz(digits: string): string {
  if (digits.length !== 10) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

// POST /api/admin/migrate-clients?dryRun=1
// UserClient (dealerType=null, 의료기관) → Client 마스터로 dedup + 이전.
// 사업자번호 같은 것은 1 row로 합침. 가장 먼저 등록한 사람의 정보를 유지.
export async function POST(req: Request) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const rows = await prisma.userClient.findMany({
    where: { dealerType: null },
    select: {
      id: true,
      userId: true,
      clientName: true,
      bizNumber: true,
      address: true,
      bizFileKey: true,
      bizFileName: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // 사업자번호 → 최초 row 그룹핑
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const stripped = stripBiz(r.bizNumber);
    if (stripped.length < 10) continue;
    const key = fmtBiz(stripped);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [bizNumber, group] of groups) {
    if (dryRun) { created++; continue; }
    // 마스터에 이미 있으면 skip
    const existing = await prisma.client.findUnique({ where: { bizNumber } });
    if (existing) { skipped++; continue; }
    const first = group[0];
    try {
      await prisma.client.create({
        data: {
          bizNumber,
          clientName: first.clientName,
          address: first.address ?? null,
          bizFileKey: first.bizFileKey ?? null,
          bizFileName: first.bizFileName ?? null,
          createdByUserId: first.userId,
          createdAt: first.createdAt,
        },
      });
      created++;
    } catch (err) {
      errors.push(`${bizNumber}: ${(err as Error).message}`);
    }
  }

  return NextResponse.json({
    dryRun,
    totalUserClients: rows.length,
    uniqueBizNumbers: groups.size,
    created,
    skipped,
    errors,
  });
}
