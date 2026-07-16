import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, canManageSubmissionRoutes } from "@/lib/auth-guard";
import { normalizeCompanyName, companyNameKey } from "@/lib/company-name";
import { getViewableUserIds } from "@/lib/hierarchy";
import { syncSubmissionRoutesSheet } from "@/lib/google/sheets-submission-routes";

// 매핑의 거래처(clientName)가 해당 ownerId 의 UserClient(dealerType null) 명부에 없으면 자동 생성.
// clientName 만, bizNumber 는 임시 placeholder(유니크 충돌 회피). 실패해도 매핑 등록엔 영향 없음.
async function ensureUserClient(ownerId: string, clientName: string): Promise<void> {
  try {
    const key = companyNameKey(clientName);
    if (!key) return;
    const existing = await prisma.userClient.findMany({
      where: { userId: ownerId, dealerType: null },
      select: { clientName: true },
    });
    if (existing.some((u) => companyNameKey(u.clientName) === key)) return;
    await prisma.userClient.create({
      data: { userId: ownerId, clientName, bizNumber: `temp-${crypto.randomUUID().slice(0, 8)}`, dealerType: null },
    });
  } catch (e) {
    console.error("[submission-routes ensureUserClient]", e instanceof Error ? e.message : String(e));
  }
}

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
  // 상위법인 회원 id (선택) — 거래처관리에서 상위법인 선택 시 회원 정보까지 받음.
  // 이걸 저장하면 통계 사진 자동 라우팅 가능 (상위법인 회원이 본인 매핑된 통계 모아봄).
  const parentUserId = typeof body.parentUserId === "string" && body.parentUserId.trim() ? body.parentUserId.trim() : null;
  if (!clientName || !companyName || !submissionEntity)
    return NextResponse.json({ error: "거래처명, 제약사명, 제출처는 필수입니다." }, { status: 400 });
  const rt = requestType === "이관" ? "이관" : "신규";

  try {
    const row = await prisma.submissionRoute.upsert({
      where: { ownerId_clientName_companyName: { ownerId: user.id, clientName, companyName } },
      create: { ownerId: user.id, clientName, companyName, submissionEntity, parentUserId, submissionEmail: submissionEmail || null, requestType: rt, memo: memo || null },
      update: { submissionEntity, parentUserId, submissionEmail: submissionEmail || null, requestType: rt, memo: memo || null, active: true },
    });
    await ensureUserClient(user.id, clientName); // 거래처 명부 자동 치유
    after(() => syncSubmissionRoutesSheet());
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

  const { id, clientName, companyName, submissionEntity, submissionEmail, requestType, memo, active } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const existing = await prisma.submissionRoute.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing) return NextResponse.json({ error: "제출처를 찾을 수 없어요." }, { status: 404 });
  if (existing.ownerId !== user.id && user.role !== "ADMIN")
    return NextResponse.json({ error: "본인이 등록한 제출처만 수정할 수 있어요." }, { status: 403 });

  // 거래처명·제약사명 수정 허용 — normalizeCompanyName 적용. 빈 값은 무시.
  // id 는 유지(in-place) → MonthlySubmissionLog 관계 보존.
  const nextClientName = clientName !== undefined ? normalizeCompanyName(String(clientName).trim()) : undefined;
  const nextCompanyName = companyName !== undefined ? normalizeCompanyName(String(companyName).trim()) : undefined;
  if (nextClientName !== undefined && !nextClientName)
    return NextResponse.json({ error: "거래처명은 비울 수 없어요." }, { status: 400 });
  if (nextCompanyName !== undefined && !nextCompanyName)
    return NextResponse.json({ error: "제약사명은 비울 수 없어요." }, { status: 400 });

  try {
    const row = await prisma.submissionRoute.update({
      where: { id },
      data: {
        ...(nextClientName !== undefined ? { clientName: nextClientName } : {}),
        ...(nextCompanyName !== undefined ? { companyName: nextCompanyName } : {}),
        ...(submissionEntity !== undefined ? { submissionEntity: normalizeCompanyName(String(submissionEntity).trim()) } : {}),
        ...(submissionEmail !== undefined ? { submissionEmail: submissionEmail || null } : {}),
        ...(requestType !== undefined ? { requestType: requestType === "이관" ? "이관" : "신규" } : {}),
        ...(memo !== undefined ? { memo: memo || null } : {}),
        ...(active !== undefined ? { active } : {}),
        updatedAt: new Date(),
      },
    });
    if (nextClientName) await ensureUserClient(existing.ownerId, nextClientName); // clientName 변경 시 명부 치유
    after(() => syncSubmissionRoutesSheet());
    return NextResponse.json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint"))
      return NextResponse.json({ error: "이미 같은 매핑이 있습니다 (거래처 + 제약사 조합 중복)." }, { status: 409 });
    console.error("[submission-routes PATCH]", msg);
    return NextResponse.json({ error: msg.slice(0, 300) }, { status: 500 });
  }
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
  after(() => syncSubmissionRoutesSheet());
  return NextResponse.json({ success: true });
}
