import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
// 건강보험심사평가원 요양급여 의약품 정보 API
// 엔드포인트가 다를 경우 아래 URL을 수정하세요
const BASE_URL = "https://apis.data.go.kr/B551182/prescDrugInfo1/getPrescDrugInfo1";

interface PublicDrug { [key: string]: string | undefined; }

async function fetchPage(pageNo: number): Promise<{ items: PublicDrug[]; totalCount: number }> {
  const url = new URL(BASE_URL);
  url.searchParams.set("serviceKey", API_KEY);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("type", "json");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => "")}`);

  const json = await res.json();
  const body = json?.response?.body;
  const rawItems = body?.items?.item ?? [];
  const items: PublicDrug[] = Array.isArray(rawItems) ? rawItems : [rawItems];
  return { items, totalCount: parseInt(body?.totalCount ?? "0") };
}

function mapDrug(item: PublicDrug) {
  const price = parseInt(item.MAX_PRICE ?? item.DRUG_PRICE ?? "");
  return {
    categoryA: (item.CLASS_NAME ?? item.MAIN_ITEM_INGR ?? "").trim() || null,
    ingredientName: (item.INGR_NAME_KOR ?? item.INGR_ENG_NAME ?? item.ITEM_NM ?? "").trim(),
    categoryB: (item.FORM_CODE_NAME ?? item.ETC_OTC_NAME ?? "").trim() || null,
    companyName: (item.ENTP_NAME ?? item.BIZRNO ?? "미상").trim(),
    productName: (item.ITEM_NM ?? "").trim(),
    price: isNaN(price) ? null : price,
    insuranceCode: (item.EDI_CODE ?? item.ITEM_SEQ ?? "").trim() || null,
    bioStatus: null as string | null,
    originalDrug: null as string | null,
    notes: null as string | null,
    isSettlement: false,
    commissionRate: null as number | null,
    source: "PUBLIC_API" as const,
    updatedAt: new Date(),
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const testMode = body?.mode === "test";

  try {
    const { items: firstItems, totalCount } = await fetchPage(1);
    if (totalCount === 0 || firstItems.length === 0) {
      return NextResponse.json({
        error: "공공 API에서 데이터를 가져오지 못했어요. API 키 또는 응답 형식을 확인해주세요.",
      }, { status: 502 });
    }

    const totalPages = Math.ceil(totalCount / 100);
    const maxPages = testMode ? 1 : Math.min(totalPages, 300); // 최대 30,000건

    let synced = 0;

    async function processPage(pageItems: PublicDrug[]) {
      const drugs = pageItems
        .map(mapDrug)
        .filter((d) => d.productName && d.ingredientName);

      const codes = drugs.map((d) => d.insuranceCode).filter(Boolean) as string[];

      // 기존 레코드 조회 (보험코드 기준)
      const existing = await prisma.medication.findMany({
        where: { insuranceCode: { in: codes } },
        select: { id: true, insuranceCode: true, commissionRate: true, isSettlement: true },
      });
      const existingMap = new Map(existing.map((e) => [e.insuranceCode, e]));

      const toCreate: typeof drugs = [];
      const toUpdate: { id: string; data: Partial<ReturnType<typeof mapDrug>> }[] = [];

      for (const drug of drugs) {
        const found = drug.insuranceCode ? existingMap.get(drug.insuranceCode) : null;
        if (found) {
          // 기존: 메타데이터만 업데이트, 수수료율 유지
          toUpdate.push({
            id: found.id,
            data: {
              productName: drug.productName,
              ingredientName: drug.ingredientName,
              companyName: drug.companyName,
              categoryA: drug.categoryA,
              price: drug.price,
              updatedAt: new Date(),
            },
          });
        } else {
          toCreate.push(drug);
        }
      }

      // 생성
      if (toCreate.length > 0) {
        await prisma.medication.createMany({ data: toCreate, skipDuplicates: false }).catch(() => null);
      }

      // 업데이트 (배치)
      await Promise.all(toUpdate.map(({ id, data }) =>
        prisma.medication.update({ where: { id }, data }).catch(() => null)
      ));

      synced += drugs.length;
    }

    // 첫 페이지 처리
    await processPage(firstItems);

    // 나머지 페이지 병렬 처리 (5개씩)
    const CONCURRENT = 5;
    for (let page = 2; page <= maxPages; page += CONCURRENT) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(CONCURRENT, maxPages - page + 1) }, (_, i) =>
          fetchPage(page + i).then((r) => r.items)
        )
      );
      await Promise.all(batch.map(processPage));
    }

    return NextResponse.json({ success: true, synced, totalPublic: totalCount });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  const [publicCount, excelCount] = await Promise.all([
    prisma.medication.count({ where: { source: "PUBLIC_API" } }),
    prisma.medication.count({ where: { source: "EXCEL" } }),
  ]);
  return NextResponse.json({ publicCount, excelCount, total: publicCount + excelCount });
}
