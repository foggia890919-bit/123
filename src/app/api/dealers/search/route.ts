import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse, canManageSubmissionRoutes } from "@/lib/auth-guard";

// 상위법인(= 상위 회원) 검색 endpoint — 통계제출처 매핑 시 상위법인 선택용.
//
// 사용자 요구:
//   - 모든 회원이 검색 대상 (canBeParent 토글 X)
//   - 가입 직후엔 일반회원, 마이페이지에서 사업자등록증 + 관리자 승인 시 사업자회원
//   - 사업자회원(isBusinessApproved=true) 이 상단에 우선 노출
//   - 본인 제외
//
// 검색 조건 (OR):
//   - User.email contains q
//   - User.name contains q
//   - UserClient(dealerType=null).clientName contains q  (본인 대표 사업자 상호명)
//   - UserClient(dealerType=null).bizNumber contains digits(q)
//
// 응답 shape — 기존 호출자 (mypage/clients/page.tsx) 호환:
//   { userId, email, name, clientName, bizNumber, dealerType, isBusinessApproved }
//   clientName/bizNumber = userClients[0] (없으면 name fallback, "")
//   dealerType = "UPPER" 상수
//   isBusinessApproved 는 정렬·UI 강조용 (true 면 상단 + "사업자 인증" 뱃지)
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
      // 본인 제외
      id: { not: user.id },
      // 사업자 인증된 회원만 노출 (관리자가 어드민 대시보드에서 승인한 회원).
      // 일반회원은 상위법인 후보 X.
      isBusinessApproved: true,
      // 의사/약사 role 자동 제외 — 병원/약국 회원
      role: { notIn: ["DOCTOR", "PHARMACIST"] },
      // 사업자 정보(상호명·사업자번호) 등록된 회원만 — 이름만 등록된 회원 자동 제외
      userClients: { some: { dealerType: null } },
      ...(orConditions ? { OR: orConditions } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isBusinessApproved: true,
      userClients: {
        where: { dealerType: null },
        select: { clientName: true, bizNumber: true },
        take: 1,
      },
    },
    // 사업자 인증된 회원 우선 → 그 다음 이름 가나다순.
    orderBy: [{ isBusinessApproved: "desc" }, { name: "asc" }, { email: "asc" }],
    take: 30,
  });

  // 회원 분류 카테고리 — UI 뱃지용. 사용자가 누가 누구인지 한눈에 판단.
  // 우선순위: 의사/약사 role → 상호명 키워드 → 사업자 인증 → 일반
  const MEDICAL_KEYWORDS = [
    "병원", "의원", "내과", "외과", "한의원", "치과", "정신과", "산부인과",
    "소아과", "이비인후과", "안과", "비뇨기과", "정형외과", "피부과",
    "신경과", "재활의학과", "가정의학과", "마취과", "영상의학과", "검진센터",
  ];
  const PHARMACY_KEYWORDS = ["약국", "약방"];
  function classify(role: string, clientName: string): "DOCTOR" | "PHARMACIST" | "BUSINESS_APPROVED" | "GENERAL" {
    if (role === "DOCTOR") return "DOCTOR";
    if (role === "PHARMACIST") return "PHARMACIST";
    if (MEDICAL_KEYWORDS.some((kw) => clientName.includes(kw))) return "DOCTOR";
    if (PHARMACY_KEYWORDS.some((kw) => clientName.includes(kw))) return "PHARMACIST";
    return "GENERAL";
  }

  const results = users
    .map((u) => {
      const rep = u.userClients[0];
      const clientName = rep?.clientName ?? u.name ?? u.email;
      const category = classify(u.role, clientName);
      return {
        userId: u.id,
        email: u.email,
        name: u.name ?? "",
        clientName,
        bizNumber: rep?.bizNumber ?? "",
        dealerType: "UPPER" as const,
        isBusinessApproved: u.isBusinessApproved,
        role: u.role,
        category,
      };
    })
    // 상호명에 병원/약국 키워드 있으면 자동 제외 (BUSINESS role 로 가입한 의사·약사 케이스 방어)
    .filter((r) => r.category !== "DOCTOR" && r.category !== "PHARMACIST");

  return NextResponse.json(results);
}
