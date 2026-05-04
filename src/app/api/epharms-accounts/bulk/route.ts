import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { encryptSecret } from "@/lib/crypto-secret";

interface RowResult {
  row: number;
  bizNumber: string;
  clientName: string;
  status: "inserted" | "updated" | "failed";
  error?: string;
}

function extractEmail(s: string): string | null {
  if (!s) return null;
  const m = s.match(/\(([^()]+@[^()]+)\)\s*$/);
  if (m) return m[1].trim().toLowerCase();
  if (s.includes("@")) return s.trim().toLowerCase();
  return null;
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "ADMIN" && user.role !== "BIZ") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames.find((n) => n !== "작성안내") ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });

  const repCache = new Map<string, string>();
  const results: RowResult[] = [];
  let inserted = 0, updated = 0, failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    const clientName = String(r["거래처명"] ?? "").trim();
    const bizNumber  = String(r["사업자번호"] ?? "").replace(/[^0-9]/g, "");
    const loginId    = String(r["EPHARMS_ID"] ?? "").trim();
    const loginPw    = String(r["EPHARMS_PW"] ?? "").trim();
    const salesRepRaw = String(r["영업사원"] ?? "").trim();

    if (!clientName && !bizNumber && !loginId && !loginPw) continue;
    if (!clientName || !bizNumber || !loginId || !loginPw) {
      results.push({ row: rowNum, bizNumber, clientName, status: "failed",
        error: "필수 컬럼 누락 (거래처명/사업자번호/EPHARMS_ID/EPHARMS_PW)" });
      failed++; continue;
    }

    let salesRepUserId: string | null = null;
    if (salesRepRaw) {
      const email = extractEmail(salesRepRaw);
      if (!email) {
        results.push({ row: rowNum, bizNumber, clientName, status: "failed",
          error: `영업사원 형식 오류: "${salesRepRaw}"` });
        failed++; continue;
      }
      let userId = repCache.get(email);
      if (!userId) {
        const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (!u) {
          results.push({ row: rowNum, bizNumber, clientName, status: "failed",
            error: `영업사원 미존재: ${email}` });
          failed++; continue;
        }
        userId = u.id;
        repCache.set(email, userId);
      }
      salesRepUserId = userId;
    }

    try {
      const enc = encryptSecret(loginPw);
      const existed = await prisma.epharmsAccount.findUnique({
        where: { bizNumber }, select: { id: true },
      });
      await prisma.epharmsAccount.upsert({
        where: { bizNumber },
        create: { bizNumber, clientName, loginId, loginPwEnc: enc, assignedSalesRepUserId: salesRepUserId },
        update: { clientName, loginId, loginPwEnc: enc, active: true, assignedSalesRepUserId: salesRepUserId },
      });
      results.push({ row: rowNum, bizNumber, clientName, status: existed ? "updated" : "inserted" });
      if (existed) updated++; else inserted++;
    } catch (e) {
      results.push({ row: rowNum, bizNumber, clientName, status: "failed",
        error: e instanceof Error ? e.message : "DB 오류" });
      failed++;
    }
  }
  return NextResponse.json({ inserted, updated, failed, total: inserted + updated + failed, results });
}
