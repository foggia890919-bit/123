# 처방 통계 표 자동 분석 (Gemini 멀티모달, OCR 미사용)

영업사원이 카카오톡으로 보내는 사진은 사실 단순 영수증이 아니라 **EMR 처방통계 화면**
인 경우가 대부분이다. 비스듬히 찍힌 모니터 사진에서:

- 상단 합계 (약품건수/처방횟수/총사용량/총금액)
- 30~50행짜리 약품 표 (약품명/보험코드/환자수/처방횟수/총사용량/단가/총금액)
- 메타 (제약사·통계기간·병원명)

모두를 Gemini 멀티모달 비전 한 번에 추출하고 **약품별 자동 분류 + 효능 요약** 까지
붙여서 구글 스프레드시트에 한 batch 로 기록한다. OCR/Document AI 같은 사전 처리
**전혀 안 함** — 비스듬한 사진/모니터 반사에서 위치 기반 fusion 이 깨지는 문제를 우회.

## 왜 Gemini-only 인가

기존 `src/app/api/stats/ocr/route.ts` 는 Clova OCR + Document AI 셀 추출 + Gemini Vision
의 fusion 파이프라인. 정상적인 종이 처방전에선 강력하지만, **비스듬히 찍은 모니터
사진** 에선:

- Clova 의 Y 클러스터링이 깨져 행 단위 매핑이 한 줄씩 밀림
- Document AI 의 셀 분리가 매번 다르게 나옴
- 정확한 컬럼 X 좌표를 못 잡아 quantity·금액이 인접 행 cell 로 오인식

이 모듈은 그 fusion 을 완전히 우회하고 **사진 base64 → 멀티모달 LLM 직접** 방식.
LLM 이 표 구조를 사람처럼 이해해서 행 단위로 정리.

## 파이프라인

```
[인증 사용자] /rx-stats-extract 페이지
   │  파일 업로드 (multipart) 또는 imageUrl JSON
   ↓
POST /api/rx-stats/extract
   │  - requireSession 인증
   │  - SSRF 가드 (imageUrl 모드)
   │  - 10MB size 가드
   ↓
extractRxStatsFromImage(base64, mime)
   │  gemini-3.5-flash + responseSchema + thinkingBudget=-1
   │  (2026-05 GA, 3.1 Pro 보다 우위 — 별도 Pro 폴백 없음)
   ↓
{ pharma, period, hospital, summary{4}, drugs[]{8필드} }
   ↓
appendRxStats(payload, source)
   │  스프레드시트: "처방통계 데이터" (env 로 변경 가능)
   │  탭1 "요약": 1행 (메타 + 합계)
   │  탭2 "약품": N행 (각 약품 한 행)
   │  두 탭 batchId(UUID) 로 묶임 — 한 업로드 = 한 batchId
   ↓
JSON 응답 + 시트 링크 + batchId
```

## 추출 스키마

`src/lib/gemini-rx-stats-extract.ts` 의 `RxExtractResult`:

| TS 필드 | JSON key | 타입 | 비고 |
|---|---|---|---|
| pharma | `pharma` | string | "경동", "한미" 등 |
| period | `period` | string | **YYYY-MM 정규화 결과**. 실패 시 "" |
| periodRaw | `period` 응답 원본 | string | "2026년 4월" 등 그대로 보존 — 시트 "기간원본" 컬럼에 저장 |
| hospital | `hospital` | string | 없으면 "" |
| summary.drugCount | `summary.drugCount` | int | 약품 종류 수 |
| summary.totalPrescriptions | `summary.totalPrescriptions` | int | 총 처방횟수 |
| summary.totalQuantity | `summary.totalQuantity` | number | 소수 허용 (시럽 등) |
| summary.totalAmountWon | `summary.totalAmountWon` | int | 원, 콤마 제거 |
| drugs[].name | `name` | string | 약품명 (한글+영문, 용량·제형 포함) |
| drugs[].code | `code` | string | 보험코드 9자리, 모르면 "" |
| drugs[].quantity | `quantity` | number | 총사용량 |
| drugs[].prescriptions | `prescriptions` | int | 처방횟수 |
| drugs[].unitPrice | `unitPrice` | number | 단가, 모르면 0 |
| drugs[].totalPrice | `totalPrice` | number | 총금액, 모르면 0 |
| drugs[].category | `category` | string | **자유 형식** "만성질환/고혈압", "근골격/통풍", "소화기/PPI", "기타" 등 |
| drugs[].efficacy | `efficacy` | string | 짧은 효능 한 줄. 잘 모르면 "" |

