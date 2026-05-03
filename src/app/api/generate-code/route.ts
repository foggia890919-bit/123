import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

// 코드 형식: {PREFIX}{YYYYMM}{4자리순번}
// 병의원(Client/UserClient dealerType=null): H202501-0001
// 법인(UserClient dealerType≠null): C202501-0001
// 영업사원(User): S202501-0001

function makePrefix(type: "hospital" | "corp" | "sales") {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const p = type === "hospital" ? "H" : type === "corp" ? "C" : "S";
  return `${p}${ym}`;
}

async function nextSeq(prefix: string, type: "hospital" | "corp" | "sales"): Promise<string> {
  // 같은 prefix의 최대 시퀀스 번호를 찾아서 +1
  let maxCode: string | null = null;

  if (type === "hospital") {
    const r1 = await prisma.client.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: "desc" } });
    const r2 = await prisma.userClient.findFirst({
      where: { code: { startsWith: prefix }, dealerType: null },
      orderBy: { code: "desc" },
    }).catch(() => null);
    const codes = [r1?.code, r2?.code].filter(Boolean) as string[];
    maxCode = codes.sort().at(-1) ?? null;
  } else if (type === "corp") {
    const r = await prisma.userClient.findFirst({
      where: { code: { startsWith: prefix }, dealerType: { not: null } },
      orderBy: { code: "desc" },
    }).catch(() => null);
    maxCode = r?.code ?? null;
  } else {
    const r = await prisma.user.findFirst({ where: { salesCode: { startsWith: prefix } }, orderBy: { salesCode: "desc" } });
    maxCode = r?.salesCode ?? null;
  }

  let seq = 1;
  if (maxCode) {
    const parts = maxCode.split("-");
    const n = parseInt(parts[1] ?? "0", 10);
    if (!isNaN(n)) seq = n + 1;
  }
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { type, id } = await req.json();
  // type: "hospital" | "corp" | "sales"
  // id: Client.id / UserClient.id / User.id

  if (!type || !id) return NextResponse.json({ error: "type, id 필수" }, { status: 400 });

  const prefix = makePrefix(type);
  const code = await nextSeq(prefix, type);

  if (type === "hospital") {
    // Client 또는 UserClient (병의원)
    const client = await prisma.client.findUnique({ where: { id } });
    if (client) {
      if (client.code) return NextResponse.json({ error: "이미 코드가 있습니다.", code: client.code }, { status: 409 });
      await prisma.client.update({ where: { id }, data: { code } });
      return NextResponse.json({ code });
    }
    const uc = await prisma.userClient.findUnique({ where: { id } }).catch(() => null);
    if (uc) {
      if (uc.code) return NextResponse.json({ error: "이미 코드가 있습니다.", code: uc.code }, { status: 409 });
      await prisma.userClient.update({ where: { id }, data: { code } }).catch(() => null);
      return NextResponse.json({ code });
    }
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (type === "corp") {
    const uc = await prisma.userClient.findUnique({ where: { id } }).catch(() => null);
    if (!uc) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (uc.code) return NextResponse.json({ error: "이미 코드가 있습니다.", code: uc.code }, { status: 409 });
    await prisma.userClient.update({ where: { id }, data: { code } }).catch(() => null);
    return NextResponse.json({ code });
  }

  if (type === "sales") {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (u.salesCode) return NextResponse.json({ error: "이미 코드가 있습니다.", code: u.salesCode }, { status: 409 });
    await prisma.user.update({ where: { id }, data: { salesCode: code } });
    return NextResponse.json({ code });
  }

  return NextResponse.json({ error: "type 오류" }, { status: 400 });
}
