// 워커에 sync 시작 명령을 프록시한다. 실제 크롤링은 워커에서 비동기 실행됨.
//   POST /api/epharms-accounts/sync                → 전체 활성 계정
//   POST /api/epharms-accounts/sync?accountId=XXX  → 특정 계정만 (테스트용)

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

  const accountId = req.nextUrl.searchParams.get("accountId");
  const url = new URL("/epharms/sync", baseUrl);
  if (accountId) url.searchParams.set("accountId", accountId);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
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
