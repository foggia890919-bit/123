import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import * as XLSX from "xlsx";

interface BulkRow {
  clientName: string;
  bizNumber: string;
  address?: string | null;
}

// POST /api/user-clients/bulk — 엑셀 대량 등록
export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "파일 없음" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "" });

  if (!rows.length) return NextResponse.json({ error: "데이터가 없습니다." }, { status: 400 });

  const parsed: BulkRow[] = [];
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const clientName = String(row["거래처명"] ?? "").trim();
    const bizRaw = String(row["사업자등록번호"] ?? "").replace(/\D/g, "");
    const address = String(row["주소"] ?? "").trim() || null;

    if (!clientName) { errors.push(`${i + 2}행: 거래처명 없음`); continue; }
    if (bizRaw.length !== 10) { errors.push(`${i + 2}행 "${clientName}": 사업자번호 형식 오류`); continue; }

    parsed.push({ clientName, bizNumber: bizRaw, address });
  }

  if (!parsed.length) {
    return NextResponse.json({ error: "유효한 행이 없습니다.", details: errors }, { status: 400 });
  }

  // 기존 사업자번호 조회 (중복 스킵)
  const existing = await prisma.userClient.findMany({
    where: { userId: user.id, bizNumber: { in: parsed.map((r) => r.bizNumber) } },
    select: { bizNumber: true },
  });
  const existingSet = new Set(existing.map((e) => e.bizNumber));

  const toCreate = parsed.filter((r) => !existingSet.has(r.bizNumber));
  const skipped = parsed.filter((r) => existingSet.has(r.bizNumber)).map((r) => r.clientName);

  if (toCreate.length) {
    await prisma.userClient.createMany({
      data: toCreate.map((r) => ({
        userId: user.id,
        clientName: r.clientName,
        bizNumber: r.bizNumber,
        address: r.address,
      })),
      skipDuplicates: true,
    });
  }

  return NextResponse.json({
    created: toCreate.length,
    skipped: skipped.length,
    skippedNames: skipped,
    errors,
  });
}
