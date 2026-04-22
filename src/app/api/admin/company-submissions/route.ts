import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 제약사별 제출처(담당자·연락처) 정보 관리
// 관리자 대시보드에서 사용

export async function GET() {
  try {
    const rows = await prisma.companySubmission.findMany({
      orderBy: { companyName: "asc" },
    });
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "조회 실패" },
      { status: 500 }
    );
  }
}

// Upsert by companyName (primary key)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const companyName = String(body?.companyName ?? "").trim();
    if (!companyName) {
      return NextResponse.json({ error: "제약사명 필수" }, { status: 400 });
    }
    const rawRate = body?.defaultAdditionalRate;
    const data = {
      submissionEntity: body?.submissionEntity?.trim() || null,
      contactName: body?.contactName?.trim() || null,
      email: body?.email?.trim() || null,
      phone: body?.phone?.trim() || null,
      fax: body?.fax?.trim() || null,
      defaultAdditionalRate: rawRate != null && rawRate !== "" ? Number(rawRate) : null,
      notes: body?.notes?.trim() || null,
    };
    const row = await prisma.companySubmission.upsert({
      where: { companyName },
      create: { companyName, ...data },
      update: data,
    });
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "저장 실패" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const companyName = String(body?.companyName ?? "").trim();
    if (!companyName) {
      return NextResponse.json({ error: "제약사명 필수" }, { status: 400 });
    }
    await prisma.companySubmission.delete({ where: { companyName } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "삭제 실패" },
      { status: 500 }
    );
  }
}
