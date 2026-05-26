import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { syncToSheets, type SheetData } from "@/lib/google/google-sheets";

export const runtime = "nodejs";

export async function POST() {
  try {
    const guard = await requireAdmin();
    if (isNextResponse(guard)) return guard;

    // ── 1. 회원목록 ────────────────────────────────────────────────────────
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        approved: true, createdAt: true,
        userClients: {
          select: { clientName: true, bizNumber: true, dealerType: true, approved: true },
          orderBy: { clientName: "asc" },
          take: 1,
        },
      },
    });

    const memberSheet: SheetData = {
      name: "회원목록",
      headers: ["이름", "이메일", "전화번호", "역할", "승인", "거래처명", "사업자번호", "딜러유형", "거래처승인", "가입일"],
      rows: users.map(u => {
        const uc = u.userClients[0];
        return [
          u.name ?? "", u.email, u.phone ?? "", u.role,
          u.approved ? "승인" : "미승인",
          uc?.clientName ?? "미등록", uc?.bizNumber ?? "", uc?.dealerType ?? "",
          uc ? (uc.approved ? "승인" : "미승인") : "",
          new Date(u.createdAt).toLocaleDateString("ko-KR"),
        ];
      }),
    };

    // ── 2. 영업사원_요율 (MemberCompanyRate) ───────────────────────────────
    const memberRates = await prisma.memberCompanyRate.findMany({
      orderBy: [{ userId: "asc" }, { companyName: "asc" }],
      select: {
        companyName: true, additionalRate: true, updatedAt: true,
        user: { select: { name: true, email: true } },
      },
    });

    const memberRateSheet: SheetData = {
      name: "영업사원_요율",
      headers: ["영업사원명", "이메일", "제약사명", "추가수수료(%)", "수정일"],
      rows: memberRates.map(r => [
        r.user.name ?? "", r.user.email,
        r.companyName, r.additionalRate,
        new Date(r.updatedAt).toLocaleDateString("ko-KR"),
      ]),
    };

    // ── 3. 법인_요율 (CorpCompanyRate) ─────────────────────────────────────
    const corpRates = await prisma.corpCompanyRate.findMany({
      orderBy: [{ corpName: "asc" }, { companyName: "asc" }],
    });

    const corpRateSheet: SheetData = {
      name: "법인_요율",
      headers: ["법인명", "제약사명", "추가수수료(%)", "메모", "수정일"],
      rows: corpRates.map(r => [
        r.corpName, r.companyName, r.additionalRate,
        r.memo ?? "",
        new Date(r.updatedAt).toLocaleDateString("ko-KR"),
      ]),
    };

    // ── 4. 필터링요청 ───────────────────────────────────────────────────────
    const filterReqs = await prisma.filterRequest.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        clientName: true, companyName: true, status: true, requestType: true,
        upperCorpName: true, lowerCorpName: true, respondedResult: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });

    const STATUS_KO: Record<string, string> = { PENDING: "대기", APPROVED: "승인", REJECTED: "거절" };

    const filterSheet: SheetData = {
      name: "필터링요청",
      headers: ["영업사원", "거래처명", "제약사명", "상태", "요청유형", "상위법인", "하위법인", "결과", "요청일"],
      rows: filterReqs.map(r => [
        r.user.name ?? "", r.clientName, r.companyName,
        STATUS_KO[r.status] ?? r.status,
        r.requestType ?? "신규",
        r.upperCorpName ?? "", r.lowerCorpName ?? "",
        r.respondedResult ?? "",
        new Date(r.createdAt).toLocaleDateString("ko-KR"),
      ]),
    };

    // ── 5. 통계제출처 ───────────────────────────────────────────────────────
    const submissionRoutes = await prisma.submissionRoute.findMany({
      orderBy: [{ clientName: "asc" }, { companyName: "asc" }],
    });

    const routeSheet: SheetData = {
      name: "통계제출처",
      headers: ["거래처명", "제약사명", "제출처", "이메일", "요청유형", "활성", "메모"],
      rows: submissionRoutes.map(r => [
        r.clientName, r.companyName, r.submissionEntity,
        r.submissionEmail ?? "", r.requestType,
        r.active ? "활성" : "비활성",
        r.memo ?? "",
      ]),
    };

    const url = await syncToSheets([memberSheet, memberRateSheet, corpRateSheet, filterSheet, routeSheet]);
    return NextResponse.json({ success: true, url });

  } catch (e) {
    console.error("[sync-sheets]", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
