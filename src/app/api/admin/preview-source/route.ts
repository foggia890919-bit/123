import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "URL이 없어요." }, { status: 400 });

    // odcloud 스타일 또는 data.go.kr 스타일 모두 시도
    const testUrl = new URL(url);
    testUrl.searchParams.set("serviceKey", API_KEY);
    testUrl.searchParams.set("page", "1");
    testUrl.searchParams.set("perPage", "5");
    testUrl.searchParams.set("pageNo", "1");
    testUrl.searchParams.set("numOfRows", "5");
    testUrl.searchParams.set("type", "json");

    const res = await fetch(testUrl.toString(), { cache: "no-store" });
    const text = await res.text();

    let json: Record<string, unknown>;
    try { json = JSON.parse(text); } catch { return NextResponse.json({ error: `파싱 오류: ${text.slice(0, 200)}` }, { status: 400 }); }

    // odcloud 형식
    if (Array.isArray(json?.data) && (json.data as unknown[]).length > 0) {
      const sample = json.data as Record<string, unknown>[];
      return NextResponse.json({
        format: "odcloud",
        totalCount: json.totalCount ?? json.matchCount ?? 0,
        columns: Object.keys(sample[0]),
        sample: sample.slice(0, 3),
      });
    }

    // data.go.kr 형식
    const body = (json as Record<string, unknown>)?.response ?
      ((json as Record<string, unknown>).response as Record<string, unknown>)?.body :
      (json as Record<string, unknown>)?.body;
    if (body) {
      const rawItems = (body as Record<string, unknown>)?.items;
      const items = Array.isArray(rawItems) ? rawItems :
        Array.isArray((rawItems as Record<string, unknown>)?.item) ? (rawItems as Record<string, unknown>).item :
        rawItems ? [rawItems] : [];
      if ((items as unknown[]).length > 0) {
        const sample = items as Record<string, unknown>[];
        return NextResponse.json({
          format: "data.go.kr",
          totalCount: (body as Record<string, unknown>)?.totalCount ?? 0,
          columns: Object.keys(sample[0]),
          sample: sample.slice(0, 3),
        });
      }
    }

    return NextResponse.json({ error: "데이터를 찾지 못했어요.", raw: JSON.stringify(json).slice(0, 500) }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
