import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const watchSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  cortarNos: z.array(z.string()).default([]),
  propertyTypes: z.array(z.string()).default([]),
  tradeTypes: z.array(z.string()).default([]),
  priceSaleMax: z.number().int().nullable().optional(),
  priceDepositMax: z.number().int().nullable().optional(),
  priceMonthlyMax: z.number().int().nullable().optional(),
  areaMinM2: z.number().nullable().optional(),
  areaMaxM2: z.number().nullable().optional(),
  floorMin: z.number().int().nullable().optional(),
  floorMax: z.number().int().nullable().optional(),
  keywords: z.array(z.string()).default([]),
  excludeKeywords: z.array(z.string()).default([]),
  notifySms: z.boolean().default(false),
  notifyTelegram: z.boolean().default(false),
  smsTo: z.string().nullable().optional(),
  telegramChatId: z.string().nullable().optional(),
});

async function requireOwnerEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.email ?? null;
}

export async function GET() {
  const email = await requireOwnerEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await prisma.rEWatch.findMany({
    where: { ownerEmail: email },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const email = await requireOwnerEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const parsed = watchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const created = await prisma.rEWatch.create({
    data: { ...parsed.data, ownerEmail: email },
  });
  return NextResponse.json({ item: created }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const email = await requireOwnerEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const id = body.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const parsed = watchSchema.partial().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const existing = await prisma.rEWatch.findUnique({ where: { id } });
  if (!existing || existing.ownerEmail !== email) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const updated = await prisma.rEWatch.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: NextRequest) {
  const email = await requireOwnerEmail();
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await prisma.rEWatch.findUnique({ where: { id } });
  if (!existing || existing.ownerEmail !== email) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.rEWatch.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
