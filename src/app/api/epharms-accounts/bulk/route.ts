// ePharms 계정 Excel 일괄등록 API.
// multipart/form-data 로 xlsx/xls 파일을 받아 upsert 처리.
// 컬럼: 사업자번호 | 거래처명 | 이팜스ID | 이팜스PW | KMD아이디(선택) | 메모(선택)
// KMD아이디: User.email 값 → kmdUserId로 resolve

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { encryptSecret } from "@/lib/crypto-secret";

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data 파싱 실패" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "file 필드가 없습니다." }, { status: 400 });
  }

  const arrayBuffer = await (file as File).arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return NextResponse.json({ error: "시트가 없습니다." }, { status: 400 });
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  // KMD아이디(email) → userId 캐싱
  const kmdEmailCache = new Map<string, string>();
  async function resolveKmdEmail(email: string): Promise<string | null> {
    if (!email) return null;
    const key = email.toLowerCase();
    if (kmdEmailCache.has(key)) return kmdEmailCache.get(key)!;
    const u = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    const id = u?.id ?? null;
    if (id) kmdEmailCache.set(key, id);
    return id;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const rawBiz = String(row["사업자번호"] ?? "").replace(/[^0-9]/g, "");
    const clientName = String(row["거래처명"] ?? "").trim();
    const loginId = String(row["이팜스ID"] ?? "").trim();
    const loginPw = String(row["이팜스PW"] ?? "").trim();
    const kmdEmailRaw = String(row["KMD아이디"] ?? "").trim();
    const memo = String(row["메모"] ?? "").trim() || null;

    if (!rawBiz || !clientName || !loginId || !loginPw) {
      errors.push(`행 ${rowNum}: 사업자번호·거래처명·이팜스ID·이팜스PW 는 필수입니다.`);
      skipped++;
      continue;
    }

    try {
      const loginPwEnc = encryptSecret(loginPw);
      const kmdUserId = await resolveKmdEmail(kmdEmailRaw);
      if (kmdEmailRaw && !kmdUserId) {
        errors.push(`행 ${rowNum}: KMD아이디 "${kmdEmailRaw}"를 찾을 수 없습니다. (빈칸으로 처리)`);
      }

      const existing = await prisma.epharmsAccount.findUnique({
        where: { bizNumber: rawBiz },
        select: { id: true },
      });

      await prisma.epharmsAccount.upsert({
        where: { bizNumber: rawBiz },
        create: {
          bizNumber: rawBiz,
          clientName,
          loginId,
          loginPwEnc,
          memo,
          kmdUserId,
        },
        update: {
          clientName,
          loginId,
          loginPwEnc,
          ...(kmdUserId !== null ? { kmdUserId } : {}),
          updatedAt: new Date(),
        },
      });

      if (existing) updated++;
      else created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`행 ${rowNum} (${rawBiz}): ${msg}`);
      skipped++;
    }
  }

  return NextResponse.json({ created, updated, skipped, errors });
}
