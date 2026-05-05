// 이팜스 상품 마스터 임포트.
// 두 가지 호출 경로:
//   1) 워커가 자동 다운로드 → multipart로 이 엔드포인트에 POST (Bearer WORKER_TOKEN)
//   2) BIZ 사용자가 엑셀 직접 업로드 (Cookie 세션 인증)
//
// xlsx 파싱 → 컬럼 자동 매핑 → EpharmsProduct upsert.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import * as XLSX from "xlsx";

// 컬럼명 → 필드 매핑 (한글 변형 대응)
const HEADER_MAP: Record<string, "priceCode" | "productName" | "manufacturer" | "spec" | "productGroup" | "ingredient" | "basePrice"> = {
  "기준단가코드": "priceCode",
  "보험코드": "priceCode",
  "상품코드": "priceCode",
  "코드": "priceCode",
  "상품명": "productName",
  "제품명": "productName",
  "품명": "productName",
  "제약사": "manufacturer",
  "제조사": "manufacturer",
  "메이커": "manufacturer",
  "규격": "spec",
  "포장": "spec",
  "상품그룹": "productGroup",
  "분류": "productGroup",
  "성분명": "ingredient",
  "성분": "ingredient",
  "단가": "basePrice",
  "기본단가": "basePrice",
  "가격": "basePrice",
};

interface ParsedRow {
  priceCode: string;
  productName: string;
  manufacturer: string;
  spec: string | null;
  productGroup: string | null;
  ingredient: string | null;
  basePrice: number;
}

function normalizeMoney(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.-]/g, "");
    if (!cleaned) return 0;
    const n = Number(cleaned);
    return isFinite(n) ? n : 0;
  }
  return 0;
}

async function isAuthorized(req: NextRequest): Promise<{ authed: true; triggeredBy: string | null } | NextResponse> {
  // 1) Worker (Bearer token)
  const auth = req.headers.get("authorization");
  if (auth) {
    const expected = process.env.WORKER_TOKEN;
    if (expected && auth === `Bearer ${expected}`) return { authed: true, triggeredBy: null };
    return NextResponse.json({ error: "invalid worker token" }, { status: 401 });
  }
  // 2) BIZ/ADMIN session
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return { authed: true, triggeredBy: user.id };
}

export async function POST(req: NextRequest) {
  const auth = await isAuthorized(req);
  if (auth instanceof NextResponse) return auth;

  let buffer: ArrayBuffer;
  let source = "excel-upload";
  try {
    const form = await req.formData();
    const file = form.get("file");
    const srcField = form.get("source");
    if (typeof srcField === "string") source = srcField;
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "file 필드(xlsx) 필수" }, { status: 400 });
    }
    buffer = await file.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "multipart/form-data 형식 필수" }, { status: 400 });
  }

  // 동기화 로그 시작
  const log = await prisma.productSyncLog.create({
    data: {
      triggeredBy: auth.triggeredBy,
      status: "running",
      source,
    },
  });

  try {
    const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error("xlsx 첫 시트가 비어있습니다");

    // 헤더 행 자동 감지 (첫 5행 이내에 한글 헤더 있는 행)
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(aoa.length, 5); i++) {
      const row = (aoa[i] ?? []).map((c) => String(c).trim());
      if (row.some((c) => HEADER_MAP[c])) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx < 0) {
      throw new Error("첫 5행에서 헤더(상품명/제약사/기준단가코드/단가 등)를 찾지 못했습니다");
    }

    const headers = (aoa[headerRowIdx] ?? []).map((c) => String(c).trim());
    const colIdx: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
      const f = HEADER_MAP[headers[i]];
      if (f && colIdx[f] === undefined) colIdx[f] = i;
    }

    const required = ["priceCode", "productName", "manufacturer"] as const;
    const missing = required.filter((f) => colIdx[f] === undefined);
    if (missing.length > 0) {
      throw new Error(`필수 컬럼 누락: ${missing.join(", ")}`);
    }

    // 데이터 행 파싱
    const parsed: ParsedRow[] = [];
    for (let i = headerRowIdx + 1; i < aoa.length; i++) {
      const row = aoa[i] ?? [];
      const priceCode = String(row[colIdx.priceCode] ?? "").trim();
      const productName = String(row[colIdx.productName] ?? "").trim();
      const manufacturer = String(row[colIdx.manufacturer] ?? "").trim();
      if (!priceCode || !productName || !manufacturer) continue;
      parsed.push({
        priceCode,
        productName,
        manufacturer,
        spec: colIdx.spec !== undefined ? String(row[colIdx.spec] ?? "").trim() || null : null,
        productGroup: colIdx.productGroup !== undefined ? String(row[colIdx.productGroup] ?? "").trim() || null : null,
        ingredient: colIdx.ingredient !== undefined ? String(row[colIdx.ingredient] ?? "").trim() || null : null,
        basePrice: colIdx.basePrice !== undefined ? normalizeMoney(row[colIdx.basePrice]) : 0,
      });
    }

    if (parsed.length === 0) throw new Error("파싱된 데이터 행이 0건입니다");

    // 청크 단위 upsert (대량 데이터 메모리 보호)
    const CHUNK = 200;
    let inserted = 0, updated = 0;
    for (let i = 0; i < parsed.length; i += CHUNK) {
      const slice = parsed.slice(i, i + CHUNK);
      for (const r of slice) {
        const existing = await prisma.epharmsProduct.findUnique({
          where: { priceCode: r.priceCode },
          select: { id: true },
        });
        if (existing) {
          await prisma.epharmsProduct.update({
            where: { priceCode: r.priceCode },
            data: {
              productName: r.productName,
              manufacturer: r.manufacturer,
              spec: r.spec,
              productGroup: r.productGroup,
              ingredient: r.ingredient,
              basePrice: r.basePrice,
              active: true,
              fetchedAt: new Date(),
            },
          });
          updated++;
        } else {
          await prisma.epharmsProduct.create({
            data: {
              priceCode: r.priceCode,
              productName: r.productName,
              manufacturer: r.manufacturer,
              spec: r.spec,
              productGroup: r.productGroup,
              ingredient: r.ingredient,
              basePrice: r.basePrice,
            },
          });
          inserted++;
        }
      }
    }

    await prisma.productSyncLog.update({
      where: { id: log.id },
      data: {
        status: "ok",
        finishedAt: new Date(),
        rowsTotal: parsed.length,
        rowsInserted: inserted,
        rowsUpdated: updated,
      },
    });

    return NextResponse.json({
      ok: true,
      total: parsed.length,
      inserted,
      updated,
      logId: log.id,
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await prisma.productSyncLog.update({
      where: { id: log.id },
      data: { status: "error", finishedAt: new Date(), errorMsg: msg },
    });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
