import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { normalizeCompanyKey, normalizeProductKey } from "@/lib/utils";

function normalizeCode(code: string): string {
  return code.replace(/[\s\-]/g, "").toUpperCase();
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
    const rawRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: "" });
    // 컬럼명 앞뒤 공백 제거 (Excel 헤더에 공백이 들어있는 경우 대비)
    const rows = rawRows.map((row) => {
      const normalized: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(row)) normalized[k.trim()] = v as string | number;
      return normalized;
    });

    const rateRows = rows
      .filter((row) => row["보험코드"] || row["급여코드"] || row["성분명"] || row["품목명"])
      .map((row) => {
        const insuranceCode = String(row["보험코드"] || row["급여코드"] || "").trim() || null;
        const commissionRaw = parseFloat(String(row["수수료율"] || row["코드"] || ""));
        const priceRaw = parseInt(String(row["약가"] || ""));
        return {
          categoryA: String(row["분류(A)"] || row["분류A"] || "").trim() || null,
          ingredientName: String(row["성분명"] || "").trim(),
          categoryB: null, // 요율표 분류B 무시 — ATC코드(ingredientCode)로 대체
          commissionRate: isNaN(commissionRaw) ? null : commissionRaw,
          companyName: String(row["제약사명"] || "").trim() || "미상",
          bioStatus: String(row["생동/생산"] || "").trim() || null,
          productName: String(row["품목명"] || "").trim(),
          price: isNaN(priceRaw) ? null : priceRaw,
          originalDrug: String(row["오리지날/대조약"] || "").trim() || null,
          insuranceCode,
          notes: String(row["특이사항"] || "").trim() || null,
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
