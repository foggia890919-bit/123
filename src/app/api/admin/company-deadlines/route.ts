import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { normalizeCompanyName } from "@/lib/company-name";

// GET /api/admin/company-deadlines?yearMonth=YYYY-MM
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const yearMonth = req.nextUrl.searchParams.get("yearMonth");
  const rows = await prisma.companyDeadline.findMany({
    where: yearMonth ? { yearMonth } : {},
    orderBy: [{ yearMonth: "desc" }, { deadline: "asc" }, { companyName: "asc" }],
  });
  return NextResponse.json(rows);
}

// POST /api/admin/company-deadlines — 단건 등록/수정
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  const rawName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  const yearMonth = typeof body.yearMonth === "string" ? body.yearMonth.trim() : "";
  const deadlineStr = typeof body.deadline === "string" ? body.deadline : "";

  if (!rawName || !yearMonth || !deadlineStr) {
    return NextResponse.json({ error: "companyName, yearMonth, deadline 필수" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: "yearMonth는 YYYY-MM 형식" }, { status: 400 });
  }
  const deadline = new Date(deadlineStr);
  if (Number.isNaN(deadline.getTime())) {
    return NextResponse.json({ error: "deadline 날짜 파싱 실패" }, { status: 400 });
  }

  const companyName = normalizeCompanyName(rawName);
  const source = typeof body.source === "string" ? body.source : "MANUAL";
  const memo = typeof body.memo === "string" ? body.memo : null;

  const row = await prisma.companyDeadline.upsert({
    where: { companyName_yearMonth: { companyName, yearMonth } },
    update: { deadline, source, memo },
    create: { companyName, yearMonth, deadline, source, memo },
  });
  return NextResponse.json(row);
}

// DELETE /api/admin/company-deadlines?id=xxx
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
  await prisma.companyDeadline.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
