import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAlimtalk } from "@/lib/coolsms";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const request = await prisma.filterRequest.findUnique({
    where: { responseToken: token },
    select: {
      id: true,
      clientName: true,
      companyName: true,
      userName: true,
      requestType: true,
      respondedResult: true,
    },
  });

  if (!request) {
    return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  return NextResponse.json(request);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { result } = await req.json();

  if (result !== "가능" && result !== "불가") {
    return NextResponse.json({ error: "result는 '가능' 또는 '불가'여야 합니다." }, { status: 400 });
  }

  let request: {
    id: string; clientName: string; companyName: string; respondedResult: string | null;
    userId: string; lowerCorpName?: string | null;
    user: { phone: string | null } | null;
  } | null = null;
  try {
    request = await prisma.filterRequest.findUnique({
      where: { responseToken: token },
      select: {
        id: true, clientName: true, companyName: true, respondedResult: true,
        userId: true, lowerCorpName: true,
        user: { select: { phone: true } },
      },
    });
  } catch {
    request = await prisma.filterRequest.findUnique({
      where: { responseToken: token },
      select: {
        id: true, clientName: true, companyName: true, respondedResult: true,
        userId: true,
        user: { select: { phone: true } },
      },
    });
  }

  if (!request) {
    return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  if (request.respondedResult) {
    return NextResponse.json({ error: "이미 응답하셨습니다." }, { status: 409 });
  }

  const newStatus = result === "가능" ? "APPROVED" : "REJECTED";

  await prisma.filterRequest.update({
    where: { id: request.id },
    data: {
      respondedResult: result,
      respondedAt: new Date(),
      status: newStatus,
      updatedAt: new Date(),
    },
  });

  // Notify sales rep + lower dealer in background
  notifyAsync({
    requestId: request.id,
    clientName: request.clientName,
    companyName: request.companyName,
    result,
    salesPhone: request.user?.phone ?? null,
    lowerCorpName: request.lowerCorpName ?? null,
  }).catch(() => {});

  return NextResponse.json({ success: true, result });
}

async function notifyAsync({
  requestId, clientName, companyName, result, salesPhone, lowerCorpName,
}: {
  requestId: string; clientName: string; companyName: string; result: string;
  salesPhone: string | null; lowerCorpName: string | null;
}) {
  const pfId = process.env.KAKAO_PF_ID;
  const templateId = process.env.KAKAO_TEMPLATE_FILTER_RESULT;
  if (!pfId || !templateId) return;

  const targets: string[] = [];
  if (salesPhone) targets.push(salesPhone);

  if (lowerCorpName) {
    try {
      const dealer = await prisma.userClient.findFirst({
        where: { clientName: lowerCorpName, dealerType: { not: null } },
        select: { managerPhone: true },
      });
      if (dealer?.managerPhone) targets.push(dealer.managerPhone);
    } catch { /* column may not exist yet */ }
  }

  const fallback = `[와이케이메디] ${clientName} × ${companyName} 필터링 결과: ${result}`;
  const alimPayload = {
    pfId,
    templateId,
    variables: { "#{거래처명}": clientName, "#{제약사명}": companyName, "#{결과}": result },
    buttons: [] as [],
  };

  await Promise.allSettled(targets.map((phone) => sendAlimtalk(phone, alimPayload, fallback)));

  await prisma.filterRequest.update({
    where: { id: requestId },
    data: { salesNotifiedAt: new Date(), updatedAt: new Date() },
  });
}
