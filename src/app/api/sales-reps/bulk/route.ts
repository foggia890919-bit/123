// 영업사원 대량등록 + 거래처 매핑 일괄 생성.
//
// 입력 1행 = 영업사원 1명 + 담당 거래처 N개 매핑
//   { name, email, phone?, password, bizNumbers: ["2110948285", ...] }
//
// 처리:
//   1) User 생성 (role=SALES_REP, approved=true, S코드 자동 발급)
//   2) bizNumber 마다 EpharmsAccount 조회 → clientName 가져옴 (없으면 placeholder)
//   3) UserClient (approved=true) 매핑 생성 (중복 키는 update)
//
// 한 행씩 독립 처리 — 일부 실패해도 나머지는 진행.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import bcrypt from "bcryptjs";

interface BulkRow {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  bizNumbers?: string[];
}

interface RowResult {
  row: number;
  status: "ok" | "error";
  email?: string;
  userId?: string;
  salesCode?: string;
  mappedClients?: number;
  unmappedBizNumbers?: string[];
  error?: string;
  createdNew?: boolean;       // true=신규생성 / false=기존유저에 매핑만 추가
  generatedPassword?: string; // 사장님이 비워둬서 자동 생성된 PW (신규일 때만)
}

function generateRandomPassword(): string {
  // 헷갈리는 문자(0/O, 1/l/I) 제외한 8자리
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function nextSalesCode(maxCode: string | null, prefix: string): string {
  let seq = 1;
  if (maxCode) {
    const n = parseInt(maxCode.split("-")[1] ?? "0", 10);
    if (!isNaN(n)) seq = n + 1;
  }
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

function thisMonthPrefix(): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `S${ym}`;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalizeBiz(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null) as { rows?: BulkRow[] } | null;
  if (!body?.rows || !Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "rows 배열 필수" }, { status: 400 });
  }
  if (body.rows.length > 200) {
    return NextResponse.json({ error: "한 번에 최대 200행까지 처리 가능합니다." }, { status: 400 });
  }

  // 이번 달 prefix의 다음 시퀀스 번호 — 한 번만 조회해서 메모리에서 +1
  const prefix = thisMonthPrefix();
  const lastWithThisPrefix = await prisma.user.findFirst({
    where: { salesCode: { startsWith: prefix } },
    orderBy: { salesCode: "desc" },
    select: { salesCode: true },
  });
  let lastCode = lastWithThisPrefix?.salesCode ?? null;

  const results: RowResult[] = [];

  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i];
    const email = (r.email ?? "").trim().toLowerCase();
    const name = (r.name ?? "").trim();
    const phone = r.phone?.trim() || null;
    const password = r.password ?? "";
    const bizNumbers = Array.from(
      new Set((r.bizNumbers ?? []).map(normalizeBiz).filter((b) => b.length >= 9 && b.length <= 12))
    );

    // 행별 검증
    if (!name) {
      results.push({ row: i, status: "error", email, error: "이름 누락" });
      continue;
    }
    if (!email || !isValidEmail(email)) {
      results.push({ row: i, status: "error", email, error: "유효하지 않은 이메일" });
      continue;
    }
    // 비밀번호:
    //  - 기존 유저면 무시 (PW 갱신 안 함)
    //  - 신규 유저인데 비어있으면 자동 생성
    //  - 신규 유저인데 적었으면 4자 이상 검증
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, salesCode: true, role: true },
    });
    let effectivePassword = password;
    let generatedPassword: string | undefined;
    if (!existing) {
      if (!password || password.length === 0) {
        generatedPassword = generateRandomPassword();
        effectivePassword = generatedPassword;
      } else if (password.length < 4) {
        results.push({ row: i, status: "error", email, error: "비밀번호는 비워두거나 4자 이상" });
        continue;
      }
    }

    try {
      let userId: string;
      let salesCode: string;
      let createdNew: boolean;

      if (existing) {
        // 이미 가입된 이메일 — 거래처 매핑만 추가/갱신, 비밀번호·이름 그대로
        userId = existing.id;
        salesCode = existing.salesCode ?? "";
        createdNew = false;
      } else {
        // 신규 — User + 코드 자동 발급
        const newCode = nextSalesCode(lastCode, prefix);
        lastCode = newCode;
        const hashed = await bcrypt.hash(effectivePassword, 12);
        const created = await prisma.user.create({
          data: {
            email, name, phone, password: hashed,
            role: "SALES_REP", approved: true, salesCode: newCode,
          },
          select: { id: true, salesCode: true },
        });
        userId = created.id;
        salesCode = created.salesCode!;
        createdNew = true;
      }

      // 거래처 매핑 — 등록된 EpharmsAccount에서 clientName 끌어옴 (없으면 placeholder)
      const accounts = bizNumbers.length > 0
        ? await prisma.epharmsAccount.findMany({
            where: { bizNumber: { in: bizNumbers } },
            select: { bizNumber: true, clientName: true },
          })
        : [];
      const accountMap = new Map(accounts.map((a) => [a.bizNumber, a.clientName]));

      const unmapped: string[] = [];
      let mappedCount = 0;
      for (const bn of bizNumbers) {
        const clientName = accountMap.get(bn) ?? `(미등록 ${bn})`;
        if (!accountMap.has(bn)) unmapped.push(bn);
        await prisma.userClient.upsert({
          where: { userId_bizNumber: { userId, bizNumber: bn } },
          create: {
            userId,
            clientName,
            bizNumber: bn,
            approved: true,
          },
          update: { clientName, approved: true },
        });
        mappedCount++;
      }

      results.push({
        row: i,
        status: "ok",
        email,
        userId,
        salesCode,
        mappedClients: mappedCount,
        unmappedBizNumbers: unmapped.length > 0 ? unmapped : undefined,
        createdNew,
        generatedPassword,
      });
    } catch (err) {
      results.push({
        row: i,
        status: "error",
        email,
        error: (err as Error).message,
      });
    }
  }

  const okResults = results.filter((r) => r.status === "ok");
  const created = okResults.filter((r) => r.createdNew).length;
  const updated = okResults.filter((r) => !r.createdNew).length;
  const error = results.length - okResults.length;
  return NextResponse.json({
    summary: { total: results.length, ok: okResults.length, created, updated, error },
    results,
  });
}
