import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export const maxDuration = 300;

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;

// HIRA 급여 약가 마스터 (품목별 상한금액 포함)
const HIRA_PRICE_URL = "https://apis.data.go.kr/B551182/msuprdlstInfoService/getMsuPrdlstInfo";

interface HiraItem { [key: string]: string | undefined }

function extractPrice(item: HiraItem): number | null {
  const raw = item["상한금액"] ?? item["mxPrc"] ?? item["약가"] ?? item["prc"] ?? "";
  const n = parseInt(raw.replace(/,/g, ""));
  return isNaN(n) || n <= 0 ? null : n;
}

function extractCode(item: HiraItem): string | null {
  const code = (
    item["급여코드"] ?? item["ediCode"] ?? item["품목기준코드"] ?? item["itemSeq"] ?? ""
  ).trim();
  return code || null;
}

async function fetchPage(pageNo: number): Promise<{ items: HiraItem[]; totalCount: number }> {
  const url = new URL(HIRA_PRICE_URL);
  url.searchParams.set("serviceKey", API_KEY);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "1000");
  url.searchParams.set("type", "json");

  const res = await fetch(url.toString(), { cache: "no-store" });
  const rawText = await res.text().catch(() => "");

  if (!res.ok) {
    // 응답 내용 전체 반환 (디버깅용)
    throw new Error(`HIRA API ${res.status}: ${rawText.slice(0, 500)}`);
  }

  // JSON 파싱 시도
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`HIRA API JSON 파싱 실패: ${rawText.slice(0, 300)}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = json as any;

  // 응답 내 에러 코드 확인 (200이어도 오류 반환하는 경우)
  const errMsg = j?.response?.header?.resultMsg ?? j?.cmmMsgHeader?.errMsg;
  if (errMsg && String(errMsg).toLowerCase() !== "ok" && String(errMsg).toLowerCase() !== "정상") {
    throw new Error(`HIRA API 오류: ${errMsg} (원문: ${rawText.slice(0, 300)})`);
  }

  const body = j?.body ?? j?.response?.body ?? j;
  const rawItems = body?.items?.item ?? body?.items ?? body?.item ?? [];
  const items: HiraItem[] = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
  const totalCount = parseInt(String(body?.totalCount ?? body?.numOfRows ?? "0"));
  return { items, totalCount };
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const body = await req.json().catch(() => ({}));
  const maxPages = Math.min(parseInt(body?.maxPages) || 50, 200);

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
