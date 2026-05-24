import { NextResponse } from "next/server";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

// Gemini 자가검증 ENV 적용 상태 진단 endpoint.
// 사용자가 Vercel 환경변수 추가 + 재배포 했는데 검수 페이지에 노란 "검증대상"
// 행이 안 보이면 여기로 GET 해서 즉시 확인 가능.
//
// 사용법: 브라우저로 https://yoursite.com/api/health/self-validate 접속.
// 응답:
//   {
//     enabled: true|false,     // GEMINI_SELFVALIDATE_ENABLED 가 "true" 인지
//     debug: true|false,       // GEMINI_SELFVALIDATE_DEBUG 가 "true" 인지
//     hasGeminiApiKey: bool,   // 기본 Gemini API key 존재 여부 (없으면 모든 self-validate 가 즉시 null)
//     rawEnabledValue: "..."   // 실제 ENV 값 (디버깅용 — "true"/"false"/"(unset)")
//   }

export const runtime = "nodejs";

export async function GET() {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "ADMIN" && user.role !== "BIZ") {
    return NextResponse.json({ error: "FORBIDDEN — ADMIN/BIZ 만 접근 가능" }, { status: 403 });
  }

  const enabled = process.env.GEMINI_SELFVALIDATE_ENABLED === "true";
  const debug = process.env.GEMINI_SELFVALIDATE_DEBUG === "true";
  const hasGeminiApiKey = !!process.env.GEMINI_API_KEY;

  return NextResponse.json({
    enabled,
    debug,
    hasGeminiApiKey,
    rawEnabledValue: process.env.GEMINI_SELFVALIDATE_ENABLED ?? "(unset)",
    rawDebugValue: process.env.GEMINI_SELFVALIDATE_DEBUG ?? "(unset)",
    advice: enabled && hasGeminiApiKey
      ? "정상 — 새 사진을 업로드하면 검증대상 마킹이 동작합니다."
      : !hasGeminiApiKey
      ? "GEMINI_API_KEY 가 없습니다. 환경변수에 추가하세요."
      : "GEMINI_SELFVALIDATE_ENABLED 가 'true' 가 아닙니다. Vercel 환경변수 추가 후 재배포(Redeploy) 필요.",
  });
}
