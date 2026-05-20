import { NextRequest, NextResponse } from "next/server";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { extractRxStatsFromImage } from "@/lib/gemini-rx-stats-extract";
import { appendRxStats } from "@/lib/google-sheets-rx-append";
import { assertSafePublicUrl } from "@/lib/url-safety";

export const runtime = "nodejs";
// gemini-3.5-flash 단일 호출 + thinkingBudget=-1. 35행+ 사진 worst case 30s 내외.
export const maxDuration = 90;

const MAX_IMAGE_BYTES = 10_000_000;
const FETCH_TIMEOUT_MS = 20_000;

function guessMimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":  return "image/png";
    case "gif":  return "image/gif";
    case "bmp":  return "image/bmp";
    case "tiff":
    case "tif":  return "image/tiff";
    case "webp": return "image/webp";
    default:     return "image/jpeg";
  }
}

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  let base64: string;
  let mimeType: string;
  let source: "manual" | "api";

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("image");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "image 필드가 누락됐습니다" }, { status: 400 });
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "이미지가 10MB 를 넘습니다" }, { status: 400 });
      }
      base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      mimeType = file.type || guessMimeFromName(file.name);
      source = "manual";
    } else {
      const body = await req.json() as { imageUrl?: string; mimeType?: string };
      if (!body.imageUrl) {
        return NextResponse.json({ error: "imageUrl 누락" }, { status: 400 });
      }
      let safe: URL;
      try {
        safe = assertSafePublicUrl(body.imageUrl);
      } catch (e) {
        return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 400 });
      }
      const r = await fetch(safe.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!r.ok) {
        return NextResponse.json({ error: `이미지 다운로드 실패 (${r.status})` }, { status: 502 });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "이미지가 10MB 를 넘습니다" }, { status: 400 });
      }
      base64 = buf.toString("base64");
      mimeType = body.mimeType || r.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
      source = "api";
    }
  } catch (e) {
    return NextResponse.json({ error: `이미지 수신 실패: ${String(e).slice(0, 200)}` }, { status: 400 });
  }

  let extractResult;
  try {
    extractResult = await extractRxStatsFromImage(base64, mimeType);
  } catch (e) {
    return NextResponse.json({ error: `Gemini 추출 실패: ${String(e).slice(0, 200)}` }, { status: 502 });
  }
  const { data, debug } = extractResult;
  const debugOut = {
    durationMs: debug.durationMs,
    model: debug.model,
  };

  // 완전 빈손 — 사진이 처방통계 표가 아닐 가능성
  if (
    data.drugs.length === 0 &&
    data.summary.drugCount === 0 &&
    data.summary.totalAmountWon === 0
  ) {
    return NextResponse.json({
      success: false,
      error: "처방통계 표를 인식하지 못했어요. 처방통계 화면 사진이 맞는지 확인해주세요.",
      data,
      debug: debugOut,
    }, { status: 422 });
  }

  try {
    const sheet = await appendRxStats(data, source);
    return NextResponse.json({
      success: true,
      data,
      sheet: {
        url: sheet.spreadsheetUrl,
        summaryRange: sheet.summaryRange,
        drugsRange: sheet.drugsRange,
        batchId: sheet.batchId,
      },
      debug: debugOut,
    });
  } catch (e) {
    return NextResponse.json({
      success: true,
      data,
      sheet: null,
      sheetError: String(e).slice(0, 300),
      debug: debugOut,
    });
  }
}
