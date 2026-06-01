import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { normalizeCompanyName } from "@/lib/company-name";
import { extractDeadlinesFromImage } from "@/lib/ai/gemini-deadline-extract";

export const maxDuration = 60;

// POST /api/admin/company-deadlines/ocr
// body: { image: base64dataURI, autoSave?: boolean }
export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const body = await req.json().catch(() => null);
  if (!body?.image || typeof body.image !== "string") {
    return NextResponse.json({ error: "image (base64 dataURI) 필수" }, { status: 400 });
  }

  const match = body.image.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) {
    return NextResponse.json({ error: "이미지 dataURI 파싱 실패" }, { status: 400 });
  }
  const mimeType = match[1];
  const base64 = match[2];

  try {
    const result = await extractDeadlinesFromImage(base64, mimeType);

    const autoSave = body.autoSave === true;
    const saved: Array<{ companyName: string; yearMonth: string; deadline: string }> = [];
    const errors: string[] = [];

    if (autoSave) {
      for (const row of result.rows) {
        try {
          const companyName = normalizeCompanyName(row.companyName);
          const deadline = new Date(row.deadline);
          if (!companyName || !row.yearMonth || Number.isNaN(deadline.getTime())) {
            errors.push(`${row.companyName ?? "?"}: 데이터 부족 (${row.rawText})`);
            continue;
          }
          await prisma.companyDeadline.upsert({
            where: { companyName_yearMonth: { companyName, yearMonth: row.yearMonth } },
            update: { deadline, source: "GEMINI_OCR", memo: row.rawText },
            create: { companyName, yearMonth: row.yearMonth, deadline, source: "GEMINI_OCR", memo: row.rawText },
          });
          saved.push({ companyName, yearMonth: row.yearMonth, deadline: deadline.toISOString() });
        } catch (err) {
          errors.push(`${row.companyName}: ${(err as Error).message}`);
        }
      }
    }

    return NextResponse.json({
      yearMonth: result.yearMonth,
      extractedRows: result.rows,
      saved,
      errors,
    });
  } catch (err) {
    console.error("[company-deadlines/ocr]", err);
    return NextResponse.json({ error: (err as Error).message ?? "OCR 실패" }, { status: 500 });
  }
}
