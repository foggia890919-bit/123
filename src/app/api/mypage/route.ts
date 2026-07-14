import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";

const VALID_ROLES = ["BUSINESS", "BASIC", "DOCTOR", "PHARMACIST"];

export async function GET(_req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true, name: true, email: true, phone: true, carrier: true, role: true,
      isBusinessApproved: true,
      parent: { select: { id: true, name: true, email: true } },
    },
  });
  if (!user) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  let documents: { id: string; docType: string; fileName: string; createdAt: string }[] = [];
  try {
    const docs = await prisma.userDocument.findMany({
      where: { userId: session.id },
      select: { id: true, docType: true, fileName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    documents = docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }));
  } catch { }

  // 본인 사업자 정보 — User.ownerBizClientId 로 명시적으로 식별.
  // null 이면 (구 데이터 또는 미등록) UserClient(dealerType=null) 중 가장 오래된 거 fallback.
  let bizClient: { id: string; clientName: string; bizNumber: string; address: string | null; bizFileName: string | null } | null = null;
  try {
    const userRow = await prisma.user.findUnique({
      where: { id: session.id },
      select: { ownerBizClientId: true },
    });
    if (userRow?.ownerBizClientId) {
      bizClient = await prisma.userClient.findUnique({
        where: { id: userRow.ownerBizClientId },
        select: { id: true, clientName: true, bizNumber: true, address: true, bizFileName: true },
      });
    }
    // fallback: ownerBizClientId 미설정시 가장 오래된 본인-타입 거래처
    if (!bizClient) {
      bizClient = await prisma.userClient.findFirst({
        where: { userId: session.id, dealerType: null },
        select: { id: true, clientName: true, bizNumber: true, address: true, bizFileName: true },
        orderBy: { createdAt: "asc" },
      });
      // 발견되면 즉시 ownerBizClientId 로 연결 (다음부터는 명시적으로 식별됨)
      if (bizClient) {
        await prisma.user.update({
          where: { id: session.id },
          data: { ownerBizClientId: bizClient.id },
        }).catch(() => {/* silent */});
      }
    }
  } catch { }

  return NextResponse.json({ ...user, documents, bizClient });
}

export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const body = await req.json();
  const { currentPassword, newPassword, name, role, biz } = body;

  // 비밀번호 변경
  if (currentPassword !== undefined || newPassword !== undefined) {
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return NextResponse.json({ error: "새 비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    }
    const user = await prisma.user.findUnique({ where: { id: session.id } });
    if (!user) return NextResponse.json({ error: "사용자 없음" }, { status: 404 });
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) return NextResponse.json({ error: "현재 비밀번호가 올바르지 않아요." }, { status: 401 });
    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: session.id }, data: { password: hashed, updatedAt: new Date() } });
    return NextResponse.json({ success: true });
  }

  // 사업자 정보 저장
  if (biz !== undefined) {
    const { id: bizId, clientName, bizNumber, address, bizDocument } = biz as {
      id?: string; clientName: string; bizNumber: string; address?: string;
      bizDocument?: { fileName: string; fileData: string } | null;
    };
    if (!clientName?.trim() || !bizNumber?.trim()) {
      return NextResponse.json({ error: "상호명과 사업자번호는 필수예요." }, { status: 400 });
    }
    const digits = String(bizNumber).replace(/\D/g, "");

    let bizFileKey: string | null = null;
    let bizDocFallback: string | null = null;
    let bizFileName: string | null = null;
    if (bizDocument?.fileData) {
      const result = await persistDataUri(BUCKETS.userClientBiz, session.id, bizDocument.fileData);
      bizFileKey = result.fileKey;
      bizDocFallback = result.fileData;
      bizFileName = bizDocument.fileName;
    }

    // 본인 사업자 식별 — User.ownerBizClientId 기준. bizId 클라이언트 값보다 우선.
    const me = await prisma.user.findUnique({
      where: { id: session.id },
      select: { ownerBizClientId: true },
    });
    const ownerId = me?.ownerBizClientId ?? null;

    if (ownerId) {
      // 본인 사업자 행만 수정 — 다른 거래처는 절대 건드리지 않음.
      const data: Record<string, unknown> = {
        clientName: clientName.trim(),
        bizNumber: digits,
        address: address?.trim() || null,
      };
      if (bizFileKey) { data.bizFileKey = bizFileKey; data.bizDocument = bizDocFallback; data.bizFileName = bizFileName; }
      try {
        await prisma.userClient.update({ where: { id: ownerId }, data });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Unique constraint")) {
          return NextResponse.json({ error: "이미 같은 사업자번호로 등록된 거래처가 있어요. 거래처 관리에서 중복 항목을 정리해주세요." }, { status: 409 });
        }
        return NextResponse.json({ error: `수정 실패: ${msg.slice(0, 200)}` }, { status: 500 });
      }
    } else {
      // 본인 사업자 신규 등록 — UserClient 만들고 User.ownerBizClientId 에 연결.
      const createData: Record<string, unknown> = {
        userId: session.id,
        clientName: clientName.trim(),
        bizNumber: digits,
        address: address?.trim() || null,
        bizFileKey,
        bizDocument: bizDocFallback,
        bizFileName,
        dealerType: null,
        approved: true,
      };
      try {
        const created = await prisma.userClient.create({
          data: createData as Parameters<typeof prisma.userClient.create>[0]["data"],
        });
        // 즉시 ownerBizClientId 로 연결 — 다음부터 본인 사업자로 명시 식별됨.
        await prisma.user.update({
          where: { id: session.id },
          data: { ownerBizClientId: created.id },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Unique constraint")) {
          return NextResponse.json({ error: "이미 등록된 사업자번호예요." }, { status: 409 });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }
    return NextResponse.json({ success: true });
  }

  // 프로필 수정 (이름, 직업)
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = String(name).trim();
  if (role !== undefined && VALID_ROLES.includes(role)) data.role = role;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "변경할 항목이 없어요." }, { status: 400 });
  }
  data.updatedAt = new Date();
  await prisma.user.update({ where: { id: session.id }, data });
  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const { docType, fileName, fileData } = await req.json();
  if (!fileName || !fileData) {
    return NextResponse.json({ error: "파일 정보가 없어요." }, { status: 400 });
  }

  const { fileKey, fileData: fileDataFallback } = await persistDataUri(BUCKETS.userDocument, session.id, fileData);

  try {
    const doc = await prisma.userDocument.create({
      data: { userId: session.id, docType: docType || "기타", fileName, fileKey, fileData: fileDataFallback },
      select: { id: true, docType: true, fileName: true, createdAt: true },
    });
    return NextResponse.json({ ...doc, createdAt: doc.createdAt.toISOString() }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
