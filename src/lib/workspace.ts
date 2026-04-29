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

export async function requireWorkspace(): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; workspace: Workspace }> {
  const user = await getCurrentUser();
  if (!user) throw new Response("Unauthorized", { status: 401 });
  const ws = await resolveWorkspace(user.id);
  if (!ws) throw new Response("No workspace", { status: 404 });
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
