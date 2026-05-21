import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { extractStatsLikeFusion } from "@/lib/gemini-stats-fusion-adapter";

// 기존 Clova OCR + Document AI + Gemini Vision fusion 파이프라인은 폐기.
// gemini-3.5-flash 멀티모달이 사진을 통째로 읽어서 표 추출 → 마스터 매칭/수수료 보정만.
// 응답 JSON 형식은 stats/page.tsx 가 기대하는 기존 FusionResult 와 호환 유지.
//
// 변경 배경: 비스듬한 모니터 사진에서 Clova 의 Y 클러스터링이 깨져 행 매핑 한 칸씩 밀림 문제 빈발.
// 위치 기반 fusion 전부 제거 → LLM 이 사람처럼 표 구조 직접 파악.

export const runtime = "nodejs";
// Gemini 3.5 Flash + thinkingBudget=-1 worst case 대응. 35행+ 사진 실측 평균 ~45s.
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 10_000_000;

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  return NextResponse.json({
    hasGemini: !!process.env.GEMINI_API_KEY,
    backend: "gemini-direct",
    model: "gemini-3.5-flash",
  });
}

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

  try {
    const formData = await req.formData();
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "이미지가 없습니다" }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "이미지가 10MB 를 넘습니다" }, { status: 400 });
    }
    base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    mimeType = file.type || guessMimeFromName(file.name);
    // clientId 는 받기만 하고 무시 — Gemini 직접 추출은 거래처별 캐시/컨텍스트 힌트 안 씀.
    // (기존 ColumnTemplate 캐시 / clientContext 보너스는 Clova 의존 → 폐기)
  } catch (e) {
    return NextResponse.json({ error: `이미지 수신 실패: ${String(e).slice(0, 200)}` }, { status: 400 });
  }

  try {
    const result = await extractStatsLikeFusion(base64, mimeType, user.id);
    return NextResponse.json(result);
  } catch (e) {
    // Gemini API 호출 실패 — 폴백 없음 (단일 경로). 사용자가 재시도 안내.
    return NextResponse.json(
      { error: `AI 분석 실패: ${String(e).slice(0, 300)}` },
      { status: 500 },
    );
  }
}
