import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";
import { normalizeCompanyName } from "@/lib/company-name";

// GET /api/user-clients → 본인 거래처
// GET /api/user-clients?all=true → 관리자 전용, 모든 담당자의 거래처
// GET /api/user-clients?bizNumber=xxx → 사업자번호 중복 조회
export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const bizNumberCheck = req.nextUrl.searchParams.get("bizNumber");
  if (bizNumberCheck) {
    const stripped = bizNumberCheck.replace(/\D/g, "");
    const fmt = stripped.length === 10
      ? `${stripped.slice(0, 3)}-${stripped.slice(3, 5)}-${stripped.slice(5)}`
      : stripped;
    const client = await prisma.userClient.findFirst({
      where: {
        userId: user.id,
        OR: [{ bizNumber: stripped }, { bizNumber: fmt }],
      },
      select: { id: true, clientName: true, bizNumber: true },
    });
    return NextResponse.json({ found: !!client, client: client ?? null });
  }

  const all = req.nextUrl.searchParams.get("all") === "true";

  if (all) {
    if (user.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    // Exclude heavy bizDocument (base64) from list; download via /api/files/user-client-biz/[id]
    let rows;
    try {
      rows = await prisma.userClient.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true, userId: true, clientName: true, bizNumber: true,
          bizFileName: true, bizFileKey: true, approved: true, createdAt: true,
          dealerType: true,
          user: { select: { name: true, email: true } },
        },
      });
    } catch {
      rows = await prisma.userClient.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true, userId: true, clientName: true, bizNumber: true,
          bizFileName: true, bizFileKey: true, approved: true, createdAt: true,
          user: { select: { name: true, email: true } },
        },
      });
    }
    // hasBizDocument flag keeps existing UI logic working without transferring megabytes
    const annotated = rows.map((r) => ({ ...r, bizDocument: null, hasBizDocument: !!r.bizFileName }));
    return NextResponse.json(annotated);
  }

  const userId = user.id;

  // FilterRequest 자동 import 는 사용자가 직접 등록하지 않은 거래처를
  // 무음으로 추가해 dropdown 을 오염시키라 더 이상 수행하지 않음 (2026-04-29).
  // 이전에 자동 추가된 행은 그대로 남아있으니 관리자가 일당 정리해야 한다.

  // 병의원 목록: dealerType IS NULL인 것만 (법인·딥러 제외)
  // dealerType 컴럼이 아직 없으면 fallback
  let rows;
  try {
    rows = await prisma.userClient.findMany({
      where: { userId, dealerType: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, clientName: true, bizNumber: true, address: true,
        bizFileName: true, approved: true, createdAt: true, code: true, dealerType: true,
      },
    });
  } catch {
    rows = await prisma.userClient.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, clientName: true, bizNumber: true,
        bizFileName: true, approved: true, createdAt: true,
      },
    });
  }

  // 각 거래처의 승인된 제약사 목록 첨부
  const bizNumbers = rows.map((r) => r.bizNumber).filter(Boolean) as string[];
  const filters = bizNumbers.length
    ? await prisma.filterRequest.findMany({
        where: { bizNumber: { in: bizNumbers }, status: "APPROVED" },
        select: { bizNumber: true, companyName: true },
        distinct: ["bizNumber", "companyName"],
        orderBy: { companyName: "asc" },
      })
    : [];

  const companyMap = new Map<string, string[]>();
  for (const f of filters) {
    if (!companyMap.has(f.bizNumber)) companyMap.set(f.bizNumber, []);
    const normalized = normalizeCompanyName(f.companyName);
    if (!companyMap.get(f.bizNumber)!.includes(normalized))
      companyMap.get(f.bizNumber)!.push(normalized);
  }

  return NextResponse.json(rows.map((r) => ({
    ...r,
    companies: r.bizNumber ? (companyMap.get(r.bizNumber) ?? []).sort((a, b) => a.localeCompare(b, "ko")) : [],
  })));
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { clientName, bizNumber, bizDocument, bizFileName, dealerType, address } = await req.json();
  if (!clientName || !bizNumber) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
  }
  const { fileKey: bizFileKey, fileData: bizDocumentFallback } =
    await persistDataUri(BUCKETS.userClientBiz, user.id, bizDocument);
  try {
    const createData: Record<string, unknown> = {
      userId: user.id,
      clientName: String(clientName).trim(),
      bizNumber: String(bizNumber).replace(/\D/g, ""),
      bizDocument: bizDocumentFallback,
      bizFileKey,
      bizFileName: bizFileName || null,
      address: address ? String(address).trim() : null,
    };
    if (dealerType !== undefined) createData.dealerType = dealerType ?? null;
    const row = await prisma.userClient.create({
      data: createData as Parameters<typeof prisma.userClient.create>[0]["data"],
      select: {
        id: true, clientName: true, bizNumber: true, address: true,
        bizFileName: true, approved: true, createdAt: true, dealerType: true,
      },
    });
    return NextResponse.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: "이미 등록된 사업자번호예요." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
  const existing = await prisma.userClient.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const isAdmin = user.role === "ADMIN";
  const isOwner = existing.userId === user.id;
  const body = await req.json();
  const { approved, bizDocument, bizFileName } = body;

  if (approved !== undefined && !isAdmin) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if ((bizDocument !== undefined || bizFileName !== undefined) && !isAdmin && !isOwner) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  if (approved !== undefined) data.approved = Boolean(approved);
  if (bizDocument !== undefined) {
    const { fileKey: bizFileKey, fileData: bizDocumentFallback } =
      await persistDataUri(BUCKETS.userClientBiz, existing.userId, bizDocument);
    data.bizDocument = bizDocumentFallback;
    data.bizFileKey = bizFileKey;
    data.bizFileName = bizFileName ?? null;
  } else if (bizFileName !== undefined) {
    data.bizFileName = bizFileName ?? null;
  }

  const row = await prisma.userClient.update({ where: { id }, data });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
  const existing = await prisma.userClient.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && existing.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  await prisma.userClient.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
