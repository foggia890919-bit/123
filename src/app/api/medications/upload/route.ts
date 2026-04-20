import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

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

    // 보험코드 있는 것: 기존 레코드(PUBLIC_API) 수수료율 업데이트 시도
    const codes = rateRows.map((r) => r.insuranceCode).filter(Boolean) as string[];
    const existingMap = new Map<string, string>();

    if (codes.length > 0) {
      const existing = await prisma.medication.findMany({
        where: { insuranceCode: { in: codes } },
        select: { id: true, insuranceCode: true },
      });
      existing.forEach((e) => { if (e.insuranceCode) existingMap.set(e.insuranceCode, e.id); });
    }

    let updated = 0;
    const toCreate: typeof rateRows = [];

    for (const row of rateRows) {
      if (row.insuranceCode && existingMap.has(row.insuranceCode)) {
        // 기존 공공데이터 레코드에 수수료율 업데이트
        const updateData: Record<string, unknown> = {
          commissionRate: row.commissionRate,
          isSettlement,
          settlementType,
          updatedAt: new Date(),
        };
        // 엑셀에 추가 메타 있으면 보완 (공공데이터에 없는 정보)
        if (row.bioStatus) updateData.bioStatus = row.bioStatus;
        if (row.originalDrug) updateData.originalDrug = row.originalDrug;
        if (row.notes) updateData.notes = row.notes;
        if (row.categoryA) updateData.categoryA = row.categoryA;
        if (row.categoryB) updateData.categoryB = row.categoryB;
        await prisma.medication.update({ where: { id: existingMap.get(row.insuranceCode)! }, data: updateData });
        updated++;
      } else if (row.productName && row.ingredientName) {
        // 공공데이터 매칭 없고 품목명/성분명 있으면 EXCEL 레코드로 신규 생성
        toCreate.push(row);
      }
      // 보험코드만 있고 공공데이터에 없으면 스킵 (공공데이터 sync 후 재업로드 필요)
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

    const skipped = rateRows.length - updated - toCreate.length;
    return NextResponse.json({
      success: true,
      count: rateRows.length,
      updated,   // 공공데이터와 머지된 건수
      created,   // 새로 생성된 건수
      skipped,   // 보험코드만 있고 공공데이터 미매칭 (공공데이터 sync 후 재시도 필요)
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `업로드 오류: ${msg}` }, { status: 500 });
  }
}
