import { NextRequest, NextResponse } from "next/server";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

async function getWorker() {
  const baseUrl = process.env.WORKER_BASE_URL;
  const token = process.env.WORKER_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

// GET — worker의 epharmsSyncRunning 상태 조회 (폴링용)
export async function GET() {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const w = await getWorker();
  if (!w) return NextResponse.json({ epharmsSyncRunning: null });

  try {
    const r = await fetch(new URL("/health", w.baseUrl), {
      headers: { authorization: `Bearer ${w.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return NextResponse.json({ epharmsSyncRunning: null });
    const body = await r.json();
    return NextResponse.json({ epharmsSyncRunning: body.epharmsSyncRunning ?? null });
  } catch {
    return NextResponse.json({ epharmsSyncRunning: null });
  }
}

// POST — running 플래그 강제 초기화 후 sync 재시작
export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const w = await getWorker();
  if (!w)
    return NextResponse.json(
      { error: "WORKER_BASE_URL / WORKER_TOKEN 환경변수가 설정되지 않았습니다." },
      { status: 500 }
    );

  try {
    const r = await fetch(new URL("/epharms/sync/reset", w.baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${w.token}` },
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
