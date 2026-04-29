import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, listMyWorkspaces } from "@/lib/workspace";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const list = await listMyWorkspaces(user.id);
  return NextResponse.json({ workspaces: list });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as { name?: string; slug?: string };
  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });

  const baseSlug = (body.slug?.trim() || body.name).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  let slug = baseSlug || `ws-${Date.now()}`;
  for (let i = 0; await prisma.workspace.findUnique({ where: { slug } }); i++) {
    slug = `${baseSlug}-${i + 2}`;
  }

  const ws = await prisma.workspace.create({
    data: {
      name: body.name.trim(),
      slug,
      ownerId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  return NextResponse.json({ workspace: ws });
}
