import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Workspace, WorkspaceMember } from "@prisma/client";

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  return prisma.user.findUnique({ where: { id } });
}

export async function listMyWorkspaces(userId: string): Promise<(Workspace & { membership?: WorkspaceMember | null })[]> {
  const owned = await prisma.workspace.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
  });
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
  });
  const seen = new Set(owned.map((w) => w.id));
  const fromMembership = memberships
    .filter((m) => !seen.has(m.workspaceId))
    .map((m) => ({ ...m.workspace, membership: m }));
  return [...owned, ...fromMembership];
}

export async function resolveWorkspace(userId: string): Promise<Workspace | null> {
  const cookieStore = await cookies();
  const cookieWs = cookieStore.get("ws")?.value;
  if (cookieWs) {
    const ws = await prisma.workspace.findFirst({
      where: {
        id: cookieWs,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
    });
    if (ws) return ws;
  }
  const list = await listMyWorkspaces(userId);
  return list[0] ?? null;
}

/** 워크스페이스가 하나도 없으면 「내 사업자」 자동 생성하고 반환 */
export async function ensureWorkspace(userId: string): Promise<Workspace> {
  const existing = await resolveWorkspace(userId);
  if (existing) return existing;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  let baseSlug = (user.email.split("@")[0] || "ws").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  let slug = baseSlug || `ws-${Date.now()}`;
  for (let i = 0; await prisma.workspace.findUnique({ where: { slug } }); i++) {
    slug = `${baseSlug}-${i + 2}`;
  }
  return prisma.workspace.create({
    data: {
      name: user.name ? `${user.name}의 사업자` : "내 사업자",
      slug,
      ownerId: userId,
      members: { create: { userId, role: "OWNER" } },
    },
  });
}

export async function requireWorkspace(): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; workspace: Workspace }> {
  const user = await getCurrentUser();
  if (!user) throw new Response("Unauthorized", { status: 401 });
  const ws = await ensureWorkspace(user.id);
  return { user, workspace: ws };
}

export async function canAccessWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  const ws = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
  });
  return !!ws;
}
