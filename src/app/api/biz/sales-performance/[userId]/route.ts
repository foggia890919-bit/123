import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

interface FinalDrug {
  companyName?: string;
  productName?: string;
  quantity?: string;
  unitPrice?: number | null;
  commissionRate?: number | null;
  additionalRate?: number | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await requireAdmin();
  if (isNextResponse(session)) return session;

  const { userId } = await params;
  const year = parseInt(
    req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear())
  );

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, salesCode: true },
  });
  if (!user) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const reports = await prisma.prescriptionReport.findMany({
    where: { userId, year },
    orderBy: [{ month: "asc" }],
    select: { id: true, month: true, hospitalName: true, totalFee: true, ocrData: true },
  });

  const crossKey = (h: string, c: string) => `${h}|||${c}`;
  const crossMap: Record<string, { hospitalName: string; companyName: string; months: number[] }> = {};

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

        const k = crossKey(hospital, company);
        if (!crossMap[k]) {
          crossMap[k] = { hospitalName: hospital, companyName: company, months: Array(12).fill(0) };
        }
        crossMap[k].months[r.month - 1] += rx;

        if (qty > 0 || price > 0) {
          lineItems.push({ hospitalName: hospital, companyName: company, productName: product, month: r.month, quantity: qty, unitPrice: price, prescription: rx, fee });
        }
      }
    } catch { /* skip */ }
  }

  const crossTab = Object.values(crossMap).sort((a, b) =>
    a.hospitalName.localeCompare(b.hospitalName) || a.companyName.localeCompare(b.companyName)
  );
  lineItems.sort((a, b) => a.month - b.month || a.hospitalName.localeCompare(b.hospitalName));

  return NextResponse.json({ year, user, crossTab, lineItems });
}
