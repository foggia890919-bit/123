import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCompanyKey } from "@/lib/utils";
import { safeParseInt } from "@/lib/auth-guard";
import { buildRateMap } from "@/lib/rate-utils";

/**
 * HIRA 주성분코드 구조 (9자리 예: 641400ATR)
 *  - 6자리: 성분
 *  - 7자리: 성분 + 제형
 *  - 8자리: 성분 + 제형 + 단위
 *  - 9자리: 성분 + 제형 + 단위 + 용량 (완전일치)
 *
 * matchLevel:
 *  "exact"           — 9자리 완전일치 (동일 성분/제형/단위/용량)
 *  "same_form"       — 8자리 일치 (동일 성분/제형/단위, 용량만 다름)
 *  "same_ingredient" — 6자리 일치 (동일 성분, 제형/단위/용량 다름)
 *  "name_match"      — ingredientCode 미매핑, 성분명으로 포함된 약품
 */
type MatchLevel = "exact" | "same_form" | "same_ingredient" | "name_match";

function computeMatchLevel(
  recordCode: string | null,
  searchCode: string
): MatchLevel | null {
  if (!recordCode) return null;
  if (recordCode === searchCode) return "exact";
  // 8자리 prefix: 성분+제형+단위 일치, 용량(9번째 자리)만 다름
  if (
    searchCode.length >= 8 &&
    recordCode.length >= 8 &&
    recordCode.slice(0, 8) === searchCode.slice(0, 8)
  ) {
    return "same_form";
  }
  // 6자리 prefix: 성분만 일치
  if (
    searchCode.length >= 6 &&
    recordCode.length >= 6 &&
    recordCode.slice(0, 6) === searchCode.slice(0, 6)
  ) {
    return "same_ingredient";
  }
  return null;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const ingredientCodeParam = req.nextUrl.searchParams.get("ingredientCode")?.trim() || "";
  // ingredientName 힌트: ingredientCode 검색 시 null-코드 약품 포함을 위해 호출자가 전달
  const ingredientNameHint = req.nextUrl.searchParams.get("ingredientName")?.trim() || "";
  const settlementOnly = req.nextUrl.searchParams.get("settlement") === "true";
  const userId = req.nextUrl.searchParams.get("userId") || null;
  const page = safeParseInt(req.nextUrl.searchParams.get("page"), 1, 1, 10000);
  const limit = safeParseInt(req.nextUrl.searchParams.get("limit"), 50, 1, 1000);
  const ingredientOnly = req.nextUrl.searchParams.get("ingredientOnly") === "true";
  const companiesRaw = req.nextUrl.searchParams.get("companies") || "";
  const companyList = companiesRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const paymentType = req.nextUrl.searchParams.get("paymentType")?.trim() || "";
  // fast=true: 자동완성 전용 — productName 만 검색, count/stock 스킵
  const fast = req.nextUrl.searchParams.get("fast") === "true";

  if (!q && !ingredientCodeParam && companyList.length === 0) return NextResponse.json({ medications: [], total: 0 });

  // ingredientCode 검색: 6자리 성분 prefix로 동일성분 전체 조회 (정밀 매칭)
  // - 9자리 완전일치  → matchLevel "exact"
  // - 8자리 prefix 일치, 9번째 다름 → matchLevel "same_form"
  // - 6자리 prefix 일치, 7~9 다름 → matchLevel "same_ingredient"
  // ingredientCode가 null인 약품은 prefix 매칭 대상이 아니므로, ingredientName 힌트가
  // 있을 경우 OR 조건으로 포함시켜 누락 방지. matchLevel은 null로 표시됨.
  let ingredientCodeWhere: object = {};
  if (ingredientCodeParam && ingredientCodeParam.length >= 6) {
    const prefix6 = ingredientCodeParam.slice(0, 6);
    // DB에서 6자리 prefix로 필터 (PostgreSQL LIKE 인덱스 활용)
    // + ingredientCode가 null인 약품도 ingredientName 힌트로 포함 (코드 미매핑 약품 누락 방지)
    if (ingredientNameHint) {
      ingredientCodeWhere = {
        OR: [
          { ingredientCode: { startsWith: prefix6 } },
          {
            ingredientCode: null,
            ingredientName: { contains: ingredientNameHint, mode: "insensitive" as const },
          },
        ],
      };
    } else {
      ingredientCodeWhere = {
        ingredientCode: { startsWith: prefix6 },
      };
    }
  } else if (ingredientCodeParam) {
    // 6자리 미만이면 정확히 일치하는 것만
    ingredientCodeWhere = { ingredientCode: ingredientCodeParam };
  }

  const where = {
    AND: [
      settlementOnly ? { isSettlement: true } : {},
      companyList.length > 0 ? { companyName: { in: companyList } } : {},
      paymentType ? { paymentType } : {},
      ingredientCodeParam
        ? ingredientCodeWhere
        : q
          ? ingredientOnly
            ? { ingredientName: { contains: q, mode: "insensitive" as const } }
            : fast
              ? { productName: { contains: q, mode: "insensitive" as const } }
              : {
                  OR: [
                    { productName: { contains: q, mode: "insensitive" as const } },
                    { ingredientName: { contains: q, mode: "insensitive" as const } },
                    { companyName: { contains: q, mode: "insensitive" as const } },
                    { insuranceCode: { contains: q, mode: "insensitive" as const } },
                  ],
                }
          : {},
    ],
  };

  // 검색 + count + rateMap 동시 병렬 (기존: 검색+count 병렬 → rateMap 순차)
  const [medications, total, rateMap] = await Promise.all([
    prisma.medication.findMany({
      where,
      orderBy: [{ isSettlement: "desc" }, { commissionRate: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      ...(fast ? {
        select: {
          id: true, insuranceCode: true, productName: true, companyName: true,
          ingredientCode: true, ingredientName: true,
          price: true, commissionRate: true, isSettlement: true,
        },
      } : {}),
    }),
    // count 는 첫 페이지만 (페이지 2+ 면 이미 total 알고 있음). fast 모드 skip.
    fast || page > 1 ? Promise.resolve(-1) : prisma.medication.count({ where }),
    userId ? buildRateMap(userId) : Promise.resolve({} as Record<string, number>),
  ]);

  const result = medications.map((med) => {
    let matchLevel: MatchLevel | null = null;
    if (ingredientCodeParam) {
      const level = computeMatchLevel(med.ingredientCode, ingredientCodeParam);
      if (level !== null) {
        matchLevel = level;
      } else if (!med.ingredientCode && ingredientNameHint) {
        // ingredientCode 미매핑 약품이 ingredientName 힌트로 포함된 경우
        matchLevel = "name_match";
      }
    }
    return {
      ...med,
      additionalRate: rateMap[normalizeCompanyKey(med.companyName)] ?? null,
      ...(matchLevel !== null ? { matchLevel } : {}),
    };
  }) as Array<
    typeof medications[number] & {
      additionalRate: number | null;
      stock?: number | null;
      stockScrapedAt?: string | null;
      matchLevel?: MatchLevel;
    }
  >;

  // ingredientCode 검색 시: exact → same_form → same_ingredient → name_match 순으로 정렬
  if (ingredientCodeParam) {
    const order: Record<string, number> = { exact: 0, same_form: 1, same_ingredient: 2, name_match: 3 };
    result.sort((a, b) => {
      const la = order[(a as { matchLevel?: string }).matchLevel ?? ""] ?? 4;
      const lb = order[(b as { matchLevel?: string }).matchLevel ?? ""] ?? 4;
      if (la !== lb) return la - lb;
      // 같은 matchLevel 내에서는 price 오름차순
      return (a.price ?? 999999999) - (b.price ?? 999999999);
    });
  }

  // 검색 결과에 InventorySnapshot 의 가장 최근 stock + scrapedAt 을 채워준다.
  // 사용자 요청: "기존에 가져왔던 재고를 검색 즉시 보여주고, 시점도 표시".
  // stock=0 도 그대로 (품절 표시). 시점은 화면에서 "N시간 전" 으로 표기하고
  // 4시간 초과면 빨갛게 강조 — 사용자가 신선도를 직접 판단할 수 있게 함.
  const insuranceCodes = result.map((m) => m.insuranceCode).filter((c): c is string => !!c);
  if (!fast && insuranceCodes.length > 0) {
    // 빠른 단순 쿼리 — UNIQUE (siteKey, insuranceCode) 덕분에 키별 1줄만 존재.
    // DISTINCT ON / ORDER BY 불필요 → planner 가 인덱스 만으로 즉시 조회.
    const rows = await prisma.$queryRaw<Array<{ insuranceCode: string; stock: number; scrapedAt: Date }>>`
      SELECT "insuranceCode",
             COALESCE("stock", 0)::int AS stock,
             "scrapedAt"
      FROM "InventorySnapshot"
      WHERE "insuranceCode" = ANY(${insuranceCodes}::text[])
        AND "siteKey" IN ('ibjp', 'family')
    `;
    const sumByCode = new Map<string, number>();
    const latestByCode = new Map<string, Date>();
    for (const r of rows) {
      sumByCode.set(r.insuranceCode, (sumByCode.get(r.insuranceCode) ?? 0) + Number(r.stock));
      const d = r.scrapedAt instanceof Date ? r.scrapedAt : new Date(r.scrapedAt);
      const prev = latestByCode.get(r.insuranceCode);
      if (!prev || d > prev) latestByCode.set(r.insuranceCode, d);
    }
    for (const m of result) {
      if (m.insuranceCode && sumByCode.has(m.insuranceCode)) {
        m.stock = sumByCode.get(m.insuranceCode)!;
        const latest = latestByCode.get(m.insuranceCode);
        if (latest) m.stockScrapedAt = latest.toISOString();
      }
    }
  }

  return NextResponse.json({ medications: result, total });
}
