# 병원 실적 이미지 자동 기록 (Gemini + Google Sheets)

영업사원이 카카오톡으로 보낸 병원 실적 사진을 Gemini 2.5 Flash 가 구조화 JSON 으로
추출하고, 결과를 구글 스프레드시트에 한 행씩 자동 append 하는 파이프라인.

## 왜 Gemini 인가 (기존 OCR 대비)

기존 AI OCR 은 픽셀 형태로 글자를 추측하기 때문에 빛 반사·흔들림·구겨짐·표 비뚤어짐에
약하다. 멀티모달 LLM 인 Gemini 는 이미지와 문맥을 함께 이해해서:

- 표 구조(행/열) 를 인간처럼 파악
- "병원 실적 장부니까 이 숫자는 매출 금액이겠구나" 하고 앞뒤 문맥으로 추론
- `responseSchema` 옵션으로 우리가 원하는 JSON 포맷대로만 응답하도록 강제

오인식률이 극적으로 줄고 후처리(정규식 파싱) 코딩이 불필요.

## 전체 파이프라인

```
[영업사원]
  카카오톡으로 실적 사진 전송
        ↓
[카카오 비즈채널 + i 오픈빌더 스킬 서버]
  사진을 임시 secure URL 로 변환해서 webhook 호출
        ↓ POST (JSON 페이로드 + ?token=...)
  /api/sales/kakao-webhook
        ↓
  url-safety.ts: SSRF 가드 (사설 IP / 메타데이터 endpoint 차단)
        ↓
  fetch(이미지 URL) → Buffer (최대 10MB)
        ↓
  gemini-sales-extract.ts
    → gemini-2.5-flash (responseSchema 강제)
        ↓
  { hospitalName, salesDate, totalAmount, salesRep }
        ↓
  google-sheets-append.ts
    → "병원 실적 데이터" 스프레드시트 → "실적" 탭에 append
        ↓
  { version: "2.0", template: { outputs: [{ simpleText: "기록 완료 ..." }] } }
        ↓
[영업사원] 카카오톡 자동 응답 수신
```

수동 업로드 흐름도 동일 모듈을 공유한다:

```
[/sales-extract 페이지] → /api/sales/extract → (동일 추출 + 시트 append)
```

## 추출 스키마

`src/lib/gemini-sales-extract.ts` 가 강제하는 `responseSchema`:

| TS 필드        | Gemini schema key | 타입    | 비고 |
|---------------|-------------------|---------|------|
| hospitalName  | `hospital_name`   | STRING  | 병원·의원·약국 이름 |
| salesDate     | `sales_date`      | STRING  | `YYYY-MM-DD`. 연도 누락 시 현재 연도로 보정 지시 |
| totalAmount   | `total_amount`    | INTEGER | 원 단위 순수 정수 |
| salesRep      | `sales_rep`       | STRING  | 없으면 빈 문자열 |

스키마 위반 시 `parseJsonLoose` 폴백 파서가 한 번 더 시도.

## 모델 선택

- 모델: `gemini-2.5-flash`
- 이유: 사진 한 장당 1~2초, 비용은 페이지당 수 원 수준. 같은 정확도라면 `pro` 보다
  훨씬 저렴해서 운영 단가 0 에 수렴.
- `temperature: 0` 으로 결정론적 출력 (같은 사진 → 매번 같은 결과).

## 환경 변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | ✓ | Gemini 호출용 |
| `GOOGLE_DRIVE_CLIENT_EMAIL` | ✓ | 구글 서비스 계정 이메일 |
| `GOOGLE_DRIVE_PRIVATE_KEY` | ✓ | 서비스 계정 비공개 키 (`\n` 이스케이프 유지) |
| `GOOGLE_DRIVE_FOLDER_ID` | 선택 | 스프레드시트를 둘 드라이브 폴더 (서비스 계정에 편집 권한 공유 필요) |
| `GOOGLE_SHEETS_SALES_SPREADSHEET_NAME` | 선택 | 기본 `"병원 실적 데이터"` |
| `KAKAO_SALES_WEBHOOK_SECRET` | 카카오 사용 시 ✓ | 스킬 서버 호출 인증 토큰. `?token=` 또는 `X-Kakao-Token` 헤더로 전달 |

## 시트 구조

스프레드시트: **`병원 실적 데이터`** (`GOOGLE_SHEETS_SALES_SPREADSHEET_NAME` 으로 변경 가능)
탭: **`실적`**

| 기록일시 | 병원명 | 실적일 | 금액 | 영업사원 | 출처 |
|---|---|---|---|---|---|
| ISO timestamp | 강남세란의원 | 2026-05-20 | 4500000 | 홍길동 | kakao |

