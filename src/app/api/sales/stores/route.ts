import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/workspace";
import { encrypt } from "@/lib/crypto";
import { getAccessToken } from "@/lib/naver/client";

export async function GET() {
  try {
    const { workspace } = await requireWorkspace();
    const stores = await prisma.naverStore.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({
      stores: stores.map((s) => ({ ...s, clientSecret: s.clientSecret ? "***" : "" })),
    });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

interface CreateBody {
  code?: string;
  bizName?: string;
  storeName?: string;
  clientId?: string;
  clientSecret?: string;
  enabled?: boolean;
  skipValidation?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const { workspace } = await requireWorkspace();
    const b = (await req.json()) as CreateBody;
    if (!b.code || !b.storeName || !b.clientId || !b.clientSecret) {
      return NextResponse.json({ error: "code/storeName/clientId/clientSecret required" }, { status: 400 });
    }

    // 키 사전 검증 — 토큰 발급 시도
    let validated = false;
    let validationError: string | null = null;
    if (!b.skipValidation) {
      try {
        await getAccessToken(b.clientId, b.clientSecret);
        validated = true;
      } catch (err) {
        validationError = err instanceof Error ? err.message : String(err);
      }
    }
    if (!b.skipValidation && !validated) {
      return NextResponse.json({
        error: "Naver API 인증 실패",
        detail: validationError,
        hint: validationError?.includes("Host not in allowlist")
          ? "현재 서버 IP 가 네이버 화이트리스트에 없습니다. 네이버 콘솔의 「API호출 IP」에 서버 IP 를 등록하거나 비워두세요."
          : "Client ID/Secret 을 다시 확인하거나, IP 화이트리스트를 점검하세요.",
        skipHint: "validation 을 건너뛰고 강제 저장하려면 skipValidation=true 로 다시 요청.",
      }, { status: 400 });
    }

    const store = await prisma.naverStore.create({
      data: {
        workspaceId: workspace.id,
        code: b.code,
        bizName: b.bizName ?? workspace.name,
        storeName: b.storeName,
        clientId: b.clientId,
        clientSecret: encrypt(b.clientSecret) ?? "",
        enabled: b.enabled ?? true,
      },
    });
    return NextResponse.json({ ok: true, id: store.id, validated });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
