import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAlimtalk } from "@/lib/coolsms";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { token } = params;

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

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const { token } = params;
  const { result } = await req.json();

  if (result !== "가능" && result !== "불가") {
    return NextResponse.json({ error: "result는 '가능' 또는 '불가'여야 합니다." }, { status: 400 });
  }

  const request = await prisma.filterRequest.findUnique({
    where: { responseToken: token },
    include: { user: { select: { phone: true, name: true, email: true } } },
  });

  if (!request) {
    return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  if (request.respondedResult) {
    return NextResponse.json({ error: "이미 응답하셨습니다." }, { status: 409 });
  }

  // 응답 저장
  await prisma.filterRequest.update({
    where: { id: request.id },
    data: {
      respondedResult: result,
      respondedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // 영업사원에게 AlimTalk 알림
  const pfId = process.env.KAKAO_PF_ID;
  const templateId = process.env.KAKAO_TEMPLATE_FILTER_RESULT;
  const salesPhone = request.user?.phone;

  if (pfId && templateId && salesPhone) {
    try {
      await sendAlimtalk(
        salesPhone,
        {
          pfId,
          templateId,
          variables: {
            "#{거래처명}": request.clientName,
            "#{제약사명}": request.companyName,
            "#{결과}": result,
            "#{요청유형}": request.requestType,
          },
        },
        `[메디밴스] ${request.clientName} × ${request.companyName} 필터링 결과: ${result}`
      );
      await prisma.filterRequest.update({
        where: { id: request.id },
        data: { salesNotifiedAt: new Date(), updatedAt: new Date() },
      });
    } catch (e) {
      console.error("영업사원 AlimTalk 실패", e);
    }
  }

  return NextResponse.json({ success: true, result });
}
