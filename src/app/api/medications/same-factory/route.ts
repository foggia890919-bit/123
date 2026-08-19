import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeProductKey, normalizeCompanyKey } from "@/lib/utils";
import { buildRateMap } from "@/lib/rate-utils";
import { ensureBundleTable } from "@/lib/ensure-bundle-table";

// 동일제조소(식약처 의약품 묶음정보) 조회.
// 대상 품목이 속한 묶음 그룹 전체를 반환하고, 각 행을 우리 Medication과 정규화 품목명으로 조인해
// 약가/수수료를 부착한다. search 라우트와 동일하게 공개 GET (userId는 요율 부착용 쿼리파람).
const GEN_CURRENT_KEY = "bundleCurrentGen";
const LAST_SYNC_KEY = "lastBundleSync";

interface BundleRow {
  groupKey: string;
  manufacturerName: string | null;
  itemName: string | null;
  entpName: string | null;
  ingredientName: string | null;
  itemSeq: string | null;
  productKey: string | null;
}

interface MedInfo {
  id: string;
  productName: string;
  companyName: string;
  price: number | null;
  commissionRate: number | null;
  insuranceCode: string | null;
  paymentType: string | null;
  isSettlement: boolean;
}

const MED_SELECT = {
  id: true, productName: true, companyName: true, price: true,
  commissionRate: true, insuranceCode: true, paymentType: true, isSettlement: true,
} as const;

async function getSetting(key: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "SystemSetting" WHERE "key" = ${key}
  `.catch(() => [] as { value: string }[]);
  return rows[0]?.value ?? null;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** 정규화 키에서 용량 숫자 앞까지의 기본명 prefix (LIKE 폴백/2차 조인 후보 조회용) */
function baseNameOf(key: string): string | null {
  const m = key.match(/^[^0-9]+/);
  if (!m || m[0].length < 2) return null;
  return m[0];
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const productName = (sp.get("productName") || "").trim();
  const itemSeq = (sp.get("itemSeq") || "").trim();
  const userId = (sp.get("userId") || "").trim();
  if (!productName && !itemSeq) {
    return NextResponse.json({ error: "productName 또는 itemSeq가 필요해요." }, { status: 400 });
  }

  try {
    await ensureBundleTable();
    const [currentGen, lastSync] = [await getSetting(GEN_CURRENT_KEY), await getSetting(LAST_SYNC_KEY)];
    if (!currentGen) {
      return NextResponse.json({ rows: [], total: 0, synced: false, lastSync: null });
    }

    // 1) 대상 품목이 속한 행 찾기: itemSeq 정확 매칭 → 정규화 품목명 → prefix LIKE 폴백
    let targets: { groupKey: string }[] = [];
    if (itemSeq) {
      targets = await prisma.$queryRaw<{ groupKey: string }[]>`
        SELECT DISTINCT "groupKey" FROM "MfdsBundleItem"
        WHERE "generation" = ${currentGen} AND "itemSeq" = ${itemSeq}
      `;
    }
    const productKey = productName ? normalizeProductKey(productName) : "";
    if (targets.length === 0 && productKey) {
      targets = await prisma.$queryRaw<{ groupKey: string }[]>`
        SELECT DISTINCT "groupKey" FROM "MfdsBundleItem"
        WHERE "generation" = ${currentGen} AND "productKey" = ${productKey}
      `;
    }
    if (targets.length === 0 && productKey) {
      const base = baseNameOf(productKey);
      if (base) {
        targets = await prisma.$queryRaw<{ groupKey: string }[]>`
          SELECT DISTINCT "groupKey" FROM "MfdsBundleItem"
          WHERE "generation" = ${currentGen} AND "productKey" LIKE ${escapeLike(base) + "%"}
          LIMIT 20
        `;
      }
    }

    const groupKeys = Array.from(new Set(targets.map((t) => t.groupKey))).filter((g) => !g.startsWith("UNKNOWN:"));
    if (groupKeys.length === 0) {
      return NextResponse.json({ rows: [], total: 0, synced: true, lastSync });
    }

    // 2) 그룹 전체 행 조회
    const placeholders = groupKeys.map((_, i) => `$${i + 2}`).join(", ");
    const rows = await prisma.$queryRawUnsafe<BundleRow[]>(
      `SELECT "groupKey", "manufacturerName", "itemName", "entpName", "ingredientName", "itemSeq", "productKey"
       FROM "MfdsBundleItem"
       WHERE "generation" = $1 AND "groupKey" IN (${placeholders})
       ORDER BY "manufacturerName" NULLS LAST, "itemName"
       LIMIT 1000`,
      currentGen,
      ...groupKeys
    );

    // 3) Medication 조인 — pass 1: 품목명 정확 일치, pass 2: 기본명 startsWith 후보 + 정규화 키 비교
    const itemNames = Array.from(new Set(rows.map((r) => r.itemName).filter(Boolean))) as string[];
    const exactMeds = itemNames.length > 0
      ? await prisma.medication.findMany({ where: { productName: { in: itemNames } }, select: MED_SELECT })
      : [];
    const byExact = new Map<string, MedInfo>();
    const byNorm = new Map<string, MedInfo>();
    for (const m of exactMeds) {
      if (!byExact.has(m.productName)) byExact.set(m.productName, m);
      const nk = normalizeProductKey(m.productName);
      if (nk && !byNorm.has(nk)) byNorm.set(nk, m);
    }

    const unmatchedBases = Array.from(new Set(
      rows
        .filter((r) => r.itemName && !byExact.has(r.itemName) && !(r.productKey && byNorm.has(r.productKey)))
        .map((r) => (r.productKey ? baseNameOf(r.productKey) : null))
        .filter(Boolean)
    )).slice(0, 50) as string[];
    if (unmatchedBases.length > 0) {
      // 정규화 키는 소문자·공백제거라 원문 startsWith와 다를 수 있음 — itemName 원문 기본명도 함께 시도
      const rawBases = Array.from(new Set(
        rows
          .filter((r) => r.itemName && !byExact.has(r.itemName))
          .map((r) => {
            const m = (r.itemName as string).match(/^[^0-9(]+/);
            return m && m[0].trim().length >= 2 ? m[0].trim() : null;
          })
          .filter(Boolean)
      )).slice(0, 50) as string[];
      if (rawBases.length > 0) {
        const candidates = await prisma.medication.findMany({
          where: { OR: rawBases.map((b) => ({ productName: { startsWith: b } })) },
          select: MED_SELECT,
          take: 1000,
        });
        for (const m of candidates) {
          const nk = normalizeProductKey(m.productName);
          if (nk && !byNorm.has(nk)) byNorm.set(nk, m);
        }
      }
    }

    const rateMap = userId ? await buildRateMap(userId) : ({} as Record<string, number>);

    const result = rows.map((r) => {
      const med = (r.itemName && byExact.get(r.itemName)) || (r.productKey && byNorm.get(r.productKey)) || null;
      return {
        groupKey: r.groupKey,
        manufacturerName: r.manufacturerName,
        itemName: r.itemName,
        entpName: r.entpName,
        ingredientName: r.ingredientName,
        itemSeq: r.itemSeq,
        medication: med
          ? {
              id: med.id,
              price: med.price,
              commissionRate: med.commissionRate,
              additionalRate: rateMap[normalizeCompanyKey(med.companyName)] ?? null,
              insuranceCode: med.insuranceCode,
              paymentType: med.paymentType,
              isSettlement: med.isSettlement,
            }
          : null,
      };
    });

    return NextResponse.json({ rows: result, total: result.length, synced: true, lastSync });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
