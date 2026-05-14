import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, persistDataUri } from "@/lib/storage";

const VALID_ROLES = ["SALES_REP", "BASIC", "DOCTOR", "PHARMACIST"];

export async function GET(_req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, name: true, email: true, phone: true, carrier: true, role: true },
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
  } catch {
    // userDocument table may not exist yet
  }

  return NextResponse.json({ ...user, documents });
}

export async function PATCH(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const body = await req.json();
  const { currentPassword, newPassword, name, carrier, role } = body;

  // Password change
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

  // Profile update
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = String(name).trim();
  if (carrier !== undefined) data.carrier = carrier || null;
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
      data: {
        userId: session.id,
        docType: docType || "기타",
        fileName,
        fileKey,
        fileData: fileDataFallback,
      },
      select: { id: true, docType: true, fileName: true, createdAt: true },
    });
    return NextResponse.json({ ...doc, createdAt: doc.createdAt.toISOString() }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
