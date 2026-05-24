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

  // 사업자 정보 (dealerType: null = 의료기관, 본인 대표 사업자)
  let bizClient: { id: string; clientName: string; bizNumber: string; address: string | null; bizFileName: string | null } | null = null;
  try {
    bizClient = await prisma.userClient.findFirst({
      where: { userId: session.id, dealerType: null },
      select: { id: true, clientName: true, bizNumber: true, address: true, bizFileName: true },
      orderBy: { createdAt: "asc" },
    });
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

    if (bizId) {
      // 기존 레코드 수정
      const existing = await prisma.userClient.findUnique({ where: { id: bizId }, select: { userId: true } });
      if (!existing || existing.userId !== session.id) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
      const data: Record<string, unknown> = {
        clientName: clientName.trim(),
        address: address?.trim() || null,
      };
      if (bizFileKey) { data.bizFileKey = bizFileKey; data.bizDocument = bizDocFallback; data.bizFileName = bizFileName; }
      try {
        await prisma.userClient.update({ where: { id: bizId }, data });
      } catch {
        await prisma.userClient.update({ where: { id: bizId }, data: { clientName: clientName.trim() } });
      }
    } else {
      // 신규 생성
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
        await prisma.userClient.create({ data: createData as Parameters<typeof prisma.userClient.create>[0]["data"] });
      } catch {
        try {
          await prisma.userClient.create({
            data: { userId: session.id, clientName: clientName.trim(), bizNumber: digits, dealerType: null, approved: true } as Parameters<typeof prisma.userClient.create>[0]["data"],
          });
        } catch (e2) {
          const msg = e2 instanceof Error ? e2.message : String(e2);
          if (msg.includes("Unique constraint")) return NextResponse.json({ error: "이미 등록된 사업자번호예요." }, { status: 409 });
          return NextResponse.json({ error: msg }, { status: 500 });
        }
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
