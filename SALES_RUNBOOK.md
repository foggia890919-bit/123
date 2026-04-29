# 네이버 매출 자동화 — 운영 매뉴얼 (한 페이지)

## 첫 사용자가 봐야 할 화면 5개

| URL | 용도 |
|---|---|
| `/admin/sales/onboarding` | **5단계 위저드** — 사업자/스토어/텔레그램/백필 한 번에 |
| `/admin/sales/dashboard` | 매출·이익·요일·시간대·키워드별 분석 (기간 비교 포함) |
| `/admin/sales/orders` | 주문 검색 + 상세 모달 + CSV 내보내기 |
| `/admin/sales/keywords` | 옵션 → 키워드 자동매핑 룰 + 「✨ 빈 옵션 자동 채우기」 |
| `/admin/sales/health` | 환경변수/스토어 인증/최근 보고 한눈에 |

## 무엇이 자동으로 도는가

| 무엇 | 언제 | 어디서 |
|---|---|---|
| 매출 보고 (텔레그램 + 시트) | 매일 09:00 KST | `/api/cron/daily-sales` (10분마다 실행, 워크스페이스별 reportTime 매칭) |
| 백필 (1년치 누적) | 5분마다 | `/api/cron/backfill` (PENDING/FAILED 잡 7일씩 진행) |
| 신규 상품 발견 | 매시간 | `/api/cron/product-sync` (네이버 상품 API → 신상품 텔레그램) |

## 보고는 어떻게 멱등적으로 도는가

- KST `reportTime` 이 지났고 + `DailyReportLog(workspaceId, reportDate)` 가 없으면 발송
- cron 이 1시간 늦게 와도 OK, 한 번 더 호출돼도 OK (unique 제약)

## 매출에서 자동 차감되는 것

- 상태가 `CANCELED` / `RETURNED` / `REFUNDED` / 「취소」/「반품」/「환불」 인 주문은 매출/이익에서 **자동 제외**
- 주문 검색 페이지에는 빨간 배경 + 취소선으로 표시 (집계엔 안 들어감)

## 키워드 추세 알림 (홈에 표시)

매 페이지 로드 시 자동 계산:

| 조건 | 알림 |
|---|---|
| 직전 7일 ≥ 5개 AND 지난 7일 0개 | 🛑 매출 중단 |
| 직전 7일 ≥ 5개 AND 지난 7일이 50% 이하로 감소 | 📉 N% 감소 |
| 직전 7일 ≥ 5개 AND 지난 7일이 100% 이상 증가 | 📈 N% 급증 |
| 직전 7일 0개 AND 지난 7일 ≥ 3개 | 🆕 신규 매출 |

## 시크릿 보안

- `ENCRYPTION_KEY` 환경변수 (32바이트 hex 권장, sha256 fallback)
- 적용 대상: NaverStore.clientSecret, Workspace.telegramBotToken, Workspace.googleServiceAccountKey
- 키 미설정 시 평문 저장 (개발 OK), 설정 시 신규 쓰기부터 자동 암호화

## 데이터 격리 (멀티테넌시)

- 모든 매출 API (`/api/sales/*`) 가 `requireWorkspace()` 통과 필수
- 다른 사장님 데이터는 절대 응답에 안 섞임
- 쿠키 `ws=workspaceId` 로 워크스페이스 컨텍스트 결정 (안 맞으면 자동으로 첫 워크스페이스로 폴백)

## 흔한 실패 케이스

| 증상 | 진단 / 해결 |
|---|---|
| 백필 잡 errors 에 `Host not in allowlist` | 서버 외부 IP 가 네이버 화이트리스트에 없음. 콘솔에서 IP 추가 또는 빈 칸으로 저장 |
| 스토어 등록 시 `Naver API 인증 실패` | 같은 원인. 「검증 없이 강제 저장」 버튼으로 우회 후 IP 등록 |
| 09시 보고가 안 옴 | `/admin/sales/health` 에서 워크스페이스 「텔레그램」 ✅ 확인. 「텔레그램 핑」 버튼으로 즉시 검증 |
| 옵션이 키워드별 집계에 안 잡힘 | `/admin/sales/keywords` 에 매칭 패턴 등록 후 「✨ 빈 옵션 자동 채우기」 |
| 시트가 안 채워짐 | Service Account JSON 의 `client_email` 을 시트 「공유」에 「편집자」로 등록했는지 확인 |

## DB 마이그레이션

처음 배포:
```bash
DATABASE_URL="..." npx prisma migrate deploy
```

또는 (개발 편의):
```bash
DATABASE_URL="..." npx prisma db push
```

스키마 추가 후:
```bash
DATABASE_URL="..." npx prisma migrate dev --name <설명>
```

## 테스트

```bash
npm test           # vitest run
npm run test:watch # 인터랙티브
```

현재 27개 테스트 (keyword-match, crypto, order-status). CI 자동 실행: `.github/workflows/ci.yml`.

## 환경변수 체크리스트

| 키 | 필수 | 용도 |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres |
| `NEXTAUTH_SECRET` | ✅ | 세션 |
| `NEXTAUTH_URL` | ✅ | OAuth callback |
| `CRON_SECRET` | ✅ | cron 보호 |
| `ENCRYPTION_KEY` | ⭐ | 시크릿 암호화 (운영 필수) |
| `TELEGRAM_BOT_TOKEN` | ❌ | 워크스페이스에서 오버라이드 가능 |
| `TELEGRAM_CHAT_ID` | ❌ | 워크스페이스에서 오버라이드 가능 |
| `GOOGLE_SHEETS_ID` | ❌ | 워크스페이스에서 오버라이드 가능 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ❌ | 워크스페이스에서 오버라이드 가능 |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | ❌ | 워크스페이스에서 오버라이드 가능 |

## 한 줄 요약

```
가입 → /admin/sales/onboarding 위저드 → 텔레그램 도착 확인
   → 매일 09:00 자동 매출 보고 + 시트 누적 + 키워드 알림
```
