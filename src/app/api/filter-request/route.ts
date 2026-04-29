import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { requireSession, requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";
import { sendAlimtalk } from "@/lib/coolsms";

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const all = req.nextUrl.searchParams.get("all") === "true";
  // Exclude heavy bizDocument from list responses — download via /api/files/filter-request/[id]
  const select = {
    id: true, userId: true, userName: true, clientName: true, bizNumber: true,
    bizFileName: true, bizFileKey: true, companyName: true, status: true,
    replyText: true, repliedAt: true, createdAt: true, updatedAt: true,
    requestType: true, mappingId: true, respondedAt: true, respondedResult: true,
    alimtalkSentAt: true, salesNotifiedAt: true,
    upperCorpName: true, lowerCorpName: true,
  } as const;
  if (all) {
    if (user.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const requests = await prisma.filterRequest.findMany({
      orderBy: { createdAt: "desc" },
      select: { ...select, user: { select: { name: true, email: true } } },
    });
    return NextResponse.json(requests.map((r) => ({ ...r, bizDocument: null, hasBizDocument: !!r.bizFileName })));
  }
  const requests = await prisma.filterRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { ...select, user: { select: { name: true, email: true } } },
  });
  return NextResponse.json(requests.map((r) => ({ ...r, bizDocument: null, hasBizDocument: !!r.bizFileName })));
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const { clientName, bizNumber, bizDocument, bizFileName, companies, requestType } = await req.json();

  if (!clientName || !bizNumber || !companies?.length) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
  }
  if (!Array.isArray(companies) || companies.length > 200) {
    return NextResponse.json({ error: "제약사는 최대 200개까지 선택할 수 있어요." }, { status: 400 });
  }

  // Upload bizDocument once (shared across all rows)
  const { fileKey: bizFileKey, fileData: bizDocumentFallback } =
    await persistDataUri(BUCKETS.filterRequestBiz, user.id, bizDocument);

  // Lookup FilterMapping entries by company name (제약사 → 상위법인)
  const mappings = await prisma.filterMapping.findMany({
    where: { companyName: { in: companies as string[] }, active: true },
  });
  const mappingByCompany = new Map(mappings.map((m) => [m.companyName, m]));

  const now = new Date();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://medivance.co.kr";

  const rows = (companies as string[]).map((companyName: string) => {
    const mapping = mappingByCompany.get(companyName);
    const responseToken = mapping ? crypto.randomUUID() : null;
    return {
      id: crypto.randomUUID(),
      userId: user.id,
      userName: user.name ?? user.email,
      clientName,
      bizNumber,
      bizDocument: bizDocumentFallback,
      bizFileKey,
      bizFileName: bizFileName || null,
      companyName,
      requestType: requestType || "신규",
      mappingId: mapping?.id ?? null,
      responseToken,
      upperCorpName: mapping?.submissionEntity ?? null,
      updatedAt: now,
    };
  });

  await prisma.filterRequest.createMany({ data: rows });

  // Send AlimTalk for rows that have a mapping with phone
  const pfId = process.env.KAKAO_PF_ID;
  const templateId = process.env.KAKAO_TEMPLATE_FILTER_REQUEST;
  if (pfId && templateId) {
    const sendTasks = rows
      .filter((r) => r.mappingId && r.responseToken)
      .map(async (r) => {
        const mapping = mappingByCompany.get(r.companyName);
        if (!mapping?.managerPhone) return;

        const respondUrl = `${baseUrl}/filter-respond/${r.responseToken}`;
        try {
          await sendAlimtalk(
            mapping.managerPhone,
            {
              pfId,
              templateId,
              variables: {
                "#{거래처명}": clientName,
                "#{제약사명}": r.companyName,
                "#{영업사원}": user.name ?? user.email ?? "",
                "#{요청유형}": r.requestType || "신규",
              },
              buttons: [
                {
                  buttonType: "WL",
                  buttonName: "응답하기",
                  linkMo: respondUrl,
                  linkPc: respondUrl,
                },
              ],
            },
            `[와이케이메디] 필터링 요청\n\n거래처: ${clientName}\n제약사: ${r.companyName}\n담당 영업사원: ${user.name ?? user.email ?? ""}\n\n위 건 필터링 가능 여부를 확인해 주세요.\n응답: ${respondUrl}`
          );
          await prisma.filterRequest.update({
            where: { id: r.id },
            data: { alimtalkSentAt: new Date(), updatedAt: new Date() },
          });
        } catch (e) {
          console.error("AlimTalk 발송 실패", r.companyName, e);
        }
      });
    await Promise.allSettled(sendTasks);
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const { id, status, replyText, upperCorpName, lowerCorpName, respondedResult } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const record = await prisma.filterRequest.findUnique({
    where: { id },
    select: { userId: true, clientName: true, companyName: true, lowerCorpName: true },
  });
  if (!record) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const data: Prisma.FilterRequestUpdateInput = { updatedAt: new Date() };

  if (user.role === "ADMIN") {
    if (status !== undefined) data.status = status;
    if (replyText !== undefined) { data.replyText = replyText || null; data.repliedAt = new Date(); }
    if (respondedResult !== undefined) applyResult(data, respondedResult);
  } else if (user.role === "BIZ") {
    if (status !== undefined || replyText !== undefined) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    // BIZ는 모든 요청에 결과 설정 가능
    if (respondedResult !== undefined) applyResult(data, respondedResult);
  } else {
    // 일반 사용자: 본인 요청에만 corp 필드 수정 가능
    if (status !== undefined || replyText !== undefined || respondedResult !== undefined) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    if (record.userId !== user.id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
  }

  if (upperCorpName !== undefined) data.upperCorpName = upperCorpName ?? null;
  if (lowerCorpName !== undefined) data.lowerCorpName = lowerCorpName ?? null;

  const updated = await prisma.filterRequest.update({ where: { id }, data });

  // BIZ/ADMIN이 결과를 설정할 때 영업사원 + 하위법인에 알림
  if ((user.role === "BIZ" || user.role === "ADMIN") && respondedResult) {
    const effectiveLowerCorp = (lowerCorpName !== undefined ? lowerCorpName : record.lowerCorpName) as string | null;
    notifyResultAsync({
      clientName: record.clientName,
      companyName: record.companyName,
      respondedResult,
      salesRepUserId: record.userId,
      lowerCorpName: effectiveLowerCorp,
    }).catch(() => {});
  }

  return NextResponse.json(updated);
}

function applyResult(data: Prisma.FilterRequestUpdateInput, result: string | null) {
  data.respondedResult = result ?? null;
  if (result) {
    data.status = result === "가능" ? "APPROVED" : "REJECTED";
    data.respondedAt = new Date();
  } else {
    data.status = "PENDING";
    data.respondedAt = null;
  }
}

async function notifyResultAsync({
  clientName, companyName, respondedResult, salesRepUserId, lowerCorpName,
}: {
  clientName: string; companyName: string; respondedResult: string;
  salesRepUserId: string; lowerCorpName: string | null;
}) {
  const pfId = process.env.KAKAO_PF_ID;
  const templateId = process.env.KAKAO_TEMPLATE_FILTER_RESULT;
  if (!pfId || !templateId) return;

  const targets: string[] = [];

  // 영업사원 전화번호
  const salesRep = await prisma.user.findUnique({
    where: { id: salesRepUserId },
    select: { phone: true },
  });
  if (salesRep?.phone) targets.push(salesRep.phone);

  // 하위법인 담당자 전화번호
  if (lowerCorpName) {
    const dealer = await prisma.userClient.findFirst({
      where: { clientName: lowerCorpName, dealerType: { not: null } },
      select: { managerPhone: true },
    });
    if (dealer?.managerPhone) targets.push(dealer.managerPhone);
  }

  const fallbackText = `[KMD] 필터링 결과 안내\n거래처: ${clientName}\n제약사: ${companyName}\n결과: ${respondedResult}`;
  await Promise.allSettled(
    targets.map((phone) =>
      sendAlimtalk(phone, {
        pfId,
        templateId,
        variables: {
          "#{거래처명}": clientName,
          "#{제약사명}": companyName,
          "#{결과}": respondedResult,
        },
        buttons: [],
      }, fallbackText)
    )
  );
}
