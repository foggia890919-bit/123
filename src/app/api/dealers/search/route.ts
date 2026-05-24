import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, canManageSubmissionRoutes } from "@/lib/auth-guard";

// 상위법인(dealer) 검색 endpoint — 통계제출처 매핑 시 상위법인 선택용.
//
// 사용자 요구:
//   "DB 에 매칭되지 않으면 등록 불가 — '관리자에게 문의하세요' 안내"
//
// 즉 자유 입력 금지. 전사 등록된 dealer 중에서만 선택 가능.
// 검색: 사업자번호 또는 이름 (clientName).
// dealer 정의: UserClient.dealerType != null (UPPER_CORP, CORPORATION, LOWER_CORP, SELF, INDIVIDUAL 중 하나).
//   → 영맨회원 본인이 사용 시 dealerType=UPPER_CORP/CORPORATION 만 노출하는 게 의미 있지만,
//     사용자가 명시한 "DB 매칭" 범위가 모호하므로 일단 모든 dealerType 노출. 추후 필터 조정 가능.
//
// 권한: ADMIN/BIZ/BUSINESS/BASIC (canManageSubmissionRoutes) — 통계제출처 페이지 권한과 동일.

export const runtime = "nodejs";

// 하이픈 포함/미포함 두 형태 모두 검색 (DB 에 혼재 가능성)
function bizWhere(stripped: string) {
  const fmt =
    stripped.length <= 3
      ? stripped
      : stripped.length <= 5
        ? `${stripped.slice(0, 3)}-${stripped.slice(3)}`
        : `${stripped.slice(0, 3)}-${stripped.slice(3, 5)}-${stripped.slice(5)}`;
  if (fmt === stripped) return { bizNumber: { contains: stripped } };
  return { OR: [{ bizNumber: { contains: stripped } }, { bizNumber: { contains: fmt } }] };
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!canManageSubmissionRoutes(user.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const stripped = q.replace(/\D/g, "");
  const isDigits = stripped.length > 0 && q.replace(/-/g, "") === stripped;

  const where = {
    dealerType: { not: null },
    ...(q
      ? isDigits
        ? bizWhere(stripped)
        : { clientName: { contains: q, mode: "insensitive" as const } }
      : {}),
  };

  const dealers = await prisma.userClient.findMany({
    where,
    select: { clientName: true, bizNumber: true, dealerType: true },
    distinct: ["clientName"],
    orderBy: { clientName: "asc" },
    take: 30,
  });

  return NextResponse.json(dealers);
}
