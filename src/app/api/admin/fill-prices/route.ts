import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

export const maxDuration = 300;

const lambda = new LambdaClient({
  region: "ap-northeast-2",
  credentials: {
    accessKeyId: process.env.AWS_HIRA_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_HIRA_SECRET_ACCESS_KEY!,
  },
});

// Lambda(서울)를 통해 HIRA API 호출 (한국 IP 필요)
async function fetchHiraByCompany(
  mnfEntpNm: string,
  pageNo: number,
  numOfRows = 1000
): Promise<{ items: HiraItem[]; totalCount: number }> {
  const payload = JSON.stringify({ mnfEntpNm, pageNo, numOfRows });
  const cmd = new InvokeCommand({
    FunctionName: "hira-price-proxy",
    Payload: Buffer.from(payload),
  });
  const res = await lambda.send(cmd);
  const body = JSON.parse(Buffer.from(res.Payload!).toString());
  const xml: string = body.body ?? "";

  const totalCountMatch = xml.match(/<totalCount>(\d+)<\/totalCount>/);
  const totalCount = totalCountMatch ? parseInt(totalCountMatch[1]) : 0;

  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  const items: HiraItem[] = itemBlocks.map((block) => {
    const get = (tag: string) => block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim();
    return { mdsCd: get("mdsCd"), mxCprc: get("mxCprc"), payTpNm: get("payTpNm") };
  });

  return { items, totalCount };
}

interface HiraItem {
  mdsCd?: string;
  mxCprc?: string;
  payTpNm?: string;
}

// "(주)", "㈜", "주식회사" 제거해서 검색용 이름 추출
function normalizeCompanyForSearch(name: string): string {
  return name
    .replace(/주식회사\s*/g, "")
    .replace(/\s*\(주\)/g, "")
    .replace(/\s*㈜/g, "")
    .replace(/\s*\(유\)/g, "")
    .trim()
    .slice(0, 15); // HIRA API partial match
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const body = await req.json().catch(() => ({}));

  // 디버그: 특정 회사명으로 테스트
  if (body?.debug) {
    const testCompany = body.company ?? "한미약품";
    try {
      const result = await fetchHiraByCompany(testCompany, 1, 5);
      return NextResponse.json({ debug: true, company: testCompany, ...result });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  let filled = 0;
  let scanned = 0;
  let companyErrors = 0;

  try {
    // 약가 없는 약품의 고유 제약사 목록 조회
    const companiesRaw = await prisma.medication.findMany({
      where: { price: null, companyName: { not: null } },
      select: { companyName: true },
      distinct: ["companyName"],
    });

    const companies = companiesRaw
      .map((c) => c.companyName!)
      .filter(Boolean);

    // 전체 HIRA 가격 맵: mdsCd → price
    const priceMap = new Map<string, number>();

    for (const company of companies) {
      const searchName = normalizeCompanyForSearch(company);
      if (!searchName) continue;

      try {
        // 첫 페이지로 totalCount 파악
        const first = await fetchHiraByCompany(searchName, 1);
        const pages = Math.ceil(first.totalCount / 1000);
        const allItems = [...first.items];

        for (let p = 2; p <= Math.min(pages, 10); p++) {
          const { items } = await fetchHiraByCompany(searchName, p);
          allItems.push(...items);
        }

        scanned += allItems.length;

        for (const item of allItems) {
          if (!item.mdsCd || !item.mxCprc) continue;
          const price = parseInt(item.mxCprc.replace(/,/g, ""));
          if (!isNaN(price) && price > 0) {
            priceMap.set(item.mdsCd, price);
          }
        }
      } catch {
        companyErrors++;
      }
    }

    if (priceMap.size === 0) {
      return NextResponse.json({ success: false, error: "HIRA에서 가격 데이터를 가져오지 못했습니다.", scanned, companyErrors });
    }

    // DB에서 insuranceCode가 mdsCd와 일치하는 약품 조회 (price null인 것)
    const codes = Array.from(priceMap.keys());
    const targets = await prisma.medication.findMany({
      where: { insuranceCode: { in: codes }, price: null },
      select: { id: true, insuranceCode: true },
    });

    // 배치 업데이트
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
      await prisma.$executeRawUnsafe(`
        UPDATE "Medication" AS m
        SET "price" = v.price, "updatedAt" = NOW()
        FROM (VALUES ${tuples.join(", ")}) AS v(id, price)
        WHERE m.id = v.id
      `, ...params);
      filled += slice.length;
    }

    const [totalMeds, nullPriceMeds] = await Promise.all([
      prisma.medication.count(),
      prisma.medication.count({ where: { price: null } }),
    ]);

    return NextResponse.json({
      success: true,
      filled,
      scanned,
      companyErrors,
      companiesProcessed: companies.length,
      priceMapSize: priceMap.size,
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
