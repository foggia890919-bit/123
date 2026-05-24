import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, canManageSubmissionRoutes } from "@/lib/auth-guard";
import { normalizeCompanyName } from "@/lib/company-name";
import { getViewableUserIds } from "@/lib/hierarchy";

// 본인 hierarchy + ADMIN 소유 row (글로벌 master) 의 ownerId 집합.
// ADMIN 호출 시에는 null 반환 (필터 없음 = 전체 조회).
async function visibleOwnerIds(user: { id: string; role: string }): Promise<string[] | null> {
  if (user.role === "ADMIN") return null;
  const [viewable, admins] = await Promise.all([
    getViewableUserIds(user.id),
    prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } }),
  ]);
  return [...new Set([...viewable, ...admins.map((a) => a.id)])];
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const clientName = searchParams.get("clientName");
  const companyName = searchParams.get("companyName");
  const entity = searchParams.get("entity");
  const activeParam = searchParams.get("active");

  const owners = await visibleOwnerIds(user);

  const rows = await prisma.submissionRoute.findMany({
    where: {
      ...(owners ? { ownerId: { in: owners } } : {}),
      ...(clientName ? { clientName: { contains: clientName, mode: "insensitive" } } : {}),
      ...(companyName ? { companyName: { contains: companyName, mode: "insensitive" } } : {}),
      ...(entity ? { submissionEntity: { contains: entity, mode: "insensitive" } } : {}),
      ...(activeParam === "true" ? { active: true } : activeParam === "false" ? { active: false } : {}),
    },
    orderBy: [{ submissionEntity: "asc" }, { clientName: "asc" }],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const clientName = normalizeCompanyName(String(body.clientName ?? "").trim());
  const companyName = normalizeCompanyName(String(body.companyName ?? "").trim());
  const submissionEntity = normalizeCompanyName(String(body.submissionEntity ?? "").trim());
  const { submissionEmail, requestType, memo } = body;
  if (!clientName || !companyName || !submissionEntity)
    return NextResponse.json({ error: "거래처명, 제약사명, 제출처는 필수입니다." }, { status: 400 });
  const rt = requestType === "이관" ? "이관" : "신규";

  try {
    const row = await prisma.submissionRoute.upsert({
      where: { ownerId_clientName_companyName: { ownerId: user.id, clientName, companyName } },
      create: { ownerId: user.id, clientName, companyName, submissionEntity, submissionEmail: submissionEmail || null, requestType: rt, memo: memo || null },
      update: { submissionEntity, submissionEmail: submissionEmail || null, requestType: rt, memo: memo || null, active: true },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[submission-routes POST]", msg);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, submissionEntity, submissionEmail, requestType, memo, active } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const existing = await prisma.submissionRoute.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing) return NextResponse.json({ error: "제출처를 찾을 수 없어요." }, { status: 404 });
  if (existing.ownerId !== user.id && user.role !== "ADMIN")
    return NextResponse.json({ error: "본인이 등록한 제출처만 수정할 수 있어요." }, { status: 403 });

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
  if (!canManageSubmissionRoutes(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const existing = await prisma.submissionRoute.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing) return NextResponse.json({ error: "제출처를 찾을 수 없어요." }, { status: 404 });
  if (existing.ownerId !== user.id && user.role !== "ADMIN")
    return NextResponse.json({ error: "본인이 등록한 제출처만 삭제할 수 있어요." }, { status: 403 });

  await prisma.submissionRoute.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
