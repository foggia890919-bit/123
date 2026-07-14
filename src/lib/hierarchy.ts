import { prisma } from "@/lib/prisma";

/**
 * Phase 1B — 권한 계층 헬퍼.
 *
 * User.parentUserId 로 표현되는 트리에서 (self + all descendants) 의 id 를 모은다.
 * - BUSINESS: 자기 자신만
 * - 본인법인 BIZ: 자기 + 자기 밑 영업사원
 * - 상위법인 BIZ: 자기 + 본인법인 + 본인법인 밑 영업사원…
 *
 * ADMIN 은 호출자가 따로 분기 처리 (전체 조회).
 */
export async function getViewableUserIds(rootUserId: string): Promise<string[]> {
  // BFS 로 하위 트리 수집. 깊이 제한 (cycle 방어 + 비정상 깊이 차단).
  const visited = new Set<string>([rootUserId]);
  let frontier: string[] = [rootUserId];
  for (let depth = 0; depth < 16 && frontier.length > 0; depth++) {
    const children = await prisma.user.findMany({
      where: { parentUserId: { in: frontier } },
      select: { id: true },
    });
    frontier = [];
    for (const c of children) {
      if (!visited.has(c.id)) {
        visited.add(c.id);
        frontier.push(c.id);
      }
    }
  }
  return [...visited];
}

/**
 * 상위법인용 — 직속 하위법인별로 userId를 묶어서 Map 반환.
 * { [userId]: "하위법인명" } 형태로, 해당 법인 소속 모든 userId를 커버.
 * 상위법인 본인의 userId는 포함하지 않음.
 */
export async function buildChildCorpMap(parentId: string): Promise<Record<string, string>> {
  const directCorps = await prisma.user.findMany({
    where: { parentUserId: parentId },
    select: { id: true, name: true, email: true },
  });
  const corpMap: Record<string, string> = {};
  for (const corp of directCorps) {
    const label = corp.name || corp.email;
    const subIds = await getViewableUserIds(corp.id);
    for (const id of subIds) {
      corpMap[id] = label;
    }
  }
  return corpMap;
}
