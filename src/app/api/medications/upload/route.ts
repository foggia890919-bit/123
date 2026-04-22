import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

function normalizeCode(code: string): string {
  return code.replace(/[\s\-]/g, "").toUpperCase();
}

function normalizeProductKey(name: string, company: string): string {
  return `${name.trim().toLowerCase()}||${company.trim().toLowerCase()}`;
}

export async function POST(req: NextRequest) {
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
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: "" });

    const rateRows = rows
      .filter((row) => row["보험코드"] || row["급여코드"] || row["성분명"] || row["품목명"])
      .map((row) => {
        const insuranceCode = String(row["보험코드"] || row["급여코드"] || "").trim() || null;
        const commissionRaw = parseFloat(String(row["수수료율"] || row["코드"] || ""));
        const priceRaw = parseInt(String(row["약가"] || ""));
        return {
          categoryA: String(row["분류(A)"] || row["분류A"] || "").trim() || null,
          ingredientName: String(row["성분명"] || "").trim(),
          categoryB: String(row["분류(B)"] || row["분류B"] || "").trim() || null,
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

    // 1차 매칭: 보험코드(정규화) → 기존 레코드 id 맵
    const codes = rateRows.map((r) => r.insuranceCode).filter(Boolean) as string[];
    const existingByCode = new Map<string, string>(); // normalizedCode → id

    if (codes.length > 0) {
      const existing = await prisma.medication.findMany({
        where: { insuranceCode: { in: codes } },
        select: { id: true, insuranceCode: true },
      });
      existing.forEach((e) => {
        if (e.insuranceCode) existingByCode.set(normalizeCode(e.insuranceCode), e.id);
      });
    }

    // 2차 매칭 준비: 코드 미매칭 품목들의 productName+companyName으로 PUBLIC_API 레코드 조회
    const noCodeMatch = rateRows.filter((r) => {
      if (!r.insuranceCode) return r.productName && r.ingredientName;
      return !existingByCode.has(normalizeCode(r.insuranceCode));
    });

    const existingByProductKey = new Map<string, string>(); // productKey → id
    if (noCodeMatch.length > 0) {
      const nameConditions = noCodeMatch
        .filter((r) => r.productName && r.companyName)
        .map((r) => ({ productName: r.productName, companyName: r.companyName }));

      if (nameConditions.length > 0) {
        const fallbackRecords = await prisma.medication.findMany({
          where: {
            OR: nameConditions.map((c) => ({
              AND: [
                { productName: { equals: c.productName, mode: "insensitive" as const } },
                { companyName: { equals: c.companyName, mode: "insensitive" as const } },
              ],
            })),
          },
          select: { id: true, productName: true, companyName: true },
        });
        fallbackRecords.forEach((r) => {
          existingByProductKey.set(normalizeProductKey(r.productName, r.companyName), r.id);
        });
      }
    }

    let updated = 0;
    const toCreate: typeof rateRows = [];
    const skippedItems: { code: string; productName: string }[] = [];

    for (const row of rateRows) {
      // 1차: 보험코드 매칭
      const codeKey = row.insuranceCode ? normalizeCode(row.insuranceCode) : null;
      const idByCode = codeKey ? existingByCode.get(codeKey) : undefined;

      if (idByCode) {
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
        if (row.categoryB) updateData.categoryB = row.categoryB;
        await prisma.medication.update({ where: { id: idByCode }, data: updateData });
        updated++;
        continue;
      }

      // 2차: 품목명+제약사명 매칭
      const productKey = row.productName && row.companyName
        ? normalizeProductKey(row.productName, row.companyName)
        : null;
      const idByProduct = productKey ? existingByProductKey.get(productKey) : undefined;

      if (idByProduct) {
        const updateData: Record<string, unknown> = {
          commissionRate: row.commissionRate,
          isSettlement,
          settlementType,
          updatedAt: new Date(),
        };
        if (row.insuranceCode) updateData.insuranceCode = row.insuranceCode;
        if (row.bioStatus) updateData.bioStatus = row.bioStatus;
        if (row.originalDrug) updateData.originalDrug = row.originalDrug;
        if (row.notes) updateData.notes = row.notes;
        if (row.categoryA) updateData.categoryA = row.categoryA;
        if (row.categoryB) updateData.categoryB = row.categoryB;
        await prisma.medication.update({ where: { id: idByProduct }, data: updateData });
        updated++;
        continue;
      }

      // 매칭 없음: 품목명+성분명 있으면 신규 생성, 보험코드만 있으면 스킵
      if (row.productName && row.ingredientName) {
        toCreate.push(row);
      } else {
        skippedItems.push({
          code: row.insuranceCode ?? "",
          productName: row.productName,
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

    return NextResponse.json({
      success: true,
      count: rateRows.length,
      updated,
      created,
      skipped: skippedItems.length,
      skippedItems: skippedItems.length > 0 ? skippedItems : undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `업로드 오류: ${msg}` }, { status: 500 });
  }
}
