import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { getViewableUserIds } from "@/lib/hierarchy";

interface FinalDrug {
  companyName?: string;
  productName?: string;
  quantity?: string;
  unitPrice?: number | null;
  commissionRate?: number | null;
  additionalRate?: number | null;
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const year = parseInt(
    req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  );

  const viewableIds = session.role === "ADMIN"
    ? undefined
    : await getViewableUserIds(session.id);

  const reports = await prisma.prescriptionReport.findMany({
    where: { userId: viewableIds ? { in: viewableIds } : undefined, year },
    orderBy: [{ month: "asc" }],
    select: {
      id: true, year: true, month: true,
      hospitalName: true, totalFee: true, ocrData: true,
    },
  });

  // 크로스탭: (hospital, company) → [12개 월별 처방금액]
  const crossKey = (h: string, c: string) => `${h}|||${c}`;
  const crossMap: Record<string, { hospitalName: string; companyName: string; months: number[] }> = {};

  // 라인 아이템: 개별 약품 내역
  const lineItems: Array<{
    hospitalName: string; companyName: string; productName: string;
    month: number; quantity: number; unitPrice: number; prescription: number; fee: number;
  }> = [];

  for (const r of reports) {
    const hospital = r.hospitalName || "미입력";
    try {
      const ocd = r.ocrData as Record<string, unknown> | null;
      const drugs: FinalDrug[] = (ocd?.finalDrugs ?? ocd?.aiDrugs ?? []) as FinalDrug[];

      for (const d of drugs) {
        const company = d.companyName?.trim() || "기타";
        const product = d.productName?.trim() || "-";
        const qty = parseFloat(d.quantity ?? "0") || 0;
        const price = d.unitPrice ?? 0;
        const ratePct = (d.commissionRate ?? 0) + (d.additionalRate ?? 0);
        const rx = qty * price;
        const fee = rx * ratePct / 100;

        // 크로스탭
        const k = crossKey(hospital, company);
        if (!crossMap[k]) {
          crossMap[k] = { hospitalName: hospital, companyName: company, months: Array(12).fill(0) };
        }
        crossMap[k].months[r.month - 1] += rx;

        // 라인아이템
        if (qty > 0 || price > 0) {
          lineItems.push({ hospitalName: hospital, companyName: company, productName: product, month: r.month, quantity: qty, unitPrice: price, prescription: rx, fee });
        }
      }
    } catch { /* ocrData 없는 레코드 */ }
  }

  const crossTab = Object.values(crossMap).sort((a, b) =>
    a.hospitalName.localeCompare(b.hospitalName) || a.companyName.localeCompare(b.companyName)
  );

  lineItems.sort((a, b) => a.month - b.month || a.hospitalName.localeCompare(b.hospitalName));

  return NextResponse.json({ year, crossTab, lineItems });
}
