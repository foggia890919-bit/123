import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { canAccessWorkspace, getCurrentUser } from "@/lib/workspace";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = (await req.json()) as { workspaceId?: string };
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  const ok = await canAccessWorkspace(user.id, workspaceId);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const cookieStore = await cookies();
  cookieStore.set("ws", workspaceId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return NextResponse.json({ ok: true });
}
