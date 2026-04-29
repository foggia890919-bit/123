import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";

export async function GET() {
  try {
    const { workspace } = await requireWorkspace();
    const rules = await prisma.keywordRule.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ priority: "desc" }, { keyword: "asc" }],
    });
    return NextResponse.json({ rules });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

interface CreateBody {
  keyword?: string;
  patterns?: string;
  priority?: number;
  bottlesRule?: string;
  enabled?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const { workspace } = await requireWorkspace();
    const b = (await req.json()) as CreateBody;
    if (!b.keyword?.trim() || !b.patterns?.trim()) {
      return NextResponse.json({ error: "keyword/patterns required" }, { status: 400 });
    }
    const rule = await prisma.keywordRule.create({
      data: {
        workspaceId: workspace.id,
        keyword: b.keyword.trim(),
        patterns: b.patterns.trim(),
        priority: b.priority ?? 10,
        bottlesRule: b.bottlesRule || null,
        enabled: b.enabled ?? true,
      },
    });
    return NextResponse.json({ ok: true, rule });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
