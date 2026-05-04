import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

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
  // 크론 내부 호출 허용
  const cronHeader = req.headers.get("x-cron-secret");
  const isCron = CRON_SECRET && cronHeader === CRON_SECRET;
  if (!isCron) {
    const guard = await requireAdmin();
    if (isNextResponse(guard)) return guard;
  }

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
      where: { companyName: { not: undefined } },
      select: { companyName: true },
      distinct: ["companyName"],
    });

    const companies = companiesRaw
      .map((c) => c.companyName!)
      .filter(Boolean);

    // 전체 HIRA 맵: mdsCd(LTRIM) → { price, payTpNm }
    // - leading-zero 정규화: HIRA mdsCd 가 "053..." 인 경우와 KMD 가 "053..." 또는 "53..." 인 경우 모두 매칭
    // - payTpNm: HIRA 가 알려주는 급여구분 ("급여"/"비급여"/"전액본인부담"/"선별급여" 등)
    const hiraMap = new Map<string, { price: number | null; payTpNm: string | null }>();

    async function processCompany(company: string): Promise<{ items: number; errors: number }> {
      const searchName = normalizeCompanyForSearch(company);
      if (!searchName) return { items: 0, errors: 0 };
      try {
        const first = await fetchHiraByCompany(searchName, 1);
        const pages = Math.ceil(first.totalCount / 1000);
        const allItems = [...first.items];
        for (let p = 2; p <= Math.min(pages, 5); p++) {
          const { items } = await fetchHiraByCompany(searchName, p);
          allItems.push(...items);
        }
        for (const item of allItems) {
          if (!item.mdsCd) continue;
          const normCode = item.mdsCd.replace(/^0+/, "");
          if (!normCode) continue;
          const priceNum = item.mxCprc ? parseInt(item.mxCprc.replace(/,/g, "")) : NaN;
          const price = !isNaN(priceNum) && priceNum > 0 ? priceNum : null;
          const payTpNm = item.payTpNm?.trim() || null;
          if (price === null && payTpNm === null) continue;
          hiraMap.set(normCode, { price, payTpNm });
        }
        return { items: allItems.length, errors: 0 };
      } catch {
        return { items: 0, errors: 1 };
      }
    }

    // 5개씩 병렬 처리
    const CONCURRENCY = 5;
    for (let i = 0; i < companies.length; i += CONCURRENCY) {
      const batch = companies.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(processCompany));
      for (const r of results) {
        if (r.status === "fulfilled") {
          scanned += r.value.items;
          companyErrors += r.value.errors;
        } else {
          companyErrors++;
        }
      }
    }

    if (hiraMap.size === 0) {
      return NextResponse.json({ success: false, error: "HIRA에서 가격 데이터를 가져오지 못했습니다.", scanned, companyErrors });
    }

    // DB 매칭: insuranceCode 콤마분리(UNNEST) + leading-zero 정규화(LTRIM) — HIRA 측 키와 동일 형태로 비교
    const codes = Array.from(hiraMap.keys());
    const targets = await prisma.$queryRaw<{ id: string; matched: string; price: number | null; paymentType: string | null }[]>`
      SELECT m.id, LTRIM(TRIM(code), '0') AS matched, m.price, m."paymentType"
      FROM "Medication" m,
           UNNEST(string_to_array(m."insuranceCode", ',')) AS code
      WHERE m."insuranceCode" IS NOT NULL
        AND LTRIM(TRIM(code), '0') = ANY(${codes})
    `;

    // 변경 필요한 약품만 수집 — price/paymentType 둘 다 변경 가능, 둘 중 하나만 바뀌어도 업데이트
    const updates = new Map<string, { price: number | null; payTpNm: string | null }>();
    for (const t of targets) {
      const entry = hiraMap.get(t.matched);
      if (!entry) continue;
      const priceChanged = entry.price !== null && t.price !== entry.price;
      const payTypeChanged = entry.payTpNm !== null && t.paymentType !== entry.payTpNm;
      if (!priceChanged && !payTypeChanged) continue;
      updates.set(t.id, {
        price: priceChanged ? entry.price : null,
        payTpNm: payTypeChanged ? entry.payTpNm : null,
      });
    }

    // bulk UPDATE — COALESCE 로 null 인 컬럼은 기존 값 유지 (변경된 컬럼만 적용)
    const CHUNK = 200;
    const ids = Array.from(updates.keys());
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const tuples: string[] = [];
      const params: (string | number | null)[] = [];
      let p = 1;
      for (const id of slice) {
        const u = updates.get(id)!;
        tuples.push(`($${p++}::text, $${p++}::int, $${p++}::text)`);
        params.push(id, u.price, u.payTpNm);
      }
      await prisma.$executeRawUnsafe(`
        UPDATE "Medication" AS m
        SET
          "price"       = COALESCE(v.price, m."price"),
          "paymentType" = COALESCE(v.payment_type, m."paymentType"),
          "updatedAt"   = NOW()
        FROM (VALUES ${tuples.join(", ")}) AS v(id, price, payment_type)
        WHERE m.id = v.id
      `, ...params);
      filled += slice.length;
    }

    const [totalMeds, nullPriceMeds, withPayType, nonReimbursed] = await Promise.all([
      prisma.medication.count(),
      prisma.medication.count({ where: { price: null } }),
      prisma.medication.count({ where: { paymentType: { not: null } } }),
      prisma.medication.count({ where: { paymentType: "비급여" } }),
    ]);

    return NextResponse.json({
      success: true,
      filled,
      scanned,
      companyErrors,
      companiesProcessed: companies.length,
      hiraMapSize: hiraMap.size,
      totalMeds,
      nullPriceMeds,
      withPaymentType: withPayType,
      nonReimbursedCount: nonReimbursed,
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
