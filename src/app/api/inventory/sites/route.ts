import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Lists configured wholesale sites (which adapters are registered + have
// credentials on the worker). Used by the UI to know which logos to show.

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workerUrl = process.env.WORKER_URL;
  const workerToken = process.env.WORKER_TOKEN;
  if (!workerUrl || !workerToken) {
    return NextResponse.json({ sites: [], workerConfigured: false, error: "worker not configured" });
  }

  try {
    const r = await fetch(`${workerUrl.replace(/\/$/, "")}/sites`, {
      headers: { Authorization: `Bearer ${workerToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      return NextResponse.json({ sites: [], error: `worker error ${r.status}` });
    }
    return NextResponse.json(await r.json());
  } catch (err) {
    return NextResponse.json({ sites: [], error: (err as Error).message });
  }
}
