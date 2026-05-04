import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function bizOrAdmin(role: string) {
  return role === "BIZ" || role === "ADMIN";
}

// GET /api/biz-rates/history/export?corpClientId&applyMonthFrom&applyMonthTo
export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (!bizOrAdmin(user.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const corpClientId = sp.get("corpClientId") ?? undefined;
  const applyMonthFrom = sp.get("applyMonthFrom") ?? undefined;
  const applyMonthTo = sp.get("applyMonthTo") ?? undefined;

  const where = {
    ...(corpClientId ? { corpClientId } : {}),
    ...(applyMonthFrom || applyMonthTo
      ? {
          applyMonth: {
            ...(applyMonthFrom ? { gte: applyMonthFrom } : {}),
            ...(applyMonthTo ? { lte: applyMonthTo } : {}),
          },
        }
      : {}),
  };

  const items = await prisma.corpRateFileHistory.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      corpClientId: true,
      companyName: true,
      applyMonth: true,
      action: true,
      prevFileName: true,
      newFileName: true,
      createdAt: true,
      performedBy: { select: { name: true } },
    },
  });

  const header = ["법인ID", "제약사", "적용월", "액션", "이전파일", "새파일", "수행자", "일시"];
  const rows = items.map((h) => [
    h.corpClientId,
    h.companyName,
    h.applyMonth,
    h.action,
    h.prevFileName ?? "",
    h.newFileName ?? "",
    h.performedBy?.name ?? "",
    new Date(h.createdAt).toLocaleString("ko-KR"),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = [20, 20, 12, 10, 30, 30, 12, 20].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "요율표이력");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  // Next.js 16 NextResponse 타입이 Buffer 직접 안 받음 — Uint8Array로 변환
  const body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

  const encoded = encodeURIComponent("요율표_변경이력.xlsx");
  return new NextResponse(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
    },
  });
}
