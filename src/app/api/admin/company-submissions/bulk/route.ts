import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface BulkRow {
  companyName: string;
  submissionEntity?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  fax?: string;
  defaultAdditionalRate?: number | null;
  notes?: string;
}

export async function POST(req: NextRequest) {
  try {
    const rows: BulkRow[] = await req.json();
    if (!Array.isArray(rows)) {
      return NextResponse.json({ error: "배열 형식 필요" }, { status: 400 });
    }

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const companyName = String(row.companyName ?? "").trim();
      if (!companyName) continue;

      const rawRate = row.defaultAdditionalRate;
      const data = {
        submissionEntity: row.submissionEntity?.trim() || null,
        contactName: row.contactName?.trim() || null,
        email: row.email?.trim() || null,
        phone: row.phone?.trim() || null,
        fax: row.fax?.trim() || null,
        defaultAdditionalRate: rawRate != null && !isNaN(Number(rawRate)) ? Number(rawRate) : null,
        notes: row.notes?.trim() || null,
      };

      try {
        const existing = await prisma.companySubmission.findUnique({ where: { companyName } });
        await prisma.companySubmission.upsert({
          where: { companyName },
          create: { companyName, ...data },
          update: data,
        });
        if (existing) updated++;
        else created++;
      } catch (e) {
        errors.push(`${companyName}: ${e instanceof Error ? e.message : "오류"}`);
      }
    }

    return NextResponse.json({ created, updated, errors });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "일괄 저장 실패" },
      { status: 500 }
    );
  }
}
