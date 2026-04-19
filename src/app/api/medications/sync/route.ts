import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
const BASE_URL = "https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07";

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
  const body = json?.body;
  const rawItems = body?.items ?? [];
  const items: PublicDrug[] = Array.isArray(rawItems) ? rawItems : [rawItems];
  return { items, totalCount: parseInt(body?.totalCount ?? "0") };
}

function mapDrug(item: PublicDrug) {
  const ediRaw = (item.EDI_CODE ?? "").trim();
  const ediCodes = ediRaw ? ediRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const insuranceCode = ediCodes[0] || null;

  return {
    categoryA: (item.PRODUCT_TYPE ?? "").trim() || null,
    ingredientName: (item.ITEM_INGR_NAME ?? item.ITEM_NAME ?? "").trim(),
    categoryB: null as string | null, // 주성분코드는 ATC 동기화로만 채움
    companyName: (item.ENTP_NAME ?? "미상").trim(),
    productName: (item.ITEM_NAME ?? "").trim(),
    price: null as number | null,
    insuranceCode,
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
    const maxPages = testMode ? 1 : totalPages;

    let synced = 0;

    async function processPage(pageItems: PublicDrug[]) {
      const drugs = pageItems
        .map(mapDrug)
        .filter((d) => d.productName && d.ingredientName);

      const codes = drugs.map((d) => d.insuranceCode).filter(Boolean) as string[];

      const existing = await prisma.medication.findMany({
        where: { insuranceCode: { in: codes } },
        select: { id: true, insuranceCode: true, commissionRate: true },
      });
      const existingMap = new Map(existing.map((e) => [e.insuranceCode, e]));

      const toCreate: typeof drugs = [];
      const toUpdate: { id: string; data: Partial<ReturnType<typeof mapDrug>> }[] = [];

      for (const drug of drugs) {
        const found = drug.insuranceCode ? existingMap.get(drug.insuranceCode) : null;
        if (found) {
          toUpdate.push({
            id: found.id,
            data: {
              productName: drug.productName,
              ingredientName: drug.ingredientName,
              companyName: drug.companyName,
              categoryA: drug.categoryA,
              // categoryB는 ATC 동기화가 관리하므로 덮어쓰지 않음
              updatedAt: new Date(),
            },
          });
        } else {
          toCreate.push(drug);
        }
      }

      if (toCreate.length > 0) {
        await prisma.medication.createMany({ data: toCreate, skipDuplicates: true });
      }

      for (const { id, data } of toUpdate) {
        await prisma.medication.update({ where: { id }, data });
      }

      synced += drugs.length;
    }

    await processPage(firstItems);

    const CONCURRENT = 2;
    for (let page = 2; page <= maxPages; page += CONCURRENT) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(CONCURRENT, maxPages - page + 1) }, (_, i) =>
          fetchPage(page + i).then((r) => r.items)
        )
      );
      await Promise.all(batch.map(processPage));
    }

    const now = new Date().toISOString();
    const [publicCount, excelCount] = await Promise.all([
      prisma.medication.count({ where: { source: "PUBLIC_API" } }),
      prisma.medication.count({ where: { source: "EXCEL" } }),
      prisma.systemSetting.upsert({
        where: { key: "lastMfdsSync" },
        update: { value: now },
        create: { key: "lastMfdsSync", value: now },
      }),
    ]);
    return NextResponse.json({ success: true, synced, totalPublic: totalCount, publicCount, excelCount });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET() {
  const [publicCount, excelCount, lastSync] = await Promise.all([
    prisma.medication.count({ where: { source: "PUBLIC_API" } }),
    prisma.medication.count({ where: { source: "EXCEL" } }),
    prisma.systemSetting.findUnique({ where: { key: "lastMfdsSync" } }).catch(() => null),
  ]);
  return NextResponse.json({ publicCount, excelCount, total: publicCount + excelCount, lastSync: lastSync?.value ?? null });
}
