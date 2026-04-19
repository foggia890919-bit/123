import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
const BASE_URL = "https://api.odcloud.kr/api/15118958/v1/uddi:6753c7f1-65ed-4bbe-9e98-cd6b7b156a92";

interface AtcItem { [key: string]: string | undefined }

async function fetchPage(page: number): Promise<{ items: AtcItem[]; totalCount: number }> {
  const url = new URL(BASE_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", "1000");
  url.searchParams.set("serviceKey", API_KEY);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const items: AtcItem[] = Array.isArray(json?.data) ? json.data : [];
  const totalCount = parseInt(json?.totalCount ?? json?.matchCount ?? "0");
  return { items, totalCount };
}

function extractCodes(item: AtcItem): { ingredientCode: string; productCode: string } | null {
  const ingredientCode = String(
    item["주성분코드"] ?? item["주성분_코드"] ?? item["ingdtCode"] ?? item["mainIngdtCode"] ?? ""
  ).trim();
  const productCode = String(
    item["제품코드"] ?? item["제품_코드"] ?? item["itemCode"] ?? item["ediCode"] ?? ""
  ).trim();
  if (!ingredientCode || !productCode) return null;
  return { ingredientCode, productCode };
}

export async function POST() {
  try {
    const { items: firstItems, totalCount } = await fetchPage(1);

    if (totalCount === 0 || firstItems.length === 0) {
      return NextResponse.json({
        error: "ATC API에서 데이터를 가져오지 못했어요.",
        sampleKeys: Object.keys(firstItems[0] ?? {}),
        sampleItem: firstItems[0] ?? null,
        totalCount,
      }, { status: 502 });
    }

    const totalPages = Math.ceil(totalCount / 1000);
    const allItems: AtcItem[] = [...firstItems];
    for (let page = 2; page <= totalPages; page++) {
      const { items } = await fetchPage(page);
      allItems.push(...items);
    }

    const codeMap = new Map<string, string>();
    for (const item of allItems) {
      const codes = extractCodes(item);
      if (codes) codeMap.set(codes.productCode, codes.ingredientCode);
    }

    if (codeMap.size === 0) {
      return NextResponse.json({
        error: "주성분코드/제품코드 필드를 찾지 못했어요.",
        sampleKeys: Object.keys(firstItems[0] ?? {}),
      }, { status: 400 });
    }

    // raw SQL로 배치 업데이트 (순차 update 대신 VALUES 테이블 조인)
    let updated = 0;
    const entries = Array.from(codeMap.entries());
    const BATCH = 500;

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      // VALUES (productCode, ingredientCode), ... 형태로 bulk update
      const values = batch.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2})`).join(", ");
      const params = batch.flatMap(([productCode, ingredientCode]) => [productCode, ingredientCode]);

      const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `UPDATE "Medication" AS m
         SET "categoryB" = v."categoryB", "updatedAt" = NOW()
         FROM (VALUES ${values}) AS v("insuranceCode", "categoryB")
         WHERE m."insuranceCode" = v."insuranceCode"
         RETURNING m.id`,
        ...params
      );
      updated += result.length;
    }

    // SystemSetting 테이블이 없어도 동기화는 성공으로 처리
    const now = new Date().toISOString();
    await prisma.systemSetting.upsert({
      where: { key: "lastAtcSync" },
      update: { value: now },
      create: { key: "lastAtcSync", value: now },
    }).catch(() => null);

    return NextResponse.json({ success: true, total: totalCount, mapped: codeMap.size, updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  const [filled, total, lastSync] = await Promise.all([
    prisma.medication.count({ where: { categoryB: { not: null } } }),
    prisma.medication.count(),
    prisma.systemSetting.findUnique({ where: { key: "lastAtcSync" } }).catch(() => null),
  ]);
  return NextResponse.json({ filled, total, lastSync: lastSync?.value ?? null });
}