### period 정규화 규칙

모델이 자유 형식으로 답해도 다음 패턴을 인식해서 YYYY-MM 으로 변환:

- `2026-04` → `2026-04`
- `2026.04`, `2026/4` → `2026-04`
- `2026년 4월`, `2026 년 04 월` → `2026-04`
- `Apr 2026`, `April 2026` → `2026-04`

매칭 실패 시 `period=""`. 원본은 `periodRaw` 에 보존되어 시트에 같이 기록됨.

## 모델 / 추론 설정

- **`gemini-3.5-flash`** 단일 모델 (2026-05 GA, Google I/O 2026 발표)
- 이전 세대의 3.1 Pro 보다 코딩·추론 성능 우위 + 4배 빠름 → 별도 Pro 폴백 불필요
- `thinkingBudget: -1` (AUTOMATIC) — 다행 표 추출은 단계적 추론이 정확도에 결정적
- `temperature: 0` — 결정론적 출력 (같은 사진 매번 같은 결과)

### 부분 추출 케이스 (운영자 인지 필요)

3.5 Flash 가 35행 중 25행만 뽑는 케이스가 드물지만 발생 가능. 자동 재시도 없음.
대신:

- UI 가 `summary.drugCount !== drugs.length` 시 주황색 경고 배너 표시
- 사용자가 시트 검수 또는 더 선명한 사진으로 재시도 가능
- 운영자 모니터링: 시트 "요약" 탭의 `약품수` vs "약품" 탭의 batchId 별 행 수 비교 가능

운영 데이터에서 부분추출 비율이 높으면 별도 PR 에서 동일 모델 재시도 또는 합계
일치 검증 로직 추가 검토.

## 시트 구조

스프레드시트: **`처방통계 데이터`** (`GOOGLE_SHEETS_RX_STATS_SPREADSHEET_NAME` env 로 변경)

### 탭 "요약" (한 업로드 = 한 행)

| 기록일시 | 제약사 | 기간(YYYY-MM) | 기간원본 | 병원 | 약품수 | 처방횟수 | 총사용량 | 총금액 | 출처 | batchId |
|---|---|---|---|---|---|---|---|---|---|---|
| ISO timestamp | 경동 | 2026-04 | 2026년 4월 | (병원명) | 35 | 449 | 18609.5 | 11309366 | manual | UUID |

### 탭 "약품" (한 업로드 = N 행)

| 기록일시 | batchId | 제약사 | 기간(YYYY-MM) | 약품명 | 보험코드 | 사용량 | 처방횟수 | 단가 | 총금액 | 카테고리 | 효능 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ISO | UUID | 경동 | 2026-04 | 프라빅센정 | 658600100 | 2990 | 78 | 365 | 1091350 | 만성질환/항혈소판 | 혈전 생성 예방 |

> **batchId 활용** — 한 업로드의 모든 행을 묶음 단위로 필터/삭제할 때 사용. 두 탭에
> 같은 UUID 가 들어가서 "이 batch 의 모든 약품 보기" 같은 분석을 시트 필터로 즉시
> 수행 가능.

## 환경 변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | ✓ | Gemini 호출용 |
| `GOOGLE_DRIVE_CLIENT_EMAIL` | ✓ | 구글 서비스 계정 |
| `GOOGLE_DRIVE_PRIVATE_KEY` | ✓ | 서비스 계정 비공개 키 |
| `GOOGLE_DRIVE_FOLDER_ID` | 선택 | 시트를 둘 폴더 (서비스 계정 편집권한 공유 필수) |
| `GOOGLE_SHEETS_RX_STATS_SPREADSHEET_NAME` | 선택 | 기본 "처방통계 데이터" |

