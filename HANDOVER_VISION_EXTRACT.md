# 처방전 OCR → Gemini Vision 추론 전환 (작업 핸드오버)

날짜: 2026-06-01 / 브랜치: `claude/ocr-inference-vision` (production `claude/plan-service-project-Ea4Bn` 기반 worktree)

## 배경 / 엔진 결정
- 목표: `src/app/api/stats/ocr/route.ts`(2355줄)의 좌표·규칙 기반 추출(Clova 좌표+positional+
  ColumnTemplate+slope+cross-validate)을 **이미지를 사람처럼 통째로 읽는 추론(VLM) 단일 경로**로
  단순화 → 정확도 향상(현재 ~90%).
- 엔진은 **Gemini `gemini-3.5-pro`** (평가 정확도 1위). Claude 는 SDK/결제 막힘 + 정확도 열위로 제외.
- 과거 Gemini Vision 폐기는 Gemini 탓이 아니라 **좌표 로직과 얽힌 파이프라인 복잡함**이 환각/순서
  뒤집힘을 유발한 탓. 그래서 그 복잡함을 걷어낸 **단일 경로**로 부활시킴.

## 변경 내용 (신규 파일·신규 의존성 없음)
1. `route.ts` 추출 seam: `merged = parseDrugsFromClovaText(...)` 자리에 분기 추가.
   `USE_VISION_EXTRACT=1` 이면 기존 `callGeminiVision()`(이미 코드에 있으나 폐기돼 있던 함수)을
   호출해 약품 행을 추론 추출 → `merged` 로 사용. 실패 시 Clova 줄 파서로 안전 폴백.
   Gemini 가 읽은 보험코드로 `fetchMasterByCodes` 재조회. **마스터 매칭·신뢰도·정렬·dedupe·
   FusionResult 등 다운스트림은 전부 그대로 유지.**
2. `callGeminiVision` 모델: `gemini-2.5-pro` → `process.env.GEMINI_VISION_MODEL || "gemini-3.5-pro"`.
   (기존 단일 프롬프트 + responseMimeType:application/json 강제출력 + thinkingBudget:-1 + temperature:0
   구조 그대로 — 깔끔한 추론 경로.)

> Claude 관련 시도(`src/lib/claude-vision.ts`, `@anthropic-ai/sdk`)는 전부 제거함.

## 켜는 법 / 끄는 법
- 기본 OFF (env 미설정 시 기존 Clova 동작 100% 그대로 — 회귀 위험 0).
- 켜기: `.env` 에 `USE_VISION_EXTRACT=1` (`GEMINI_API_KEY` 는 이미 세팅돼 있어야 함).
- 모델 교체: `GEMINI_VISION_MODEL=...` (예: 다른 Gemini 버전 테스트 시).

## 남은 검증 (사장님 터미널에서)
- `npm run build` 로 타입체크 (신규 의존성 없으니 node_modules 있으면 install 불필요).
- `USE_VISION_EXTRACT=1` 켜고 실제 처방전 사진(특히 기울어진 모니터 촬영본) ON/OFF 정확도 비교.
