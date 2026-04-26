import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export const maxDuration = 300;

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;

// 건강보험심사평가원_약가기준정보조회서비스
const HIRA_PRICE_URL = "https://apis.data.go.kr/B551182/dgamtCrtInfoService1.2/getDgamtList";

interface HiraItem { [key: string]: string | undefined }

function extractPrice(item: HiraItem): number | null {
  // dgamtCrtInfoService1.2 필드 우선, 기존 필드 fallback
  const raw = item["상한가"] ?? item["mxPrc"] ?? item["상한금액"] ?? item["약가"] ?? item["prc"] ?? "";
  const n = parseInt(String(raw).replace(/,/g, ""));
  return isNaN(n) || n <= 0 ? null : n;
}

function extractCode(item: HiraItem): string | null {
  // dgamtCrtInfoService1.2: ediCode, 제품코드, itemCd 등
  const code = (
    item["ediCode"] ?? item["제품코드"] ?? item["itemCd"] ?? item["급여코드"] ?? item["품목기준코드"] ?? item["itemSeq"] ?? ""
  ).trim();
  return code || null;
}

// data.go.kr: serviceKey는 반드시 직접 append (URLSearchParams 사용 시 이중인코딩 발생)
function buildHiraUrl(pageNo: number, numOfRows = 1000): string {
  return `${HIRA_PRICE_URL}?serviceKey=${API_KEY}&pageNo=${pageNo}&numOfRows=${numOfRows}`;
}

async function fetchPage(pageNo: number): Promise<{ items: HiraItem[]; totalCount: number }> {
  const res = await fetch(buildHiraUrl(pageNo), { cache: "no-store" });
  const rawText = await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(`HIRA API ${res.status}: ${rawText.slice(0, 2000)}`);
  }

  // XML 파싱
  const totalCountMatch = rawText.match(/<totalCount>(\d+)<\/totalCount>/);
  const totalCount = totalCountMatch ? parseInt(totalCountMatch[1]) : 0;

  // item 블록 추출
  const itemBlocks = rawText.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  const items: HiraItem[] = itemBlocks.map((block) => {
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([^<]*)<\/${tag}>`));
      return m ? m[1].trim() : undefined;
    };
    return {
      ediCode: get("ediCode"),
      제품코드: get("itemCd") ?? get("제품코드"),
      상한가: get("mxPrc") ?? get("상한가") ?? get("상한금액"),
      mxPrc: get("mxPrc"),
      품목명: get("itemName") ?? get("품목명"),
      itemName: get("itemName"),
    } as HiraItem;
  });

  return { items, totalCount };
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const body = await req.json().catch(() => ({}));
  const maxPages = Math.min(parseInt(body?.maxPages) || 50, 200);

  // 디버그 모드: 원본 응답 전체 반환 (에러 포함)
  if (body?.debug) {
    const debugUrl = buildHiraUrl(1, 3);
    const res = await fetch(debugUrl, { cache: "no-store" });
    const rawText = await res.text().catch(() => "(응답 없음)");
    // 키 일부만 마스킹해서 확인 (앞 8자만 노출)
    const keyHint = API_KEY ? `${API_KEY.slice(0, 8)}...` : "(키 없음)";
    return NextResponse.json({
      debug: true,
      status: res.status,
      keyHint,
      rawResponse: rawText.slice(0, 5000),
    });
  }

  let filled = 0;
  let scanned = 0;
  let pageErrors = 0;

  try {
    // 1페이지로 totalCount 파악
    const first = await fetchPage(1);
    const totalCount = first.totalCount || 0;
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / 1000) : maxPages;
    const pagesToProcess = Math.min(totalPages, maxPages);

    async function processItems(items: HiraItem[]) {
      // 가격과 코드가 있는 항목만
      const priceMap = new Map<string, number>();
      for (const item of items) {
        const code = extractCode(item);
        const price = extractPrice(item);
        if (code && price) priceMap.set(code, price);
      }
      if (priceMap.size === 0) return;

      const codes = Array.from(priceMap.keys());

      // 해당 코드 중 price가 null인 것만 조회
      const targets = await prisma.medication.findMany({
        where: { insuranceCode: { in: codes }, price: null },
        select: { id: true, insuranceCode: true },
      });

      if (targets.length === 0) return;

      // 약가만 업데이트 (다른 필드 건드리지 않음)
      const CHUNK = 200;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const slice = targets.slice(i, i + CHUNK);
        const tuples: string[] = [];
        const params: (string | number)[] = [];
        let p = 1;
        for (const t of slice) {
          const price = priceMap.get(t.insuranceCode!);
          if (!price) continue;
          tuples.push(`($${p++}::text, $${p++}::int)`);
          params.push(t.id, price);
        }
        if (tuples.length === 0) continue;
        const sql = `
          UPDATE "Medication" AS m
          SET "price" = v.price, "updatedAt" = NOW()
          FROM (VALUES ${tuples.join(", ")}) AS v(id, price)
          WHERE m.id = v.id
        `;
        await prisma.$executeRawUnsafe(sql, ...params);
        filled += slice.length;
      }
      scanned += items.length;
    }

    await processItems(first.items);

    for (let p = 2; p <= pagesToProcess; p++) {
      try {
        const { items } = await fetchPage(p);
        await processItems(items);
      } catch {
        pageErrors++;
      }
    }

    // 처리 후 통계
    const [totalMeds, nullPriceMeds] = await Promise.all([
      prisma.medication.count(),
      prisma.medication.count({ where: { price: null } }),
    ]);

    return NextResponse.json({
      success: true,
      filled,
      scanned,
      pageErrors,
      pagesProcessed: pagesToProcess,
      totalMeds,
      nullPriceMeds,
      filledPriceMeds: totalMeds - nullPriceMeds,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      filled,
      scanned,
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const [totalMeds, nullPriceMeds, excelWithPrice, apiWithPrice] = await Promise.all([
    prisma.medication.count(),
    prisma.medication.count({ where: { price: null } }),
    prisma.medication.count({ where: { source: "EXCEL", price: { not: null } } }),
    prisma.medication.count({ where: { source: "PUBLIC_API", price: { not: null } } }),
  ]);

  return NextResponse.json({
    totalMeds,
    nullPriceMeds,
    hasPriceMeds: totalMeds - nullPriceMeds,
    excelWithPrice,
    apiWithPrice,
  });
}
