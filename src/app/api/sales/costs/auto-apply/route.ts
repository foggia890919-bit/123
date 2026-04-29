import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";
import { matchKeyword } from "@/lib/keyword-match";

/**
 * 워크스페이스의 키워드 룰을 사용해 매핑 안 된 (또는 모든) 옵션에 키워드/병수 자동 채움.
 * body: { onlyEmpty?: boolean, dryRun?: boolean, force?: boolean }
 *   - onlyEmpty=true (기본): 키워드가 비어있는 항목만
 *   - force=true: 이미 키워드가 있는 항목도 룰 결과로 덮어씀
 *   - dryRun=true: 적용하지 않고 미리보기만
 *
 * 1) NaverProduct 의 모든 옵션 (ProductCost 또는 NaverOrderItem 에서 추출)
 * 2) 룰 매칭해서 → ProductCost 에 keyword/bottles 저장
 */
export async function POST(req: NextRequest) {
  try {
    const { workspace } = await requireWorkspace();
    const body = (await req.json().catch(() => ({}))) as {
      onlyEmpty?: boolean;
      dryRun?: boolean;
      force?: boolean;
    };
    const onlyEmpty = body.onlyEmpty ?? true;
    const dryRun = body.dryRun ?? false;
    const force = body.force ?? false;

    const rules = await prisma.keywordRule.findMany({
      where: { workspaceId: workspace.id, enabled: true },
      orderBy: { priority: "desc" },
    });
    if (rules.length === 0) {
      return NextResponse.json({ error: "키워드 룰이 없습니다. 먼저 룰을 등록하세요." }, { status: 400 });
    }

    // 워크스페이스의 모든 상품
    const products = await prisma.naverProduct.findMany({
      where: { store: { workspaceId: workspace.id } },
      include: {
        costs: true,
        items: { select: { optionName: true }, distinct: ["optionName"] },
      },
    });

    interface Action { productId: string; optionName: string; keyword: string; bottlesPerUnit: number; existing: boolean }
    const actions: Action[] = [];

    for (const p of products) {
      // 이 상품에 등장한 모든 옵션
      const optionsSet = new Set<string>();
      for (const c of p.costs) optionsSet.add(c.optionName);
      for (const it of p.items) optionsSet.add(it.optionName);
      // 옵션이 0개면 빈 옵션이라도 한 번 시도 (상품명만으로)
      if (optionsSet.size === 0) optionsSet.add("");

      for (const optionName of optionsSet) {
        const existing = p.costs.find((c) => c.optionName === optionName);
        const text = optionName || p.productName;
        const m = matchKeyword(text, rules);
        if (!m.keyword) continue; // 룰 매칭 안되면 건너뜀

        if (existing) {
          if (existing.keyword && !force) continue;
          if (onlyEmpty && existing.keyword) continue;
          actions.push({
            productId: p.id,
            optionName,
            keyword: m.keyword,
            bottlesPerUnit: m.bottlesPerUnit,
            existing: true,
          });
        } else {
          actions.push({
            productId: p.id,
            optionName,
            keyword: m.keyword,
            bottlesPerUnit: m.bottlesPerUnit,
            existing: false,
          });
        }
      }
    }

    if (!dryRun) {
      for (const a of actions) {
        if (a.existing) {
          await prisma.productCost.updateMany({
            where: { productId: a.productId, optionName: a.optionName },
            data: { keyword: a.keyword, bottlesPerUnit: a.bottlesPerUnit },
          });
        } else {
          await prisma.productCost.create({
            data: {
              productId: a.productId,
              optionName: a.optionName,
              keyword: a.keyword,
              bottlesPerUnit: a.bottlesPerUnit,
              effectiveAt: new Date(0),
            },
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      total: actions.length,
      created: actions.filter((a) => !a.existing).length,
      updated: actions.filter((a) => a.existing).length,
      dryRun,
      sample: actions.slice(0, 20),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
