import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrService, isNextResponse } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const auth = await requireAdminOrService(req);
  if (isNextResponse(auth)) return auth;

  try {
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/medications/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "full" }),
    });
    const data = await res.json();
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
