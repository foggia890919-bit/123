import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 와이케이팜(파트너) 약가마스터 다리 — Medication(식약처+심평원 병합 완성본)을
// 파트너 카탈로그가 소비할 컴팩트 튜플로 반환.
// 파트너: GET {KMD_BRIDGE_URL}/api/medications/bridge-master?page=1&pageSize=15000
//         Authorization: Bearer {YK_BRIDGE_TOKEN}
//
// 응답: { ok, page, totalPages, total, rows }
//   rows[i] = 튜플 (필드 순서 고정 — 파트너 kmdMaster.ts 가 이 순서에 의존):
//     [0] productName      제품명            (string)
//     [1] companyName      업체명            (string)
//     [2] insuranceCode    보험코드(원본)     (string|null — 콤마 다중코드 가능)
//     [3] price            약가(상한금액)     (number|null)
//     [4] paymentType      급여구분          (string|null — "급여"/"비급여"/"선별급여"/"전액본인부담" 등)
//     [5] categoryA        전문/일반 구분     (string|null)
//     [6] ingredientName   주성분명          (string)
//     [7] ingredientCode   HIRA 주성분코드    (string|null)
//
// 크기 제한: Vercel 4.5MB. 43k 행이라 페이지네이션 필수(기본 15000/페이지).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const YK_BRIDGE_TOKEN = process.env.YK_BRIDGE_TOKEN;
const DEFAULT_PAGE_SIZE = 15000;
const MAX_PAGE_SIZE = 20000;

type MedRow = {
  productName: string;
  companyName: string;
  insuranceCode: string | null;
  price: number | null;
  paymentType: string | null;
  categoryA: string | null;
  ingredientName: string;
  ingredientCode: string | null;
};

type BridgeTuple = [
  string,        // productName
  string,        // companyName
  string | null, // insuranceCode (원본 콤마 문자열)
  number | null, // price
  string | null, // paymentType
  string | null, // categoryA
  string,        // ingredientName
  string | null  // ingredientCode
];

function authorize(req: NextRequest): NextResponse | null {
  // 토큰 미설정 시에도 반드시 거부 — 빈 토큰으로 인한 인증 우회 방지
  if (!YK_BRIDGE_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "YK_BRIDGE_TOKEN not configured" },
      { status: 503 }
    );
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${YK_BRIDGE_TOKEN}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const pageSize = clampInt(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const where = { productName: { not: "" } } as const;

  const total = await prisma.medication.count({ where });
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = clampInt(url.searchParams.get("page"), 1, 1, Math.max(1, totalPages));

  const meds = (await prisma.medication.findMany({
    where,
    select: {
      productName: true,
      companyName: true,
      insuranceCode: true,
      price: true,
      paymentType: true,
      categoryA: true,
      ingredientName: true,
      ingredientCode: true,
    },
    orderBy: { id: "asc" }, // 안정적 페이지네이션
    skip: (page - 1) * pageSize,
    take: pageSize,
  })) as MedRow[];

  const rows: BridgeTuple[] = meds.map((m) => [
    m.productName,
    m.companyName,
    m.insuranceCode ?? null,
    m.price ?? null,
    m.paymentType ?? null,
    m.categoryA ?? null,
    m.ingredientName,
    m.ingredientCode ?? null,
  ]);

  return NextResponse.json({ ok: true, page, totalPages, total, rows });
}

export async function GET(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  try {
    return await handle(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  try {
    return await handle(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
