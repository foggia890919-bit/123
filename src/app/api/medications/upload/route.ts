import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { normalizeCompanyKey, normalizeProductKey } from "@/lib/utils";

function normalizeCode(code: string): string {
  return code.replace(/[\s\-]/g, "").toUpperCase();
}

// ───────── 요율표 헤더/열 자동 인식 (요율표 비교 도구와 동일 알고리즘) ─────────
// 법인마다 엑셀 양식이 달라도(메디펄스/서원파마 등) 헤더 행과 각 열을 점수로 추정한다.
const HEADER_KEYS = ["보험코드", "급여코드", "제약사", "제약회사", "제품명", "품목명", "약가", "수수료율", "요율", "성분", "분류", "코드", "회사", "정산"];

function scoreHeaderRow(row: (string | number)[]): number {
  let s = 0;
  for (const cell of row) {
    const t = String(cell ?? "").replace(/\s/g, "");
    if (HEADER_KEYS.some((k) => t.includes(k))) s++;
  }
  return s;
}

// 제목줄(예: 0행 "요율표")을 건너뛰고 실제 헤더 행 index를 찾는다.
function detectHeaderRow(rows: (string | number)[][]): number {
  let best = 0, bi = 0;
  const lim = Math.min(rows.length, 20);
  for (let i = 0; i < lim; i++) {
    const sc = scoreHeaderRow(rows[i] || []);
    if (sc > best) { best = sc; bi = i; }
  }
  return bi;
}

type ColKind = "code" | "comp" | "prod" | "price" | "rate" | "note" | "ingredient" | "categoryA" | "bio" | "original";

// 각 필드에 가장 잘 맞는 열 index를 유의어 점수로 고른다. (없으면 -1)
function pickCol(header: string[], kind: ColKind): number {
  let best = -1, bestScore = 0;
  header.forEach((h, i) => {
    const t = String(h ?? "").replace(/\s/g, "");
    if (!t) return;
    let sc = 0;
    if (kind === "code") {
      if (t === "보험코드" || t === "급여코드") sc = 100;
      else if (t.includes("보험") && t.includes("코드")) sc = 90;
      else if (t.includes("급여") && t.includes("코드")) sc = 88;
      else if (t === "약품코드" || t === "청구코드") sc = 85;
      else if (/EDI/i.test(t)) sc = 70;
    } else if (kind === "comp") {
      if (t.includes("제약회사")) sc = 100;
      else if (t.includes("제약사")) sc = 98;
      else if (t === "회사명" || t === "업체명" || t === "공급사") sc = 70;
      else if (t.includes("제조사")) sc = 30; // 위탁사일 수 있어 낮게
      else if (t.includes("회사")) sc = 50;
    } else if (kind === "prod") {
      if (t.includes("품목명")) sc = 100;
      else if (t.includes("제품명")) sc = 98;
      else if (t === "품명" || t === "약품명") sc = 80;
      else if (t.includes("품목")) sc = 60;
    } else if (kind === "price") {
      if (t === "약가") sc = 100;
      else if (t.includes("약가") && !/[xX*]/.test(t)) sc = 80;
      else if (t.includes("상한가")) sc = 70;
    } else if (kind === "rate") {
      if (t === "수수료율") sc = 100;
      else if (t === "요율") sc = 98;
      else if (t.includes("수수료") && !/[xX*]|약가/.test(t)) sc = 80;
      else if (t.includes("요율")) sc = 75;
      else if (t === "코드") sc = 55; // 메디펄스: '코드' 열이 요율값
      else if (t.includes("정산율") || t.includes("지급율")) sc = 70;
    } else if (kind === "note") {
      if (t.includes("특이사항")) sc = 100;
      else if (t === "비고") sc = 95;
      else if (t.includes("참고")) sc = 90;
      else if (t.includes("비고")) sc = 85;
      else if (t.includes("메모") || t.includes("설명") || t.includes("변동") || t.includes("이력")) sc = 70;
      else if (/note|remark/i.test(t)) sc = 60;
    } else if (kind === "ingredient") {
      if (t.includes("성분명")) sc = 100;
      else if (t === "성분") sc = 80;
      else if (t.includes("성분")) sc = 60;
    } else if (kind === "categoryA") {
      if (t === "분류(A)" || t === "분류A") sc = 100;
      else if (t.includes("분류") && /A/i.test(t)) sc = 90;
      else if (t.includes("분류") && !/B/i.test(t)) sc = 50;
    } else if (kind === "bio") {
      if (t.includes("생동")) sc = 100;
      else if (t.includes("생산")) sc = 60;
    } else if (kind === "original") {
      if (t.includes("오리지날") || t.includes("오리지널") || t.includes("대조약")) sc = 100;
    }
    if (sc > bestScore) { bestScore = sc; best = i; }
  });
  return best;
}

