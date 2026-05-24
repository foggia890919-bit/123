import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, canManageSubmissionRoutes } from "@/lib/auth-guard";

// 상위법인(= 상위 회원) 검색 endpoint — 통계제출처 매핑 시 상위법인 선택용.
//
// 사용자 요구 (canBeParent 단계):
//   "회원 = dealer = 사업자, 상위 또는 하위 포지션. 하위가 상위 등록할 때
//    아이디/사업자번호/업체명 으로 검색해서 매칭된 회원만 선택 가능.
//    매칭 없으면 '관리자에게 문의'."
//
// 검색 대상: User where canBeParent = true AND id != session.id (본인 제외)
// 검색 조건 (OR):
//   - User.email contains q
//   - User.name contains q
//   - UserClient(dealerType=null).clientName contains q  (본인 대표 사업자 상호명)
//   - UserClient(dealerType=null).bizNumber contains digits(q)
//
// 응답 shape — 기존 호출자 (mypage/clients/page.tsx) 와 호환:
//   { userId, email, name, clientName, bizNumber, dealerType }
//   clientName/bizNumber = userClients[0] (없으면 name fallback, "")
//   dealerType = "UPPER" 상수 (UserClient.DealerType enum 과 다른 의미 — 단순 표시용)
//
// 권한: ADMIN/BIZ/BUSINESS/BASIC (canManageSubmissionRoutes).

export const runtime = "nodejs";

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

  // 본인 대표 사업자 = UserClient where dealerType=null
  const userClientWhere = q
    ? isDigits
      ? { dealerType: null, ...bizWhere(stripped) }
      : { dealerType: null, clientName: { contains: q, mode: "insensitive" as const } }
    : null;

  const orConditions = q
    ? [
        { email: { contains: q, mode: "insensitive" as const } },
        { name: { contains: q, mode: "insensitive" as const } },
        ...(userClientWhere ? [{ userClients: { some: userClientWhere } }] : []),
      ]
    : undefined;

  const users = await prisma.user.findMany({
    where: {
      canBeParent: true,
      id: { not: user.id },
      ...(orConditions ? { OR: orConditions } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      userClients: {
        where: { dealerType: null },
        select: { clientName: true, bizNumber: true },
        take: 1,
      },
    },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: 30,
  });

  const results = users.map((u) => {
    const rep = u.userClients[0];
    return {
      userId: u.id,
      email: u.email,
      name: u.name ?? "",
      clientName: rep?.clientName ?? u.name ?? u.email,
      bizNumber: rep?.bizNumber ?? "",
      dealerType: "UPPER" as const,
    };
  });

  return NextResponse.json(results);
}
