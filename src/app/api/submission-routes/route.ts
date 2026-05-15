import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { normalizeCompanyName } from "@/lib/company-name";

function bizOrAdmin(role: string) { return role === "BIZ" || role === "ADMIN"; }

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const clientName = searchParams.get("clientName");
  const companyName = searchParams.get("companyName");
  const entity = searchParams.get("entity");
  const activeParam = searchParams.get("active");

  const rows = await prisma.submissionRoute.findMany({
    where: {
      ...(clientName ? { clientName: { contains: clientName, mode: "insensitive" } } : {}),
      ...(companyName ? { companyName: { contains: companyName, mode: "insensitive" } } : {}),
      ...(entity ? { submissionEntity: { contains: entity, mode: "insensitive" } } : {}),
      // active=true → 활성만, active=false → 비활성만, 파라미터 없음 → 전체
      ...(activeParam === "true" ? { active: true } : activeParam === "false" ? { active: false } : {}),
    },
    orderBy: [{ submissionEntity: "asc" }, { clientName: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  // 저장 전 정규화 — FilterRequest.clientName 과 일치 보장
  const clientName = normalizeCompanyName(String(body.clientName ?? "").trim());
  const companyName = normalizeCompanyName(String(body.companyName ?? "").trim());
  const submissionEntity = normalizeCompanyName(String(body.submissionEntity ?? "").trim());
  const { submissionEmail, requestType, memo } = body;
  if (!clientName || !companyName || !submissionEntity)
    return NextResponse.json({ error: "거래처명, 제약사명, 제출처는 필수입니다." }, { status: 400 });
  const rt = requestType === "이관" ? "이관" : "신규";

  const row = await prisma.submissionRoute.upsert({
    where: { clientName_companyName: { clientName, companyName } },
    create: { id: crypto.randomUUID(), clientName, companyName, submissionEntity, submissionEmail: submissionEmail || null, requestType: rt, memo: memo || null, updatedAt: new Date() },
    update: { submissionEntity, submissionEmail: submissionEmail || null, requestType: rt, memo: memo || null, active: true, updatedAt: new Date() },
  });
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, submissionEntity, submissionEmail, requestType, memo, active } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const row = await prisma.submissionRoute.update({
    where: { id },
    data: {
      ...(submissionEntity !== undefined ? { submissionEntity } : {}),
      ...(submissionEmail !== undefined ? { submissionEmail: submissionEmail || null } : {}),
      ...(requestType !== undefined ? { requestType: requestType === "이관" ? "이관" : "신규" } : {}),
      ...(memo !== undefined ? { memo: memo || null } : {}),
      ...(active !== undefined ? { active } : {}),
      updatedAt: new Date(),
    },
  });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });
  await prisma.submissionRoute.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
