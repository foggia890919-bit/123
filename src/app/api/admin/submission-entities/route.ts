import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureSubmissionEntityTable } from "@/lib/ensure-submission-entity-table";

export async function GET() {
  try {
    await ensureSubmissionEntityTable();
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM "SubmissionEntity" ORDER BY "name" ASC`
    );
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "조회 실패" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSubmissionEntityTable();
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "법인명 필수" }, { status: 400 });
    const contactName = body?.contactName?.trim() || null;
    const email = body?.email?.trim() || null;
    const phone = body?.phone?.trim() || null;
    const fax = body?.fax?.trim() || null;
    const notes = body?.notes?.trim() || null;
    const now = new Date().toISOString();

    await prisma.$executeRawUnsafe(
      `INSERT INTO "SubmissionEntity" ("name","contactName","email","phone","fax","notes","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT ("name") DO UPDATE SET
         "contactName"=$2,"email"=$3,"phone"=$4,"fax"=$5,"notes"=$6,"updatedAt"=$8`,
      name, contactName, email, phone, fax, notes, now, now
    );
    const rows = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT * FROM "SubmissionEntity" WHERE "name"=$1`, name
    );
    return NextResponse.json(rows[0] ?? { name });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "저장 실패" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureSubmissionEntityTable();
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "법인명 필수" }, { status: 400 });
    await prisma.$executeRawUnsafe(`DELETE FROM "SubmissionEntity" WHERE "name"=$1`, name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "삭제 실패" }, { status: 500 });
  }
}
