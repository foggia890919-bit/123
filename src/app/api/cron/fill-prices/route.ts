import { NextRequest, NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET;

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // CRON_SECRET 미설정 시에도 반드시 401 반환 — 빈 시크릿으로 인한 인증 우회 방지
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 401 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/admin/fill-prices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 내부 크론 호출임을 표시 (requireAdmin 우회용 내부 헤더)
        "x-cron-secret": CRON_SECRET,
      },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
