// 활성 워치의 cortarNo 합집합을 대상으로 네이버부동산을 폴링.
// Vercel Serverless 환경에서는 Playwright가 무거우므로, 이 라우트는 별도 워커
// 서버 또는 GitHub Actions runner에서 호출하는 패턴을 권장.
//
// Vercel 위에서 직접 돌리고 싶다면 worker URL로 위임만 하도록 변경하면 됨
// (`process.env.RE_WORKER_URL`).

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 외부 워커가 설정되어 있으면 위임 (Vercel에서 Playwright 대신)
  const workerUrl = process.env.RE_WORKER_URL;
  const workerToken = process.env.RE_WORKER_TOKEN;
  if (workerUrl) {
    const r = await fetch(`${workerUrl.replace(/\/$/, "")}/realestate/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
    });
    const text = await r.text();
    return NextResponse.json({ ok: r.ok, status: r.status, body: text.slice(0, 4000) });
  }

  // 위임 대상이 없으면 동작 안 한다는 사실을 명시 (Lambda/Vercel에선 Playwright 미지원)
  const watches = await prisma.rEWatch.count({ where: { enabled: true } });
  return NextResponse.json({
    ok: false,
    reason: "RE_WORKER_URL not configured. Run `npm run re:scrape` on a host with Playwright (e.g. Lightsail, GitHub Actions).",
    activeWatches: watches,
  });
}
