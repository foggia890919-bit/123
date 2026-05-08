import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { getViewableUserIds, buildChildCorpMap } from "@/lib/hierarchy";

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

  // 직속 하위에 BIZ가 있으면 상위법인 → 하위법인명으로 그룹핑
  const isUpperCorp = session.role !== "ADMIN" && (
    await prisma.user.count({ where: { parentUserId: session.id, role: "BIZ" } })
  ) > 0;

  const corpMap = isUpperCorp ? await buildChildCorpMap(session.id) : null;

  const reports = await prisma.prescriptionReport.findMany({
    where: { userId: viewableIds ? { in: viewableIds } : undefined, year },
    orderBy: [{ month: "asc" }],
    select: {
      id: true, year: true, month: true,
      userId: true, hospitalName: true, totalFee: true, ocrData: true,
    },
  });

  const crossKey = (h: string, c: string) => `${h}|||${c}`;
  const crossMap: Record<string, { hospitalName: string; companyName: string; months: number[] }> = {};

  const lineItems: Array<{
    hospitalName: string; companyName: string; productName: string;
    month: number; quantity: number; unitPrice: number; prescription: number; fee: number;
  }> = [];

  for (const r of reports) {
    // 상위법인이면 거래처 대신 하위법인명으로 대체
    const hospital = isUpperCorp
      ? (corpMap?.[r.userId] ?? "기타법인")
      : (r.hospitalName || "미입력");

    try {
      const ocd = r.ocrData as Record<string, unknown> | null;
      const drugs: FinalDrug[] = (ocd?.finalDrugs ?? ocd?.aiDrugs ?? []) as FinalDrug[];

      for (const d of drugs) {
        const company = d.companyName?.trim() || "기타";
        const product = isUpperCorp ? "-" : (d.productName?.trim() || "-");
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

  return NextResponse.json({ year, crossTab, lineItems, isUpperCorp });
}