> `KAKAO_SALES_WEBHOOK_SECRET` 은 이 엔드포인트와 무관 — 카카오 챗봇은 단순 4필드
> 추출 (`/api/sales/extract`) 에만 연결됨. 처방통계 분석은 인증된 웹 사용자 전용.

## API 직접 호출

```bash
curl -X POST https://<host>/api/rx-stats/extract \
  -H "Cookie: next-auth.session-token=..." \
  -F "image=@/path/to/rx-stats-screenshot.jpg"
```

응답:

```json
{
  "success": true,
  "data": {
    "pharma": "경동",
    "period": "2026-04",
    "periodRaw": "2026년 4월",
    "hospital": "",
    "summary": { "drugCount": 35, "totalPrescriptions": 449, "totalQuantity": 18609.5, "totalAmountWon": 11309366 },
    "drugs": [
      { "name": "프라빅센정", "code": "658600100", "quantity": 2990, "prescriptions": 78, "unitPrice": 365, "totalPrice": 1091350, "category": "만성질환/항혈소판", "efficacy": "혈전 생성 예방 (항혈소판제)" },
      ...
    ]
  },
  "sheet": {
    "url": "https://docs.google.com/spreadsheets/d/...",
    "summaryRange": "요약!A6:K6",
    "drugsRange": "약품!A150:L184",
    "batchId": "a1b2c3d4-..."
  },
  "debug": { "durationMs": 4820, "model": "gemini-3.5-flash" }
}
```

## 로컬 테스트 스크립트

API 키만 있으면 사진 한 장으로 즉시 추출 확인 가능:

```bash
GEMINI_API_KEY=AIza... npx tsx scripts/test-gemini-rx-stats.ts /path/to/photo.jpg
```

출력은 마크다운 형식 (카테고리별 약품 표, 합계 통계, debug 정보). Sheets append 는
안 함 — 순수 추출 정확도 확인 목적. 운영 배포 전에 새 EMR 화면 패턴이 들어왔을 때
이 스크립트로 1차 검증 후 운영에 반영.

## 알려진 한계 / 향후 개선

1. **부분 추출 자동 감지 X** — `summary.drugCount` 와 실제 추출 행 수 비교는 UI 경고만.
   자동 Pro 재시도는 별도 PR.
2. **카테고리 자유 형식** — 시트 필터링 시 "만성질환/고혈압" 과 "만성질환/고지혈증"
   이 다른 그룹으로 잡힘. 의도된 동작이지만 운영 데이터 누적 후 enum 후보 정리 가능.
3. **`thinkingBudget=-1` 응답 지연** — 복잡 사진은 25~30초까지 소요 가능. Vercel
   maxDuration 90s 로 여유 확보. 시간이 더 늘면 thinkingBudget 을 고정값으로 제한.
4. **효능 환각 위험** — Gemini 가 모르는 약품에 그럴듯한 잘못된 효능을 만들 수 있음.
   UI 와 시트 모두에 "AI 자동 추론, 의료 의사결정 X" 주석 표시. 운영 중 환각 발견 시
   해당 약품을 프롬프트에 negative example 로 추가 검토.

## 관련 파일

- `src/lib/gemini-rx-stats-extract.ts` — Gemini 호출 + period 정규화
- `src/lib/google-sheets-rx-append.ts` — 두 탭 batch append + race 가드
- `src/app/api/rx-stats/extract/route.ts` — POST 엔드포인트 (`maxDuration=90`)
- `src/app/rx-stats-extract/page.tsx` — 카테고리별 표 UI + 부분추출 경고
- `scripts/test-gemini-rx-stats.ts` — 로컬 추출 테스트
- `src/lib/google-sheets.ts` — `findOrCreateSpreadsheet`, `sheetsApi` (재사용)
- `src/lib/url-safety.ts` — SSRF 가드 (재사용)
- `vercel.json` — `maxDuration: 90` 명시
