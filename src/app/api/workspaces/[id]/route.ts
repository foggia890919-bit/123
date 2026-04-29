import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessWorkspace, getCurrentUser } from "@/lib/workspace";
import { encrypt } from "@/lib/crypto";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessWorkspace(user.id, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const ws = await prisma.workspace.findUnique({ where: { id }, include: { stores: true, members: { include: { user: true } } } });
  if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // 시크릿 마스킹
  return NextResponse.json({
    workspace: {
      ...ws,
      googleServiceAccountKey: ws.googleServiceAccountKey ? "***" : null,
      telegramBotToken: ws.telegramBotToken ? "***" : null,
      stores: ws.stores.map((s) => ({ ...s, clientSecret: s.clientSecret ? "***" : "" })),
    },
  });
}

interface PatchBody {
  name?: string;
  reportTime?: string;
  telegramBotToken?: string | null;
  telegramChatId?: string | null;
  googleSheetsId?: string | null;
  googleServiceAccountEmail?: string | null;
  googleServiceAccountKey?: string | null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ws = await prisma.workspace.findUnique({ where: { id } });
  if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (ws.ownerId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json()) as PatchBody;
  const data: Record<string, unknown> = {};
  for (const key of ["name", "reportTime", "telegramChatId", "googleSheetsId", "googleServiceAccountEmail"] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  // 시크릿 필드: "***" 면 변경 안함, 아니면 암호화 후 저장
  for (const key of ["telegramBotToken", "googleServiceAccountKey"] as const) {
    const v = body[key];
    if (v !== undefined && v !== "***") {
      data[key] = v ? encrypt(v) : null;
    }
  }
  await prisma.workspace.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}
