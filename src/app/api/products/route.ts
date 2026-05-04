// 상품 마스터 검색 — 영업사원 주문 작성 화면용.
//
//   GET /api/products?q=벤토린              → 이름/제약사/성분 fuzzy
//   GET /api/products?q=...&limit=30
//   GET /api/products?priceCode=645100741   → 단일 조회
//
// 결과에 거래처별 단가 추천(L1=매출원장, L2=ClientProductPrice)을 함께 포함하려면
// ?bizNumber=2110948285 같이 넘기면 된다.

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
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 30), 1), 100);

  // 영업사원이 본인 담당 거래처 외의 가격을 보면 안 되므로 권한 체크
  if (bizNumber && user.role !== "ADMIN" && user.role !== "BIZ") {
    const allowed = await prisma.userClient.findFirst({
      where: { userId: user.id, bizNumber, approved: true },
      select: { id: true },
    });
    if (!allowed) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (priceCode) {
    const p = await prisma.epharmsProduct.findUnique({ where: { priceCode } });
    if (!p) return NextResponse.json({ products: [] });
    return NextResponse.json({ products: [await enrich(p, bizNumber)] });
  }

  const where = q
    ? {
        active: true,
        OR: [
          { productName:  { contains: q, mode: "insensitive" as const } },
          { manufacturer: { contains: q, mode: "insensitive" as const } },
          { ingredient:   { contains: q, mode: "insensitive" as const } },
          { priceCode:    { contains: q } },
        ],
      }
    : { active: true };

  const products = await prisma.epharmsProduct.findMany({
    where,
    orderBy: [{ productName: "asc" }],
    take: limit,
  });

  const enriched = await Promise.all(products.map((p) => enrich(p, bizNumber)));
  return NextResponse.json({ products: enriched });
}

interface ProductRow {
  id: string;
  priceCode: string;
  productName: string;
  manufacturer: string;
  spec: string | null;
  productGroup: string | null;
  ingredient: string | null;
  basePrice: unknown;
}

async function enrich(p: ProductRow, bizNumber: string | null) {
  const base = {
    id: p.id,
    priceCode: p.priceCode,
    productName: p.productName,
    manufacturer: p.manufacturer,
    spec: p.spec,
    productGroup: p.productGroup,
    ingredient: p.ingredient,
    basePrice: Number(p.basePrice),
  };
  if (!bizNumber) return base;

  // L1: 매출원장에서 같은 거래처×상품의 최근 단가
  const ledgerHit = await prisma.ledgerEntry.findFirst({
    where: {
      bizNumber,
      itemName: { contains: p.productName },
      sales: { gt: 0 },
    },
    orderBy: { entryDate: "desc" },
    select: { entryDate: true, sales: true },
    // sales 컬럼은 단일 행 매출이라 단가가 아닐 수 있음 — 본격 매핑은 2-A에서.
  });

  // L2: 명시적으로 저장된 거래처 단가
  const stored = await prisma.clientProductPrice.findUnique({
    where: { bizNumber_priceCode: { bizNumber, priceCode: p.priceCode } },
    select: { unitPrice: true, source: true, setAt: true },
  });

  return {
    ...base,
    suggestedPrice: stored
      ? { value: Number(stored.unitPrice), source: stored.source, setAt: stored.setAt }
      : null,
    recentLedger: ledgerHit
      ? { entryDate: ledgerHit.entryDate, sales: Number(ledgerHit.sales) }
      : null,
  };
}
