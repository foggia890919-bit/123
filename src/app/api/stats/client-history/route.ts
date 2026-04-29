import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export const runtime = "nodejs";

// 거래처별 처방 히스토리 — 직전월 처방 + 자주 처방 약품 top N
//
// GET /api/stats/client-history?clientId=...&year=2026&month=4&limit=30
//
// Response:
// {
//   lastMonth: { drugs: ManualDrug[], year, month } | null,
//   frequent: ManualDrug[],   // 빈도 상위 N개 (최근 3개월 가중치 ×2)
// }

interface ManualDrug {
  insuranceCode: string;
  companyName: string;
  productName: string;
  quantity: string;
  unitPrice: number | null;
  matchedMedicationId: string | null;
}

function prevMonth(year: number, month: number): { year: number; month: number } {
  if (month <= 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function extractFinalDrugs(ocrData: unknown): ManualDrug[] {
  if (!ocrData || typeof ocrData !== "object") return [];
  const obj = ocrData as Record<string, unknown>;
  const final = obj.finalDrugs;
  if (!Array.isArray(final)) return [];
  return final
    .map((d): ManualDrug | null => {
      if (!d || typeof d !== "object") return null;
      const r = d as Record<string, unknown>;
      const productName = String(r.productName ?? "").trim();
      if (!productName) return null;
      return {
        insuranceCode: String(r.insuranceCode ?? "").trim(),
        companyName: String(r.companyName ?? "").trim(),
        productName,
        quantity: String(r.quantity ?? "").trim(),
        unitPrice: typeof r.unitPrice === "number" ? r.unitPrice : null,
        matchedMedicationId: typeof r.matchedMedicationId === "string" ? r.matchedMedicationId : null,
      };
    })
    .filter((x): x is ManualDrug => x !== null);
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const clientId = req.nextUrl.searchParams.get("clientId")?.trim();
  const year = parseInt(req.nextUrl.searchParams.get("year") ?? "") || 0;
  const month = parseInt(req.nextUrl.searchParams.get("month") ?? "") || 0;
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "30") || 30, 5), 100);
  if (!clientId) return NextResponse.json({ error: "clientId 필수" }, { status: 400 });

  // 권한: 본인 거래처만 (ADMIN 제외)
  const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { userId: true } });
  if (!client) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (user.role !== "ADMIN" && client.userId !== user.id) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // 직전월 데이터
  let lastMonth: { drugs: ManualDrug[]; year: number; month: number } | null = null;
  if (year && month) {
    const pm = prevMonth(year, month);
    const prevReport = await prisma.prescriptionReport.findFirst({
      where: { clientId, year: pm.year, month: pm.month },
      orderBy: { createdAt: "desc" },
      select: { ocrData: true, year: true, month: true },
    });
    if (prevReport) {
      const drugs = extractFinalDrugs(prevReport.ocrData);
      if (drugs.length > 0) lastMonth = { drugs, year: prevReport.year, month: prevReport.month };
    }
  }

  // 자주 처방 약품 (최근 6개월 + 최근 3개월 가중치 ×2)
  const recentReports = await prisma.prescriptionReport.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    take: 24,
    select: { ocrData: true, year: true, month: true, createdAt: true },
  });

  // (insuranceCode || productName) 기준 집계
  const counter = new Map<string, { drug: ManualDrug; weight: number }>();
  const now = new Date();
  for (const r of recentReports) {
    const drugs = extractFinalDrugs(r.ocrData);
    const ageMonths = Math.max(0, (now.getTime() - r.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30));
    const weight = ageMonths <= 3 ? 2 : 1;
    for (const d of drugs) {
      const key = (d.insuranceCode && d.insuranceCode.length === 9 ? `c:${d.insuranceCode}` : `n:${d.productName}`).toLowerCase();
      const existing = counter.get(key);
      if (existing) existing.weight += weight;
      else counter.set(key, { drug: d, weight });
    }
  }
  const frequent = Array.from(counter.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((x) => x.drug);

  return NextResponse.json({ lastMonth, frequent });
}
