import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

const MAX_ITEMS = 2000;

interface BulkItem {
  originalMedicationId?: string | null;
  altMedicationId?: string | null;
  originalCode?: string | null;
  note?: string | null;
}

// 제안서(대량) 페이지에서 현재 상태를 새 제안서로 저장
// POST /api/proposals/bulk-save
// body: { title, userId, clientId?, items: [{ originalMedicationId, altMedicationId, originalCode? }] }
export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  try {
    const body = await req.json();
    const { title, clientId, items } = body as {
      title?: string;
      clientId?: string | null;
      items?: BulkItem[];
    };

    if (!title?.trim()) {
      return NextResponse.json({ error: "제목 필수" }, { status: 400 });
    }
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "items 배열 필요" }, { status: 400 });
    }
    if (items.length > MAX_ITEMS) {
      return NextResponse.json({ error: `항목은 최대 ${MAX_ITEMS}개까지 저장할 수 있어요.` }, { status: 400 });
    }

    // 제안서 생성 (clientId 컬럼 없을 수 있어 fallback)
    let proposalId: string;
    try {
      const proposal = await prisma.proposal.create({
        data: { title: title.trim(), userId: user.id, clientId: clientId || null },
        select: { id: true },
      });
      proposalId = proposal.id;
    } catch {
      const proposal = await prisma.proposal.create({
        data: { title: title.trim(), userId: user.id },
        select: { id: true },
      });
      proposalId = proposal.id;
    }

    if (items.length > 0) {
      const data = items.map((it, i) => ({
        proposalId,
        originalMedicationId: it.originalMedicationId || null,
        altMedicationId: it.altMedicationId || null,
        // 매칭 실패한 보험코드도 기록 (proposals 페이지의 '미인식' 행과 동일 규격)
        note: it.note || (it.altMedicationId || it.originalMedicationId ? null : it.originalCode || null),
        order: i,
      }));
      await prisma.proposalItem.createMany({ data, skipDuplicates: true });
    }

    return NextResponse.json({ id: proposalId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "저장 실패" },
      { status: 500 }
    );
  }
}
