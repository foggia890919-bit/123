import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAccessWorkspace, getCurrentUser } from "@/lib/workspace";
import { sendTelegram } from "@/lib/telegram";
import { ensureTabExists, appendRows } from "@/lib/sheets";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessWorkspace(user.id, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const ws = await prisma.workspace.findUnique({ where: { id } });
  if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { kind } = (await req.json()) as { kind?: "telegram" | "sheet" };

  if (kind === "telegram") {
    const r = await sendTelegram(
      `✅ <b>${ws.name}</b> — 테스트 메시지\n매출 자동화 시스템이 정상 연결됐습니다.\n발송시각: ${new Date().toLocaleString("ko-KR")}`,
      ws,
    );
    return NextResponse.json(r);
  }
  if (kind === "sheet") {
    const ensure = await ensureTabExists("연결테스트", ["발송시각", "메시지"], ws);
    if (!ensure.ok) return NextResponse.json({ ok: false, error: ensure.error });
    const r = await appendRows(
      "연결테스트!A2",
      [[new Date().toLocaleString("ko-KR"), `${ws.name} 연결 OK`]],
      ws,
    );
    return NextResponse.json(r);
  }
  return NextResponse.json({ error: "kind must be telegram|sheet" }, { status: 400 });
}
