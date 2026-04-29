# 부동산 매물 모니터 (개인 사용 전용)

병의원 개원 후보지를 빠르게 발견하기 위한 도구. 네이버부동산을 폴링해서
**조건에 맞는 신규 매물이 올라오는 즉시** 본인에게 SMS / 텔레그램으로 알림이
가도록 만들었다.

## ⚠️ 사용 시 주의

- 네이버부동산 약관은 자동수집을 **금지**한다. 본 모듈은 개인 사용 한정이며,
  공격적인 폴링(짧은 간격, 다중 동시접속, 대규모 지역)은 차단·법적 분쟁의
  사유가 된다. `RE_SCRAPE_INTERVAL_MS` 기본값(3000ms)을 줄이지 말 것.
- 수집된 **중개사 연락처를 동의 없이 광고/마케팅 SMS·전화로 사용하면**
  개인정보보호법·정보통신망법 위반(과태료 ~3,000만원, 형사처벌 가능). 알림은
  반드시 *본인 수신용*으로만.
- 시세 분석·통계는 합법적 채널인 **국토부 실거래가 OpenAPI** 사용을 권장.

## 구성

```
src/realestate/
  naver/
    scraper.ts     # Playwright + 내부 JSON API 호출
    codes.ts       # 매물·거래 코드 매핑
  molit/
    client.ts      # 국토부 OpenAPI 클라이언트
    sync.ts        # DB 캐시 동기화
  match.ts         # 워치 ↔ 매물 매칭
  notify.ts        # SMS / 텔레그램 디스패처
  storage.ts       # Prisma upsert
  run.ts           # CLI 진입점
  types.ts
```

## 셋업

1. `.env` 채우기 (`.env.example` 참고)
   - `RE_DEFAULT_CORTARS` — 행정동 코드(네이버 지도 URL에서 확인)
   - `MOLIT_SERVICE_KEY` — data.go.kr 인증키
   - SMS: 기존 `COOLSMS_*` 그대로 사용
   - 텔레그램: `TELEGRAM_BOT_TOKEN` (BotFather → 새 봇 → 토큰)
2. `prisma/migrations/manual/add_real_estate.sql` 을 Supabase SQL Editor에서 실행.
3. `npm install && npx playwright install chromium`

## 사용

```bash
# 한 번 폴링 (지정 cortarNo)
npm run re:scrape -- --cortar 1168010100 --types 상가,사무실 --trades 매매,월세

# 활성 워치 기준으로 자동 수집
npm run re:scrape -- --watches

# 단일 매물 상세 (중개사 연락처 포함)
npm run re:detail -- 1234567890

# 국토부 실거래가 (강남구 11680 / 6개월)
npm run re:molit -- --endpoint commercialSale --lawd 11680 --months 6
```

웹 UI: `npm run dev` → `http://localhost:3000/realestate`
워치 관리: `/realestate/watches` (로그인 필요)

## Vercel 크론

`vercel.json` 의 `*/15 * * * *` 가 `/api/cron/realestate-poll` 을 친다.
이 라우트는 `RE_WORKER_URL` 이 있으면 외부 워커에 위임만 한다 (Vercel은
Playwright 미지원). 위임 대상 워커가 없으면 그냥 reason을 반환한다.

권장 운영 형태:
- Lightsail / 작은 VPS 한 대에서 GitHub Actions 또는 systemd 타이머로
  `npm run re:scrape -- --watches` 를 5–15분마다 돌린다.
- 매물 수집 → DB 저장 → 신규 건만 워치 매칭 → 알림 발송 까지 한 번에 처리.
