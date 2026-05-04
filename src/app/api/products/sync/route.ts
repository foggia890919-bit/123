// 워커에 상품 자동 동기화 시작 명령. 워커는 비동기로 5~10분 작업.

import { NextRequest, NextResponse } from "next/server";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const baseUrl = process.env.WORKER_BASE_URL;
  const token = process.env.WORKER_TOKEN;
  if (!baseUrl || !token) {
    return NextResponse.json(
      { error: "WORKER_BASE_URL / WORKER_TOKEN 환경변수가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  // 워커가 다운로드한 xlsx를 다시 업로드할 우리 자신 URL
  const origin = req.nextUrl.origin;
  const uploadUrl = `${origin}/api/products/upload`;

  try {
    const r = await fetch(new URL("/epharms/sync-products", baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        uploadUrl,
        uploadToken: token,
        triggeredBy: user.id,
      }),
    });
    const body = await r.json().catch(() => ({}));
    return NextResponse.json(body, { status: r.status });
  } catch (err) {
    return NextResponse.json(
      { error: `worker 호출 실패: ${(err as Error).message}` },
      { status: 502 }
    );
  }
}
