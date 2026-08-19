import { NextRequest, NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET;

export const maxDuration = 300;

// 주간 cron: 식약처 의약품 묶음정보(동일제조소) 전량 동기화.
// sync-bundle을 배치 단위로 연속 호출한다. 내부 호출에 Bearer CRON_SECRET을 반드시 전달
// (requireAdminOrService가 이 헤더로 서비스 인증). 시간 예산 초과 시 중단 — 세대 교체 방식이라
// 미완료 세대는 조회에 노출되지 않고, 다음 실행이 1페이지부터 새로 시작하며 잔여분을 정리한다.
export async function GET(req: NextRequest) {
  // CRON_SECRET 미설정 시에도 반드시 401 반환 — 빈 시크릿으로 인한 인증 우회 방지
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 240_000;

  let page = 1;
  let totalSynced = 0;
  let batches = 0;
  let done = false;
  let lastResponse: Record<string, unknown> | null = null;

  try {
    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const res = await fetch(`${baseUrl}/api/medications/sync-bundle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({ startPage: page, batchSize: 20 }),
      });
      const data = await res.json().catch(() => ({}));
      lastResponse = data;
      if (!res.ok || data?.error) {
        return NextResponse.json({ ok: false, page, totalSynced, batches, error: data?.error || `sync-bundle ${res.status}` }, { status: 502 });
      }
      totalSynced += Number(data?.synced) || 0;
      batches++;
      if (data?.done || data?.nextPage == null) {
        done = true;
        break;
      }
      page = Number(data.nextPage);
    }

    return NextResponse.json({
      ok: true,
      done,
      totalSynced,
      batches,
      elapsedMs: Date.now() - startedAt,
      last: lastResponse,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), page, totalSynced, batches }, { status: 500 });
  }
}
