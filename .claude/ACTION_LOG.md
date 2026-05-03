# ACTION LOG (실시간 관제)

> 모든 에이전트는 작업 시작·진행·종료 시 한 줄 추가 (append-only).
> 사용자 관제 화면 = 이 파일 1개. 5분마다 새로 고침해도 OK.

## 형식

```
YYYY-MM-DDTHH:MM:SSZ | 에이전트 | 상태 | 작업명 | 진행률% | 현재 파일 | 추정 토큰 | 모델 티어
```

- 상태: `START` / `PROGRESS` / `BLOCKED` / `DONE` / `FAIL`
- 진행률: 0~100 (모를 때 `?`)
- 추정 토큰: 시작 시 추정치, 종료 시 실제값으로 갱신
- 모델 티어: `OPUS` (PM 전용) / `SONNET` (개발자) / `HAIKU` (노가다·테스트·주석)

## 로그 (최신이 위)

| 시각 (UTC) | 에이전트 | 상태 | 작업 | 진행 | 파일 | 토큰 | 티어 |
|---|---|---|---|---|---|---|---|
| 2026-04-29T13:00:00Z | main-pm | DONE | 토큰 절약·관제 셋업 (ACTION_LOG, 3티어, 승인게이트) | 100% | .claude/* | ~3k | OPUS |
| 2026-04-29T12:55:00Z | biz-inventory-crawler | START | 인천 로그인 팝업 우회 시도 | 0% | src/scrapers/adapters/inchun.ts | ~25k | SONNET |
| 2026-04-29T12:40:00Z | biz-digest-cron | START | 일일 자동 보고서 cron 강화 | 0% | src/app/api/cron/biz-digest/ | ~35k | SONNET |
| 2026-04-29T12:30:00Z | biz-search-engine | DONE | 동일성분 매칭 정밀화 (9/8/6자리) | 100% | api/medications/search | ~45k | SONNET |
| 2026-04-29T12:25:00Z | biz-rates-mgmt | DONE | rates 페이지 + API 5개 implement | 100% | api/biz-rates/, biz/rates/page.tsx | ~75k | SONNET |
| 2026-04-29T12:20:00Z | biz-inventory-crawler | DONE | P0 fixes (WholesaleSite upsert, CRON_SECRET, inchun) | 100% | worker/, scrapers/, api/cron/ | ~60k | SONNET |
| 2026-04-29T12:15:00Z | biz-settlement | DONE | 정산 업로드 행-나열 + dealer 연동 | 100% | biz/settlement/upload/page.tsx | ~30k | SONNET |
| 2026-04-29T12:10:00Z | biz-user-mgmt | DONE | dealer 분류 탭 + 플래그 implement | 100% | biz/dealers/page.tsx | ~25k | SONNET |
| 2026-04-29T12:00:00Z | (메타) | DONE | 9명 에이전트 + 5개 병렬 디스패치 라운드 | 100% | .claude/agents/* | ~8k | OPUS |

## 사용자 직접 모니터링용 합계 (당일 누적)

```
이번 작업일 누적 추정 토큰: ~310k
세션 시작 이후 누적: ~310k
다음 새벽 cron(09 KST) 발송 예정 토큰: ~5k
```

## 티어별 분포

```
OPUS  (PM)     ███ 11k  ( 4%)
SONNET (개발)  ████████████████████ 295k (95%)
HAIKU (노가다)  ▏ 0   ( 0%)  ← 미활용 — 이전 세션은 모두 Sonnet
```

→ 다음 라운드부터 노가다(주석/README/단위테스트)는 HAIKU로 전환해 비용 절감.
