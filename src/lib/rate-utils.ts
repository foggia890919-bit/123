import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";

/**
 * 사용자의 제약사별 추가수수료 원본 엔트리를 반환한다 (정규화 전).
 *
 * 우선순위:
 * 1) MemberCompanyRate (개인 설정)
 * 2) CorpCompanyRate (소속 법인 설정 — 개인 설정이 없는 제약사에만 폴백)
 *
 * 소속 법인 탐색: User.parentUserId → 부모 User → 부모의 UserClient(dealerType IS NOT NULL).clientName
 */
export async function fetchRateEntries(
  userId: string
): Promise<Array<{ companyName: string; additionalRate: number }>> {
  const seen = new Set<string>();
  const entries: Array<{ companyName: string; additionalRate: number }> = [];

  const memberRates = await prisma.memberCompanyRate.findMany({
    where: { userId },
    select: { companyName: true, additionalRate: true },
  });
  for (const r of memberRates) {
    seen.add(r.companyName);
    entries.push(r);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { parentUserId: true },
    });
    if (user?.parentUserId) {
      const corpClients = await prisma.userClient.findMany({
        where: { userId: user.parentUserId, dealerType: { not: null } },
        select: { clientName: true },
      });
      const corpNames = corpClients.map((c) => c.clientName);
      if (corpNames.length > 0) {
        const corpRates = await prisma.corpCompanyRate.findMany({
          where: { corpName: { in: corpNames } },
          select: { companyName: true, additionalRate: true },
        });
        for (const r of corpRates) {
          if (!seen.has(r.companyName)) entries.push(r);
        }
      }
    }
  } catch {
    // CorpCompanyRate 또는 parentUserId 미존재 시 무시
  }

  return entries;
}

/**
 * normalizeCompanyKey 기반의 rateMap을 반환한다.
 * 대부분의 약품 검색 라우트에서 사용.
 */
export async function buildRateMap(userId: string): Promise<Record<string, number>> {
  const entries = await fetchRateEntries(userId);
  const rateMap: Record<string, number> = {};
  for (const r of entries) {
    const key = normalizeCompanyKey(r.companyName);
    if (!(key in rateMap)) rateMap[key] = r.additionalRate;
  }
  return rateMap;
}
