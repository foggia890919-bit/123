# 네이버 매출 → Google Sheet → 텔레그램

**한 줄 요약**: 네이버 API 가 모든 결제 주문을 끌어와서 → 구글시트에 raw 누적 → 시트의 옵션매핑 룰로 키워드 분류 → 텔레그램 발송.

## 아키텍처

```
[09:00 매일]
  ↓
1. Naver API (multi-type 풀쿼리, ~99% 커버리지)
  ↓
2. Google Sheet 「주문원본」 탭에 raw 행 누적 (← 사장님이 콘솔과 비교 가능)
  ↓
3. Sheet 「옵션매핑」 탭 읽기 (← 사장님이 직접 수정/추가 가능)
  ↓
4. 매핑 적용 → 키워드별 집계 → Sheet 「일일집계」 탭에 누적
  ↓
5. 텔레그램 1통
```

장점:
- 시트가 진실 — 사장님이 네이버 콘솔과 직접 비교 검증 가능
- 매핑 룰은 시트 한 줄 추가하면 끝, 코드 수정 X
- raw 데이터 무한 누적 (월말 정산/세무 데이터로 활용)

## 메시지 예시

```
📊 2026-04-30 매출 보고

💰 매출 1,057,600원
📦 43건 배송 / 136병 / 46개 품목
💳 수수료 43,844원
⚠️ 취소·반품·환불 1건 제외

━━ 키워드별 ━━
• 피쿠알
   96병 · 32개 · 30건 · 805,800원
• 블렌딩
   30병 · 10개 · 10건 · 149,000원
…
```

---

## 셋업

### 1. 코드 다운로드

```powershell
cd $env:USERPROFILE
git clone -b claude/naver-sales-automation-VKAMr https://github.com/foggia890919-bit/123.git sales
cd sales\simple
npm install
```

### 2. 텔레그램 봇 만들기

1. 텔레그램 → `@BotFather` → `/newbot` → 토큰 받기
2. `@userinfobot` → `/start` → 본인 chat_id
3. 본인 봇한테 `/start` 한번 (안 누르면 봇이 메시지 못 보냄)

### 3. (강력 추천) Google Sheet 셋업

#### 3-1) 시트 만들기
1. https://sheets.google.com → 새 시트 → 이름 「매출보고」
2. 시트 URL 의 `.../d/【여기】/edit` 부분 복사 = `GOOGLE_SHEETS_ID`

#### 3-2) Service Account 만들기 (5분, 무료)
1. https://console.cloud.google.com → 새 프로젝트 (이름: `naver-sales`)
2. 좌측 ☰ → 「API 및 서비스」 → 「라이브러리」 → `Google Sheets API` 검색 → 「사용」
3. 좌측 ☰ → 「IAM 및 관리자」 → 「서비스 계정」 → 「+ 서비스 계정 만들기」
   - 이름: `sales-bot` → 만들고 계속 → 완료
4. 만든 서비스 계정 클릭 → 「키」 탭 → 「키 추가」 → 「새 키 만들기」 → JSON → 만들기
5. JSON 파일 다운로드됨. 메모장으로 열어서:
   - `client_email` 값 → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` 값 (`"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"` 통째로 따옴표 포함) → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

#### 3-3) 시트에 Service Account 공유
1. 「매출보고」 시트 우상단 「공유」
2. `GOOGLE_SERVICE_ACCOUNT_EMAIL` 값 (예: `sales-bot@naver-sales-xxx.iam.gserviceaccount.com`) 붙여넣기
3. 권한: 「**편집자**」 → 보내기

#### 3-4) 「옵션매핑」 탭 만들기 (선택, 미설정 시 코드 기본값 사용)
시트에 새 탭 추가 → 이름 「옵션매핑」 → A1 셀에:
```
패턴       키워드
피쿠알      피쿠알
picual     피쿠알
아르베키나   아르베키나
arbequina  아르베키나
블렌딩      블렌딩
blending   블렌딩
곽당        한방차
아보카도     아보카도
```

옵션 텍스트에 「패턴」 이 들어있으면 → 「키워드」로 매핑됨. 새 상품 추가 시 행 추가만 하면 됨.

### 4. .env 채우기

```powershell
copy .env.example .env
notepad .env
```

채울 값:
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (필수)
- `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (선택, 시트 쓸 때)
- 네이버 키 3개는 이미 채워져있음

저장 (UTF-8 인코딩).

### 5. 첫 실행

```powershell
npx tsx run.ts
```

콘솔 로그 + 텔레그램 도착 + (시트 쓰면) 시트에 행 추가 확인.

특정 날짜:
```powershell
npx tsx run.ts 2026-04-30
```

### 6. 매일 09시 자동 실행 — Windows 작업 스케줄러

`Win + R` (안 되면 시작 → 「작업 스케줄러」 검색)

「작업 만들기」:
- 일반: 이름 `Naver매출보고`, 「가장 높은 권한으로 실행」 ☑
- 트리거: 매일 09:00
- 동작: 프로그램 `cmd.exe`, 인수: `/c "cd /d %USERPROFILE%\sales\simple && npx tsx run.ts > %TEMP%\sales.log 2>&1"`
- 조건: 「AC 전원」 ☐ (해제)
- 설정: 「예약된 시작 시간 놓친 경우 가능한 한 빨리 작업 시작」 ☑

저장. 우클릭 「실행」 으로 즉시 테스트.

---

## 트러블슈팅

| 증상 | 해결 |
|---|---|
| `Host not in allowlist` | 네이버 콘솔 → 각 앱 → 「API호출 IP」에 PC IP 추가 후 「저장」 (3개 앱 모두) |
| `chat not found` | 본인 봇한테 `/start` 한번 누르기 |
| 시트에 안 써짐 | Service Account 이메일에 시트 「편집자」 공유 확인 |
| `RATE_LIMIT` | 잠시 후 재시도 (스크립트 자체에 딜레이 있음) |
| 매출 수 차이 | 시트 「주문원본」 탭과 네이버 콘솔 엑셀다운 비교 → 누락 행 직접 추가 가능 |

## 사장님 일상

- 매일 09시 자동으로 텔레그램 옴 ✅
- 시트 「주문원본」 보면 그날 raw 데이터 다 있음
- 시트 「일일집계」 보면 키워드별 누적
- 새 상품/옵션 등장하면 「옵션매핑」 탭에 한 줄 추가 → 다음 날부터 깔끔하게 분류

## 한계 (정직)

- Naver API 가 가끔 일부 productOrder 누락 케이스 있음 (~99% 정확도 추정)
- 100% 보장 필요하면 시트의 「주문원본」 과 네이버 콘솔 엑셀다운 매월 1회 대조
- 네이버 콘솔 IP 화이트리스트 필요 (PC IP 가 가끔 바뀌면 재등록)
