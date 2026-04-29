import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { sendAlimtalk } from "@/lib/coolsms";

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 });

  const request = await prisma.filterRequest.findUnique({
    where: { id },
    select: {
      id: true, clientName: true, companyName: true, requestType: true,
      userName: true, responseToken: true, mappingId: true,
      mapping: { select: { managerPhone: true } },
    },
  });

  if (!request) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!request.mappingId || !request.mapping?.managerPhone) {
    return NextResponse.json({ error: "매핑 또는 담당자 연락처가 없습니다." }, { status: 400 });
  }

  // Ensure response token exists
  let token = request.responseToken;
  if (!token) {
    token = crypto.randomUUID();
    await prisma.filterRequest.update({ where: { id }, data: { responseToken: token } });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://medivance.co.kr";
  const respondUrl = `${baseUrl}/filter-respond/${token}`;
  const pfId = process.env.KAKAO_PF_ID;
  const templateId = process.env.KAKAO_TEMPLATE_FILTER_REQUEST;

  if (!pfId || !templateId) {
    return NextResponse.json({ error: "카카오 알림톡 설정이 없습니다." }, { status: 500 });
  }

  await sendAlimtalk(
    request.mapping.managerPhone,
    {
      pfId,
      templateId,
      variables: {
        "#{거래처명}": request.clientName,
        "#{제약사명}": request.companyName,
        "#{영업사원}": request.userName ?? "",
        "#{요청유형}": request.requestType || "신규",
      },
      buttons: [{ buttonType: "WL", buttonName: "응답하기", linkMo: respondUrl, linkPc: respondUrl }],
    },
    `[KMD] 필터링 요청\n\n거래처: ${request.clientName}\n제약사: ${request.companyName}\n담당 영업사원: ${request.userName ?? ""}\n\n위 건 필터링 가능 여부를 확인해 주세요.\n응답: ${respondUrl}`
  );

  await prisma.filterRequest.update({
    where: { id },
    data: { alimtalkSentAt: new Date(), updatedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
