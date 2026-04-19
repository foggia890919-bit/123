import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
// 건강보험심사평가원_ATC코드 매핑 목록 API (3개 엔드포인트 중 첫번째)
const BASE_URL = "https://apis.data.go.kr/15118958/v1/uddi:efe7750b-59a5-4db3-aa90-b8974543d836";

interface AtcItem { [key: string]: string | undefined }

async function fetchPage(pageNo: number): Promise<{ items: AtcItem[]; totalCount: number }> {
  const url = new URL(BASE_URL);
  url.searchParams.set("serviceKey", API_KEY);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("type", "json");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}`);

  const json = await res.json();

  // data.go.kr 응답 형식 처리
  const body = json?.response?.body ?? json?.body ?? json;
  const rawItems = body?.items?.item ?? body?.items ?? [];
  const items: AtcItem[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const totalCount = parseInt(body?.totalCount ?? body?.total ?? "0");

  return { items, totalCount };
}

function extractCodes(item: AtcItem): { ingredientCode: string; productCode: string } | null {
  // 가능한 필드명 변형 처리
  const ingredientCode = (
    item["주성분코드"] ?? item["주성분_코드"] ?? item["ingdtCode"] ?? item["mainIngdtCode"] ?? ""
  ).trim();
  const productCode = (
    item["제품코드"] ?? item["제품_코드"] ?? item["itemCode"] ?? item["ediCode"] ?? ""
  ).trim();

  if (!ingredientCode || !productCode) return null;
  return { ingredientCode, productCode };
}

export async function POST() {
  try {
    const { items: firstItems, totalCount } = await fetchPage(1);

    if (totalCount === 0 || firstItems.length === 0) {
      // 첫 페이지 아이템으로 필드명 진단
      return NextResponse.json({
        error: "API에서 데이터를 가져오지 못했어요. 응답 형식을 확인해주세요.",
        debug: firstItems.slice(0, 1),
      }, { status: 502 });
    }

    const totalPages = Math.ceil(totalCount / 1000);

    // 전체 페이지 수집
    const allItems: AtcItem[] = [...firstItems];
    for (let page = 2; page <= totalPages; page++) {
      const { items } = await fetchPage(page);
      allItems.push(...items);
    }

    // 제품코드 → 주성분코드 맵 생성
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

    // DB 배치 업데이트
    const allCodes = Array.from(codeMap.keys());
    let updated = 0;
    const BATCH = 1000;

    for (let i = 0; i < allCodes.length; i += BATCH) {
      const batch = allCodes.slice(i, i + BATCH);
      const found = await prisma.medication.findMany({
        where: { insuranceCode: { in: batch } },
        select: { id: true, insuranceCode: true },
      });
      for (const med of found) {
        if (!med.insuranceCode) continue;
        const categoryB = codeMap.get(med.insuranceCode);
        if (!categoryB) continue;
        await prisma.medication.update({
          where: { id: med.id },
          data: { categoryB, updatedAt: new Date() },
        });
        updated++;
      }
    }

    return NextResponse.json({ success: true, total: totalCount, mapped: codeMap.size, updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  // 주성분코드 채워진 건수 조회
  const filled = await prisma.medication.count({ where: { categoryB: { not: null } } });
  const total = await prisma.medication.count();
  return NextResponse.json({ filled, total });
}
