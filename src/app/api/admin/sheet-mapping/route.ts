import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

// GET /api/admin/sheet-mapping → 전체 매핑 + 협력법인 후보
export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const [mappings, partners] = await Promise.all([
    prisma.sheetCorpMapping.findMany({
      orderBy: { sheetLabel: "asc" },
      include: { userClient: { select: { id: true, clientName: true, bizNumber: true, partnerGrade: true } } },
    }),
    prisma.userClient.findMany({
      where: { corpClassification: "PARTNER" },
      select: { id: true, clientName: true, bizNumber: true, partnerGrade: true },
      orderBy: { clientName: "asc" },
    }),
  ]);

  return NextResponse.json({ mappings, partners });
}

// POST /api/admin/sheet-mapping → 매핑 생성/수정 (sheetLabel unique upsert)
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const body = await req.json().catch(() => null);
  const sheetLabel = typeof body?.sheetLabel === "string" ? body.sheetLabel.trim() : "";
  if (!sheetLabel) return NextResponse.json({ error: "sheetLabel 필수" }, { status: 400 });

  const userClientId = typeof body?.userClientId === "string" ? body.userClientId : null;
  const memo = typeof body?.memo === "string" ? body.memo : null;

  const row = await prisma.sheetCorpMapping.upsert({
    where: { sheetLabel },
    update: { userClientId, memo },
    create: { sheetLabel, userClientId, memo },
  });
  return NextResponse.json(row);
}

// DELETE /api/admin/sheet-mapping?id=xxx
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
  await prisma.sheetCorpMapping.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