// "50%", "0.5", 46.2 등 → 숫자. (요율 0~1 변환은 호출부에서 처리)
function numOr(v: string | number | undefined | null): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[%,\s]/g, "");
  if (s === "") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const isSettlement = formData.get("isSettlement") === "true";
    const settlementTypeRaw = (formData.get("settlementType") as string | null)?.trim() || null;
    const settlementType = settlementTypeRaw === "원외" || settlementTypeRaw === "원내" ? settlementTypeRaw : null;

    if (!file) return NextResponse.json({ error: "파일이 없어요." }, { status: 400 });
    if (isSettlement && !settlementType) {
      return NextResponse.json({ error: "정산 분류(원외/원내)를 선택해주세요." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    // 헤더 행 자동 탐지 + 열 자동 매핑 (고정 컬럼명이 아니라 양식 무관 인식)
    const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: "" });
    const headerRowIdx = detectHeaderRow(aoa);
    const header = (aoa[headerRowIdx] || []).map((x) => String(x ?? "").trim());
    const dataRows = aoa.slice(headerRowIdx + 1);
    const col = {
      code: pickCol(header, "code"),
      comp: pickCol(header, "comp"),
      prod: pickCol(header, "prod"),
      price: pickCol(header, "price"),
      rate: pickCol(header, "rate"),
      note: pickCol(header, "note"),
      ingredient: pickCol(header, "ingredient"),
      categoryA: pickCol(header, "categoryA"),
      bio: pickCol(header, "bio"),
      original: pickCol(header, "original"),
    };

    const cellAt = (row: (string | number)[], i: number) => (i >= 0 ? row[i] : undefined);
    const strAt = (row: (string | number)[], i: number) => String(cellAt(row, i) ?? "").trim();

    const rateRows = dataRows
      .filter((row) => Array.isArray(row) && (strAt(row, col.code) || strAt(row, col.ingredient) || strAt(row, col.prod)))
      .map((row) => {
        let commissionRate = numOr(cellAt(row, col.rate));
        if (commissionRate != null && commissionRate > 0 && commissionRate <= 1) commissionRate = commissionRate * 100; // 0.5 → 50%
        const price = numOr(cellAt(row, col.price));
        return {
          categoryA: strAt(row, col.categoryA) || null,
          ingredientName: strAt(row, col.ingredient),
          categoryB: null, // 요율표 분류B 무시 — ATC코드(ingredientCode)로 대체
          commissionRate,
          companyName: strAt(row, col.comp) || "미상",
          bioStatus: strAt(row, col.bio) || null,
          productName: strAt(row, col.prod),
          price: price != null ? Math.round(price) : null,
          originalDrug: strAt(row, col.original) || null,
          insuranceCode: strAt(row, col.code) || null,
          notes: strAt(row, col.note) || null,
          isSettlement,
          settlementType,
        };
      })
      .filter((m) => m.insuranceCode || (m.ingredientName && m.productName));

    if (rateRows.length === 0) {
      return NextResponse.json({ error: "유효한 데이터가 없어요. 컬럼명을 확인해주세요." }, { status: 400 });
    }

    // 보험코드 매칭: 양쪽 정규화(하이픈·공백 제거, 대문자화)해서 비교
    // DB에 '123-456' 으로 저장되고 엑셀에 '123456' 이어도 매칭되도록 raw SQL 사용
    const normalizedCodes = Array.from(
      new Set(
        rateRows
          .map((r) => r.insuranceCode)
          .filter(Boolean)
          .map((c) => normalizeCode(c as string))
      )
    );

    const existingByCode = new Map<string, string>(); // normalizedCode → id
    const existingPriceByCode = new Map<string, number | null>(); // normalizedCode → price

    if (normalizedCodes.length > 0) {
      // DB의 insuranceCode는 "A,B,C" 형태로 여러 EDI가 들어있을 수 있음
      // 각 코드를 분리·정규화(하이픈·공백·탭 제거, 대문자화)해서 엑셀 코드와 매칭
      const rows = await prisma.$queryRaw<{ id: string; matched: string; price: number | null }[]>`
        SELECT m.id, m.price,
               UPPER(REPLACE(REPLACE(REPLACE(TRIM(code), '-', ''), ' ', ''), E'\t', '')) AS matched
        FROM "Medication" m,
             UNNEST(string_to_array(m."insuranceCode", ',')) AS code
        WHERE m."insuranceCode" IS NOT NULL
          AND UPPER(REPLACE(REPLACE(REPLACE(TRIM(code), '-', ''), ' ', ''), E'\t', '')) = ANY(${normalizedCodes})
      `;
      // 같은 코드가 여러 레코드에 매칭되면 첫 번째 것 사용
      rows.forEach((r) => {
        if (!existingByCode.has(r.matched)) {
          existingByCode.set(r.matched, r.id);
          existingPriceByCode.set(r.matched, r.price ?? null);
        }
      });
    }

    // 2차 매칭 후보: 1차에서 못 잡은 행들의 productName 으로 기존 레코드 검색.
    // PUBLIC_API source 의 비급여 약(insuranceCode=NULL) 과 요율표 행을 (productName + companyName)
    // 정규화 키로 머지 — 중복 EXCEL 레코드 양산 방지.
    const orphanRows = rateRows.filter((r) => {
      if (!r.productName || !r.companyName) return false;
      const ck = r.insuranceCode ? normalizeCode(r.insuranceCode) : null;
      return !ck || !existingByCode.has(ck);
    });
    const orphanProductNames = Array.from(new Set(orphanRows.map((r) => r.productName).filter(Boolean)));
    const productCandidates = orphanProductNames.length > 0
      ? await prisma.medication.findMany({
          where: { productName: { in: orphanProductNames } },
          select: { id: true, productName: true, companyName: true, insuranceCode: true, price: true },
        })
      : [];
    const nameKeyMap = new Map<string, { id: string; insuranceCode: string | null; price: number | null }>();
    for (const c of productCandidates) {
      const key = `${normalizeProductKey(c.productName)}|${normalizeCompanyKey(c.companyName)}`;
      if (key === "|") continue;
      if (!nameKeyMap.has(key)) nameKeyMap.set(key, { id: c.id, insuranceCode: c.insuranceCode, price: c.price });
    }

    let updated = 0;
    let mergedByName = 0;
    const toCreate: typeof rateRows = [];
    const skippedItems: { code: string; productName: string; companyName: string }[] = [];

    for (const row of rateRows) {
      const codeKey = row.insuranceCode ? normalizeCode(row.insuranceCode) : null;
      const idByCode = codeKey ? existingByCode.get(codeKey) : undefined;

      // 매칭 결정: 1순위 insuranceCode, 2순위 productName+companyName
      let matchedId: string | undefined = idByCode;
      let matchedExistingPrice: number | null = null;
      let matchedExistingInsuranceCode: string | null = null;
      let viaNameFallback = false;
      if (matchedId) {
        matchedExistingPrice = existingPriceByCode.get(codeKey!) ?? null;
      } else if (row.productName && row.companyName) {
        const compositeKey = `${normalizeProductKey(row.productName)}|${normalizeCompanyKey(row.companyName)}`;
        if (compositeKey !== "|") {
          const cand = nameKeyMap.get(compositeKey);
          if (cand) {
            matchedId = cand.id;
            matchedExistingPrice = cand.price;
            matchedExistingInsuranceCode = cand.insuranceCode;
            viaNameFallback = true;
          }
        }
      }

      if (matchedId) {
        const updateData: Record<string, unknown> = {
          commissionRate: row.commissionRate,
          isSettlement,
          settlementType,
          updatedAt: new Date(),
        };
        if (row.bioStatus) updateData.bioStatus = row.bioStatus;
        if (row.originalDrug) updateData.originalDrug = row.originalDrug;
        if (row.notes) updateData.notes = row.notes;
        if (row.categoryA) updateData.categoryA = row.categoryA;
        // 약가: 기존 NULL 일 때만 요율표 약가 채움 (공공데이터 약가 우선)
        if (row.price != null && matchedExistingPrice === null) {
          updateData.price = row.price;
        }
        // 이름 fallback 으로 매칭됐고 기존 레코드의 insuranceCode 가 NULL 이면 backfill
        if (viaNameFallback && !matchedExistingInsuranceCode && row.insuranceCode) {
          updateData.insuranceCode = row.insuranceCode;
        }
        await prisma.medication.update({ where: { id: matchedId }, data: updateData });
        updated++;
        if (viaNameFallback) mergedByName++;
        continue;
      }

      // 둘 다 미매칭
      if (row.productName && row.ingredientName) {
        toCreate.push(row);
      } else {
        skippedItems.push({
          code: row.insuranceCode ?? "",
          productName: row.productName,
          companyName: row.companyName,
        });
      }
    }

    let created = 0;
    const BATCH = 500;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const batch = toCreate.slice(i, i + BATCH).map((r) => ({
        ...r,
        source: "EXCEL" as const,
        updatedAt: new Date(),
      }));
      await prisma.medication.createMany({ data: batch });
      created += batch.length;
    }

    // isSettlement=true 요율표라면 PUBLIC_API 레코드에도 동일하게 머지
    // (공공데이터 sync 전에 업로드한 경우 등 이전에 스킵된 코드까지 커버)
    let merged = 0;
    if (isSettlement && settlementType) {
      const normalizedCodes = Array.from(
        new Set(
          rateRows
            .map((r) => r.insuranceCode)
            .filter(Boolean)
            .map((c) => c!.replace(/[\s\-]/g, "").toUpperCase())
        )
      );

      if (normalizedCodes.length > 0) {
        const MCHUNK = 200;
        for (let i = 0; i < normalizedCodes.length; i += MCHUNK) {
          const slice = normalizedCodes.slice(i, i + MCHUNK);
          // 각 정규화 코드에 해당하는 EXCEL 레코드의 수수료율 찾기
          const rateByCode = new Map<string, number | null>();
          for (const row of rateRows) {
            if (!row.insuranceCode) continue;
            const norm = row.insuranceCode.replace(/[\s\-]/g, "").toUpperCase();
            if (slice.includes(norm)) rateByCode.set(norm, row.commissionRate);
          }

          const params: unknown[] = [isSettlement, settlementType];
          const codeList = slice.map((_, idx) => `$${idx + 3}`).join(", ");
          const result = await prisma.$executeRawUnsafe(
            `UPDATE "Medication"
             SET "isSettlement" = $1,
                 "settlementType" = $2,
                 "updatedAt" = NOW()
             WHERE source = 'PUBLIC_API'
               AND "insuranceCode" IS NOT NULL
               AND EXISTS (
                 SELECT 1
                 FROM UNNEST(string_to_array("insuranceCode", ',')) AS raw_code
                 WHERE UPPER(REPLACE(REPLACE(TRIM(raw_code), '-', ''), ' ', '')) = ANY(ARRAY[${codeList}]::text[])
               )`,
            ...params, ...slice
          );
          merged += Number(result);
        }
      }
    }

    return NextResponse.json({
      success: true,
      count: rateRows.length,
      updated,
      mergedByName, // 이름+제약사 fallback 으로 머지된 건수 (보험코드 NULL 비급여 약 흡수)
      created,
      merged,
      skipped: skippedItems.length,
      skippedItems: skippedItems.length > 0 ? skippedItems : undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `업로드 오류: ${msg}` }, { status: 500 });
  }
}
