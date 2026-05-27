import { NextRequest, NextResponse } from "next/server";
import { extractSalesFromImage } from "@/lib/ai/gemini-sales-extract";
import { appendSalesRow } from "@/lib/google/google-sheets-append";
import { assertSafePublicUrl } from "@/lib/url-safety";

export const runtime = "nodejs";
// 카카오 i 오픈빌더 스킬은 권장 5초 / 하드 10초 timeout. 동기 흐름이라 빠듯하다.
// Gemini 평균 2~4초 + Sheets append 1~2초. 운영 안정성이 떨어지면 webhook 을 비동기 큐
// 패턴으로 분리하는 게 다음 단계. docs/GEMINI_SALES_EXTRACTION.md 의 "알려진 제약" 참고.
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 10_000_000;
const FETCH_TIMEOUT_MS = 8_000;        // 카카오 SLA 안에 끝나야 해서 짧게

function kakaoText(text: string): NextResponse {
  return NextResponse.json({
    version: "2.0",
    template: { outputs: [{ simpleText: { text } }] },
  });
}

// 카카오 i 오픈빌더 스킬 페이로드는 시나리오 설정에 따라 이미지가 들어오는 자리가
// 다르다. 1차 stub: 가장 흔한 3가지 경로를 순차 탐색.
type KakaoSkillPayload = {
  userRequest?: {
    utterance?: string;
    params?: Record<string, unknown>;
  };
  action?: {
    params?: Record<string, string>;
    detailParams?: Record<string, { origin?: string; value?: string }>;
  };
};

function extractImageUrl(p: KakaoSkillPayload): string | null {
  const params = p.action?.params ?? {};
  for (const k of ["image_url", "imageUrl", "image", "photo", "secureimage"]) {
    const v = params[k];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  const detail = p.action?.detailParams ?? {};
  for (const k of Object.keys(detail)) {
    const candidate = detail[k]?.origin || detail[k]?.value;
    if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
  }
  // 발화 안에 URL 이 박혀오는 케이스
  const utterance = p.userRequest?.utterance ?? "";
  const m = utterance.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

export async function POST(req: NextRequest) {
  const expected = process.env.KAKAO_SALES_WEBHOOK_SECRET?.trim();
  if (!expected) {
    // 서버가 미설정인 채로 카카오에 노출돼 있으면 즉시 에러 알림 — 운영자가 빨리 알아채도록.
    return kakaoText("⚠️ 서버 설정 오류: 관리자에게 알려주세요. (KAKAO_SALES_WEBHOOK_SECRET 미설정)");
  }
  const got =
    req.nextUrl.searchParams.get("token") ||
    req.headers.get("x-kakao-token") ||
    "";
  if (got !== expected) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let payload: KakaoSkillPayload;
  try {
    payload = await req.json() as KakaoSkillPayload;
  } catch {
    return kakaoText("요청 본문이 비어있어요.");
  }

  const rawImageUrl = extractImageUrl(payload);
  if (!rawImageUrl) {
    return kakaoText("이미지가 첨부되지 않은 것 같아요. 실적 사진을 같이 보내주세요.");
  }

  let safeUrl: URL;
  try {
    safeUrl = assertSafePublicUrl(rawImageUrl);
  } catch (e) {
    return kakaoText(`이미지 URL 이 유효하지 않아요: ${String((e as Error).message ?? e)}`);
  }

  let buf: Buffer;
  let mimeType = "image/jpeg";
  try {
    const r = await fetch(safeUrl.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) return kakaoText(`사진을 받지 못했어요 (HTTP ${r.status}). 잠시 후 다시 보내주세요.`);
    buf = Buffer.from(await r.arrayBuffer());
    mimeType = r.headers.get("content-type")?.split(";")[0]?.trim() || mimeType;
  } catch (e) {
    return kakaoText(`사진 다운로드 실패: ${String(e).slice(0, 80)}`);
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    return kakaoText("사진이 10MB 를 넘어요. 더 작은 사진으로 부탁해요.");
  }

  let data;
  try {
    // gemini-3.5-flash 단일 호출. 카카오 SLA(10s) 안에 안정적으로 들어옴.
    data = (await extractSalesFromImage(buf.toString("base64"), mimeType)).data;
  } catch (e) {
    return kakaoText(`AI 분석 실패: ${String(e).slice(0, 80)}`);
  }
  if (!data.hospitalName && data.totalAmount === 0) {
    return kakaoText("사진에서 병원명/금액을 찾지 못했어요. 더 선명한 사진으로 다시 보내주세요.");
  }

  try {
    await appendSalesRow({ ...data, source: "kakao" });
  } catch (e) {
    return kakaoText(`AI 인식은 됐는데 시트 저장 실패: ${String(e).slice(0, 80)}. 관리자에게 알려주세요.`);
  }

  const lines = [
    "기록 완료 ✅",
    `• 병원: ${data.hospitalName || "(미상)"}`,
    `• 날짜: ${data.salesDate || "(미상)"}`,
    `• 금액: ${data.totalAmount.toLocaleString()}원`,
    `• 담당: ${data.salesRep || "(없음)"}`,
  ];
  return kakaoText(lines.join("\n"));
}
