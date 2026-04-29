import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

interface BulkRow {
  clientName: string;
  submissionEntity: string;
  managerName?: string;
  managerPhone?: string;
  companies: string[];
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const rows: BulkRow[] = await req.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows 필요" }, { status: 400 });
  }

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.clientName || !row.submissionEntity) {
      errors.push(`거래처 또는 상위법인 누락: ${JSON.stringify(row)}`);
      continue;
    }
    for (const companyName of row.companies) {
      if (!companyName.trim()) continue;
      try {
        const existing = await prisma.filterMapping.findUnique({
          where: { clientName_companyName: { clientName: row.clientName, companyName } },
        });
        if (existing) {
          await prisma.filterMapping.update({
            where: { id: existing.id },
            data: {
              submissionEntity: row.submissionEntity,
              managerName: row.managerName || null,
              managerPhone: row.managerPhone || null,
              active: true,
              updatedAt: new Date(),
            },
          });
          updated++;
        } else {
          await prisma.filterMapping.create({
            data: {
              id: crypto.randomUUID(),
              clientName: row.clientName,
              companyName,
              submissionEntity: row.submissionEntity,
              managerName: row.managerName || null,
              managerPhone: row.managerPhone || null,
              updatedAt: new Date(),
            },
          });
          created++;
        }
      } catch (e) {
        errors.push(`${row.clientName} × ${companyName}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return NextResponse.json({ created, updated, errors });
}