`출처` 컬럼은 `kakao` / `manual` / `api` 중 하나. 디버깅 시 어느 경로로 들어왔는지 식별.

## 카카오 i 오픈빌더 설정

1. 카카오 비즈니스 채널 개설 → 사업자 인증
2. 카카오 i 오픈빌더 콘솔 → 봇 생성 → 카카오톡 채널 연결
3. **스킬 추가**
   - URL: `https://<배포도메인>/api/sales/kakao-webhook?token=<KAKAO_SALES_WEBHOOK_SECRET>`
   - 또는 HTTP 헤더에 `X-Kakao-Token: <토큰>`
4. **시나리오 블록** 에서 이미지 파라미터 슬롯 정의
   - 1차 stub 구현이 탐색하는 위치 (순서대로):
     1. `action.params.image_url` / `imageUrl` / `image` / `photo` / `secureimage`
     2. `action.detailParams.<any>.origin` 또는 `.value` 의 `https?://` URL
     3. `userRequest.utterance` 내 `https?://` 첫 매치
5. 테스트: 봇과 1:1 채팅 → 실적 사진 첨부 → "기록 완료 ✅" 응답 확인

> 카카오 i 오픈빌더의 이미지 파라미터 위치는 시나리오 빌더에서 어떻게 설정하느냐에 따라
> 달라진다. 실제 페이로드를 한 번 받아본 뒤 `extractImageUrl()` 로직을 보정할 수 있음.

## 직접 API 호출

### 인증된 웹 사용자 (multipart)

```bash
curl -X POST https://<host>/api/sales/extract \
  -H "Cookie: next-auth.session-token=..." \
  -F "image=@/path/to/photo.jpg"
```

### URL 입력 모드 (JSON)

```bash
curl -X POST https://<host>/api/sales/extract \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=..." \
  -d '{"imageUrl":"https://example.com/photo.jpg"}'
```

> 사설 IP (`10.0.0.0/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16` 등) 와
> `localhost`, `metadata.google.internal` 등은 `src/lib/url-safety.ts` 에서
> SSRF 가드로 차단된다.

### 응답

```json
{
  "success": true,
  "data": {
    "hospitalName": "서울연세안과",
    "salesDate": "2026-05-20",
    "totalAmount": 4500000,
    "salesRep": "홍길동"
  },
  "sheet": {
    "url": "https://docs.google.com/spreadsheets/d/...",
    "range": "실적!A6:F6"
  },
  "debug": { "durationMs": 1820, "model": "gemini-2.5-flash" }
}
```

## 수동 테스트 UI

`/sales-extract` 페이지에서 로그인된 사용자가 직접 사진을 업로드해 결과를 확인할 수 있다.
카카오 봇 운영 전에 추출 정확도를 점검하는 용도.

## 알려진 제약 / 향후 개선

- **카카오 SLA**: 권장 5초 / 하드 10초. Gemini(2~4s) + Sheets append(1~2s) 가 빠듯.
  현재는 단순 동기 흐름. 운영 중 timeout 빈도가 늘면 webhook → 큐(예: 즉시 "처리 중"
  응답 후 백그라운드 처리 + 카카오 푸시) 패턴으로 분리.
- **이미지 URL 추출 stub**: 카카오 i 오픈빌더 시나리오 구성에 따라 페이로드 모양이
  달라진다. 실제 페이로드 확인 후 `extractImageUrl()` 우선순위 조정 필요.
- **중복 행 방지 없음**: 같은 사진 두 번 보내면 시트에 두 행. (병원명+실적일) 기준
  unique 체크는 다음 PR.
- **금액 INTEGER 위반**: 모델이 가끔 `total_amount` 를 문자열로 응답해도
  `gemini-sales-extract.ts` 의 `toInt()` 가 안전 변환.

## 관련 파일

- `src/lib/gemini-sales-extract.ts` — Gemini 호출
- `src/lib/google-sheets-append.ts` — 시트 append (`google-sheets.ts` 의 JWT 토큰 캐시 재사용)
- `src/lib/google-sheets.ts` — `findOrCreateSpreadsheet(name?)`, `sheetsApi` export
- `src/lib/url-safety.ts` — SSRF 가드
- `src/app/api/sales/extract/route.ts` — 인증 사용자용 추출 + 시트 append
- `src/app/api/sales/kakao-webhook/route.ts` — 카카오 스킬 서버 엔드포인트
- `src/app/sales-extract/page.tsx` — 수동 테스트 UI
