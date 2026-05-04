import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  const params = req.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim();
  const priceCode = params.get("priceCode");
  const bizNumber = params.get("bizNumber");
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const size = Math.min(Math.max(Number(params.get("size") ?? params.get("limit") ?? 50), 1), 100);
  const skip = (page - 1) * size;

  if (bizNumber && user.role !== "ADMIN" && user.role !== "BIZ") {
    const allowed = await prisma.userClient.findFirst({
      where: { userId: user.id, bizNumber, approved: true },
      select: { id: true },
    });
    if (!allowed) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (priceCode) {
    const p = await prisma.epharmsProduct.findFirst({ where: { priceCode } });
    if (!p) return NextResponse.json({ products: [], total: 0, page: 1, size });
    return NextResponse.json({ products: [enrich(p)], total: 1, page: 1, size });
  }

  const where = q ? {
    active: true,
    OR: [
      { productName:  { contains: q, mode: "insensitive" as const } },
      { manufacturer: { contains: q, mode: "insensitive" as const } },
      { ingredient:   { contains: q, mode: "insensitive" as const } },
      { priceCode:    { contains: q } },
    ],
  } : { active: true };

  const [rows, total] = await Promise.all([
    prisma.epharmsProduct.findMany({ where, orderBy: [{ productName: "asc" }], skip, take: size }),
    prisma.epharmsProduct.count({ where }),
  ]);
  return NextResponse.json({ products: rows.map(enrich), total, page, size });
}

interface ProductRow {
  id: string; priceCode: string; productName: string; manufacturer: string;
  spec: string | null; productGroup: string | null; ingredient: string | null;
  basePrice: unknown;
}
function enrich(p: ProductRow) {
  return {
    id: p.id, priceCode: p.priceCode, productName: p.productName,
    manufacturer: p.manufacturer, spec: p.spec, productGroup: p.productGroup,
    ingredient: p.ingredient, basePrice: Number(p.basePrice),
  };
}
