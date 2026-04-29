import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";

export async function GET() {
  try {
    const { workspace } = await requireWorkspace();
    const stores = await prisma.naverStore.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({
      stores: stores.map((s) => ({ ...s, clientSecret: s.clientSecret ? "***" : "" })),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

interface CreateBody {
  code?: string;
  bizName?: string;
  storeName?: string;
  clientId?: string;
  clientSecret?: string;
  enabled?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const { workspace } = await requireWorkspace();
    const b = (await req.json()) as CreateBody;
    if (!b.code || !b.storeName || !b.clientId || !b.clientSecret) {
      return NextResponse.json({ error: "code/storeName/clientId/clientSecret required" }, { status: 400 });
    }
    const store = await prisma.naverStore.create({
      data: {
        workspaceId: workspace.id,
        code: b.code,
        bizName: b.bizName ?? workspace.name,
        storeName: b.storeName,
        clientId: b.clientId,
        clientSecret: b.clientSecret,
        enabled: b.enabled ?? true,
      },
    });
    return NextResponse.json({ ok: true, id: store.id });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
