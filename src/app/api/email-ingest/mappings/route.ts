import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export const runtime = "nodejs";

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

// GET /api/email-ingest/mappings
export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const activeOnly = sp.get("active") !== "false";

  const mappings = await prisma.emailSenderMapping.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(mappings);
}

// POST /api/email-ingest/mappings
export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = (await req.json()) as {
    fromAddress?: string;
    matchType?: string;
    corpClientId?: string;
    defaultClassification?: string | null;
  };

  if (!body.fromAddress?.trim() || !body.corpClientId?.trim()) {
    return NextResponse.json({ error: "fromAddress, corpClientId 필수" }, { status: 400 });
  }

  const matchType = body.matchType ?? "EXACT";
  if (!["EXACT", "DOMAIN"].includes(matchType)) {
    return NextResponse.json({ error: "matchType: EXACT | DOMAIN" }, { status: 400 });
  }

  const existing = await prisma.emailSenderMapping.findUnique({
    where: { fromAddress: body.fromAddress.trim() },
  });
  if (existing) {
    return NextResponse.json({ error: "DUPLICATE_FROM_ADDRESS" }, { status: 409 });
  }

  const mapping = await prisma.emailSenderMapping.create({
    data: {
      id: crypto.randomUUID(),
      fromAddress: body.fromAddress.trim(),
      matchType,
      corpClientId: body.corpClientId.trim(),
      defaultClassification: body.defaultClassification ?? null,
    },
  });

  return NextResponse.json(mapping, { status: 201 });
}

// PATCH /api/email-ingest/mappings
export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = (await req.json()) as {
    id?: string;
    fromAddress?: string;
    matchType?: string;
    corpClientId?: string;
    defaultClassification?: string | null;
    active?: boolean;
  };

  if (!body.id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const existing = await prisma.emailSenderMapping.findUnique({ where: { id: body.id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const updated = await prisma.emailSenderMapping.update({
    where: { id: body.id },
    data: {
      ...(body.fromAddress !== undefined ? { fromAddress: body.fromAddress.trim() } : {}),
      ...(body.matchType !== undefined ? { matchType: body.matchType } : {}),
      ...(body.corpClientId !== undefined ? { corpClientId: body.corpClientId.trim() } : {}),
      ...(body.defaultClassification !== undefined
        ? { defaultClassification: body.defaultClassification }
        : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/email-ingest/mappings?id=
export async function DELETE(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const existing = await prisma.emailSenderMapping.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  await prisma.emailSenderMapping.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
