# 비즈 관리 프로젝트 — 진행 대시보드

> 마지막 업데이트: 2026-04-29 (오케스트라: Opus 4.7 / 서브에이전트: Sonnet 4.6)
> 운영 모드: 자율 진행 + 대량 병렬 + 마지막 종합 보고

---

## 👥 팀 (8명)

| 역할 | 이름 | 모델 |
|---|---|---|
| 🎩 PM | 메인 (오케스트라) | Opus 4.7 |
| 👨‍💻 Dev1 거래처/유저 | biz-user-mgmt | Sonnet 4.6 |
| 👩‍💻 Dev2 통계제출처 | biz-submission-routes | Sonnet 4.6 |
| 👨‍💻 Dev3 요율 | biz-rates-mgmt | Sonnet 4.6 |
| 👩‍💻 Dev4 정산 | biz-settlement | Sonnet 4.6 |
| 👨‍💻 Dev5 필터링 | biz-filtering | Sonnet 4.6 |
| 👨‍💻 Dev6 재고 크롤러 | biz-inventory-crawler | Sonnet 4.6 |
| 🕵️ QA | biz-qa-crosscheck | Sonnet 4.6 |

---

## 📊 메뉴별 작업 큐

| 메뉴 | 진행 중 | 검증 대기 | 최근 완료 |
|---|---|---|---|
| 거래처/유저 관리 | — | — | ✅ dealer 분류 탭 + 플래그 (a19aa40) |
| 통계제출처 관리 | — | — | ✅ 신규/이관·월별·미매핑 (42fd358) |
| 요율 관리 | verify v3 보완 (in flight) | rates implement 대기 | placeholder (1c7e4af) |
| 정산 관리 | settlement implement (in flight) | settlement QA 대기 | verify v2 완료 |
| 필터링 관리 | — | — | (안정) |
| 재고 크롤러 | audit (in flight) | 보고서 대기 | (감사 진행) |
| 메타 — 팀 상태 대시보드 | verify+implement (in flight) | — | — |
| 메타 — 텔레그램 인프라 | verify (in flight) | — | — |

---

## 통합검색

| 날짜 | 작업 | 결과 |
|---|---|---|
| 2026-05-06 | paymentType 필터 추가 (API + 검색 UI) | 완료 |

**변경 파일**:
- `src/app/api/medications/search/route.ts` — `paymentType` query param 파싱 및 where 조건 적용
- `src/app/search/page.tsx` — `selectedPaymentType` state, paymentType chip 버튼 UI, runSearch/refetchWithCompanies에 pt 인자 전달

---

## 🗒 작업 로그

| 시각 | 메뉴 | 모드 | 요약 | 결과 |
|---|---|---|---|---|
| 2026-04-29 | (시스템) | setup | 5개 서브에이전트 + 대시보드 정의 | OK |
| 2026-04-29 | 거래처/유저 | verify v2 | dealer 분류 탭 + 플래그 (QA CONDITIONAL_PASS 4건 보완) | OK |
| 2026-04-29 | 거래처/유저 | implement | dealer 분류 탭 + isSettlementTarget/isRateTarget | OK (a19aa40) |
| 2026-04-29 | 정산 | verify v2 | 행-나열 방식 개편 (T14/T15 보완) | OK |
| 2026-04-29 | 요율 | verify v2 | CorpRateFile + History (QA CONDITIONAL_PASS 5건 보완 진행) | 진행 중 |
| 2026-04-29 | (시스템) | setup | 크롤러 에이전트 추가 (biz-inventory-crawler) | OK (68061cb) |
| 2026-04-29 | (시스템) | dispatch | settlement implement / 팀 대시보드 / 텔레그램 인프라 | 진행 중 |
| 2026-04-29 | 재고 크롤러 | audit | 현 상태 진단 + 개선점 보고서 | 진행 중 |

---

## 🚧 사용자가 직접 할 일

### Supabase SQL Editor에서 실행 필요

블록 ① (이전 세션 가이드 — 아직 안 했으면)
블록 ② (`SubmissionRoute.requestType` + `MonthlySubmissionLog`)
**블록 ③ (오늘 추가 — dealer 분류 컬럼)**:
```sql
ALTER TABLE "UserClient"
  ADD COLUMN IF NOT EXISTS "isSettlementTarget" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isRateTarget"        BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "UserClient_isSettlementTarget_idx" ON "UserClient"("isSettlementTarget");
CREATE INDEX IF NOT EXISTS "UserClient_isRateTarget_idx"        ON "UserClient"("isRateTarget");
```

**텔레그램 인프라 (구현 후 알려줄 사항)**:
- @BotFather에서 봇 생성 → bot token 받기
- 본인 chat ID 확인
- 두 값을 환경변수로 등록 (Vercel)

---

## 🛡 워크플로우 룰

1. verify → QA → implement → QA → 푸시 (5단계)
2. 100% 검증 전 코드 변경 금지
3. 서브에이전트는 자기 메뉴만. 위반 시 DOMAIN_VIOLATION
4. DB 스키마 변경은 사용자용 SQL 가이드 동봉
5. 작업 후 이 파일 갱신
6. 자율 진행 모드: 사용자에게 매번 묻지 않음. 합리적 기본값
7. 대량 병렬 디스패치: 한 번에 4~5건 동시 진행
8. 끝나면 종합 보고서 1방
- 2026-05-18 12:23 | qa-crosscheck | epharms forceResetSync plan | CONDITIONAL_PASS

- 2026-05-21 14:40 | qa-crosscheck | AI처방통계 A/B/C plan (행정확도/N제약사분리/zip다운) | CONDITIONAL_PASS

- 2026-05-24 00:00 | qa-crosscheck | SubmissionRoute ownerId + ParentLinkRequest Plan (7-step) | FAIL
