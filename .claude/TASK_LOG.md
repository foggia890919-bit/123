# 사용자 지시 누적 로그 + 진행 상태

> 사용자가 메인(PM)에게 시킨 업무를 시간순으로 기록.
> 매 라운드마다 갱신. 사용자가 보고서 요청 시 이 파일 + PROGRESS.md 종합해서 답변.

---

## 보고서 요청 시 응답 포맷

```
# 비즈 프로젝트 진행 보고서 — YYYY-MM-DD HH:MM

## 1. 사용자가 지시한 업무 (시간순)
| 시각 | # | 요약 | 담당 Dev | 상태 | 변경된 메뉴/페이지 |

## 2. 처리 완료
| 작업 | 담당 | 라인수 | 메뉴 |

## 3. 처리 중 (백그라운드)
| 작업 | 담당 | 진행도 |

## 4. 기여도 그래프 (이번 라운드 추가 라인 기준)
```
Dev3 요율    ████████████████ 1,479 (45%)
PM 메타       ████████████ 1,000 (30%)
...
```

## 5. 사용자 본인이 처리할 일
- 🔐 권한/자격증명 / 📋 의견 / 💾 SQL / 🌐 외부 셋업

## 6. 변경된 메뉴 / 페이지 / 파일
- 메뉴 이동/신설 / 페이지 추가 / API 추가 / DB 변경

## 7. 다음 24시간 큐 + 토큰 예상
- ...
```

### 막대그래프 그리기 규칙
- 단위: 추가된 코드 라인 수 (git diff `+` 카운트, 가장 객관적인 기여 지표)
- 단계: `█` = 100라인. 100라인 미만은 `▏▎▍▌▋▊▉` 분수 단계로 표현
- 정렬: 라인수 내림차순
- 백분율: 라운드 전체 추가 라인 합 대비
- 0인 Dev도 표시 (대기/안정 상태 가시화)

---

## 📋 사용자 지시 누적 (최신이 위)

| 시각 (KST) | # | 요약 | 상태 | 영향 메뉴/페이지 |
|---|---|---|---|---|
| 2026-04-29 21:15 | 12 | 누적 보고서 포맷 정립 + 변경 메뉴 표기 요청 | ✅ 적용됨 (이 파일) | (메타) |
| 2026-04-29 21:05 | 11 | Dev7 검색엔진 추가 + 동일성분 매칭 정밀도 개선 + 통합검색 재고 머지 | 🔄 진행 중 (background) | 통합검색, /api/medications |
| 2026-04-29 20:55 | 10 | Dev6 크롤러 P0 fixes + 통합검색 재고 표시 end-to-end (10시간 데드라인) | 🔄 진행 중 (background) | /biz/inventory-status (신설), worker/, src/scrapers/, /api/cron/* |
| 2026-04-29 20:50 | 9 | 자러 가는 동안 5개 병렬 진행 + 마지막에 종합 보고서 1방 | ✅ 진행 중 (5개 dispatched) | (운영 모드) |
| 2026-04-29 20:35 | 8 | 텔레그램 디제스트 인프라 (매일 9시 KST 발송 + webhook 답변) | 🔄 진행 중 (background) | /api/cron/biz-digest, /api/telegram/{send,webhook} (신설) |
| 2026-04-29 20:30 | 7 | 팀 상태 시각화 대시보드 + 작업 마감 카운트다운 | 🔄 진행 중 (background) | /biz/team-status (신설) |
| 2026-04-29 20:20 | 6 | Dev6 재고 크롤러 추가 + 크롤러 엔진 감사 + 개선점 보고 | ✅ 감사 완료, 수정은 #10 진행 중 | worker/, src/scrapers/ |
| 2026-04-29 20:10 | 5 | 자율 진행 모드 + 보고는 매일 9시 텔레그램 디제스트로 | ✅ 적용 (ORCHESTRATION.md v2) | (메타) |
| 2026-04-29 20:00 | 4 | 거래처 등록 마스터 룰: 병의원/딜러 2곳만. 다른 메뉴는 읽기만 | ✅ 적용 (SHARED_RULES.md) | (전역 룰) |
| 2026-04-29 19:55 | 3 | 정산 업로드: 드롭다운 제거 → dealer 마스터에서 행-나열 + 업로드일/파일명 표시 + Dealer 페이지에 정산/요율 분류 탭 | ✅ 정산 implement 완료 / Dealer 완료 / 요율 implement 진행 중 | /biz/dealers, /biz/settlement/upload, /biz/rates |
| 2026-04-29 19:30 | 2 | 비즈 메뉴 5개 그룹 재편 (유저/통계제출처/요율/정산/필터링) + 요율 페이지 신설 + 사용설명서 | ✅ 메뉴 재편 푸시됨 (1c7e4af) / 요율 페이지 implement 진행 중 | /biz 사이드 메뉴 전체, /biz/rates (placeholder→실제) |
| 2026-04-29 18:50 | 1 | 5개 메뉴별 에이전트 + QA 에이전트로 팀 구성. PM은 메인. 매뉴얼대로 검증→코딩 | ✅ 적용 (.claude/agents/*) | (메타) |
| 2026-04-29 18:30 | 0 | 제출현황 탭 UI 구현 + 신규/이관 분류 + 월별 제출 체크 + ZIP 미매핑 그룹 | ✅ 푸시 완료 (42fd358) | /biz/submission-routes |

---

## 🚧 사용자 본인이 처리할 일 (최종 정리 — 깨어나신 후)

### 🌐 1순위 — PR 머지 (이거 먼저 해야 사이트에 변경 반영)
- **PR #9**: https://github.com/foggia890919-bit/123/pull/9
- base = `claude/plan-service-project-Ea4Bn` (default branch)
- 머지하면 Vercel 자동 빌드 → `https://123-nine-lyart.vercel.app` 5-10분 후 반영

### 💾 2순위 — Supabase SQL 7블록 실행
SQL Editor에서 아래 마이그레이션 파일 내용 복사·붙여넣기 (이미 실행한 ①·② 제외):
- ✅ 블록 ① 기존 스키마 (코드·SubmissionRoute·CoPromotion·CorpCompanyRate)
- ✅ 블록 ② `SubmissionRoute.requestType` + `MonthlySubmissionLog`
- ⏳ 블록 ③ `prisma/migrations/manual/add_dealer_classification.sql` (UserClient 분류 컬럼)
- ⏳ 블록 ④ `prisma/migrations/manual/add_corp_rate_files.sql` (요율표 + 이력)
- ⏳ 블록 ⑤ `prisma/migrations/manual/add_agent_activity.sql` (팀 대시보드)
- ⏳ 블록 ⑥ `prisma/migrations/manual/add_telegram_digest.sql` (디제스트 큐 + 답변)
- ⏳ 블록 ⑦ `prisma/migrations/manual/add_inventory_integrity.sql` (재고 멱등성)

전부 `IF NOT EXISTS` 패턴이라 두 번 실행해도 안전.

### 🌐 3순위 — Supabase Storage
- 버킷 `biz-rate-files` 생성 (**Private**, 50MB 제한)

### 🌐 4순위 — Vercel 환경변수 4개 등록
| 변수명 | 값 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather에서 받은 봇 토큰 |
| `TELEGRAM_CHAT_ID_BIZ` | 본인 chat ID (api.telegram.org/bot<토큰>/getUpdates에서 확인) |
| `TELEGRAM_WEBHOOK_SECRET` | 무작위 32자 (openssl rand -hex 32) |
| `CRON_SECRET` | 무작위 문자열 (Vercel cron 인증용) |

자세한 셋업은 `docs/TELEGRAM_SETUP.md` 6단계 따라하세요. 끝나면 다음 09:00 KST부터 자동 일일 보고서 텔레그램 발송.

### 📋 5순위 (선택) — 인천약품 활성화
- `.env`에 `INCHUN_ID`, `INCHUN_PW` 설정
- `tsx src/scrapers/inspect.ts inchun 643703630` 실행
- `/tmp/inchun-*` 또는 `debug/inchun/` 캡처 확인 → 로그인 성공 시
- `src/scrapers/adapters/index.ts`의 `DISABLED_SITES`에서 `"inchun"` 제거 → 통합검색에 인천 데이터 노출

### ✅ 자동으로 풀리는 것 (사용자 액션 불필요)
- 머지 후 Vercel 빌드 → 모든 신규 페이지 활성
- Cron 첫 실행 → 재고 크롤링 정상 적재 (블록 ③·⑦ SQL 실행 후)
- 다음 09:00 KST → 텔레그램 일일 보고서 (4순위 끝난 후)

---

## 📊 변경된 메뉴 / 페이지 / 파일 (누적)

### 메뉴 구조 변화
- **이전**: 거래처/유저 / 정산 / 제약사·제품 / 필터링 (4그룹)
- **현재**: 거래처/유저 / 통계제출처 / 요율 / 정산 / 필터링 (5그룹)
- 추가 예정: 운영 모니터링 (팀 상태 대시보드)

### 페이지 신설
- `/biz/rates` — 요율 업데이트 (구현 진행 중)
- `/biz/team-status` — 팀 에이전트 상태 (구현 진행 중)
- `/biz/inventory-status` — 크롤러 어드민 (구현 진행 중)

### 페이지 대폭 개편
- `/biz/submission-routes` — 3탭 (목록/사업자등록증현황/월별제출체크), 신규/이관, 미매핑
- `/biz/dealers` — 분류 탭 (전체/정산대상/요율대상), 인라인 정산/요율 토글
- `/biz/settlement/upload` — 드롭다운 제거 → 행-나열 + 업로드일/파일명/다운로드

### API 신설
- `/api/submission-routes/{check,download,monthly}` ✅
- `/api/biz-rates/{route,[id],download/[id],history,history/export}` (구현 중)
- `/api/settlement/documents/download` ✅
- `/api/team-status` (구현 중)
- `/api/cron/biz-digest`, `/api/telegram/{send,webhook}` (구현 중)
- `/api/inventory/...` 보강 (구현 중)

### DB 모델 추가
- `MonthlySubmissionLog`, `SubmissionRoute.requestType`
- `UserClient.isSettlementTarget`, `UserClient.isRateTarget`
- `CorpRateFile`, `CorpRateFileHistory` (구현 중)
- `AgentActivity` (구현 중)
- `BizDigestQueue`, `TelegramReply` (구현 중)
- `InventorySnapshot` 유니크 제약 + WholesaleSite upsert 로직 (구현 중)

---

## 👥 현재 팀 (8명)

| # | 역할 | 담당 |
|---|---|---|
| 🎩 PM | 메인 (Opus 4.7) | 라우팅·검증·보고 |
| 👨‍💼 Dev1 | biz-user-mgmt | 거래처/유저 관리 |
| 👩‍💼 Dev2 | biz-submission-routes | 통계제출처 |
| 👨‍🔧 Dev3 | biz-rates-mgmt | 요율 |
| 👩‍💻 Dev4 | biz-settlement | 정산 |
| 👨‍💻 Dev5 | biz-filtering | 필터링 |
| 🤖 Dev6 | biz-inventory-crawler | 재고 크롤러 |
| 🔍 Dev7 | biz-search-engine | 통합검색·매칭 |
| 🕵️ QA | biz-qa-crosscheck | 교차검증 |

---

## 🔄 현재 백그라운드 진행 중 (5건)

1. Dev3 — 요율 페이지 implement (CorpRateFile + 5개 API + UI)
2. Dev4 — 정산 implement ✅ 완료 (커밋 대기)
3. (메타) — 팀 상태 대시보드 build
4. Dev6 — 크롤러 P0 fixes + 통합검색 재고 표시 end-to-end (10h 데드라인)
5. Dev7 — 검색엔진 동일성분 매칭 정밀화 (10h 데드라인)
6. (메타) — 텔레그램 디제스트 인프라

(6건 — 사용자가 "5개 병렬"이라 했는데 디스패치 후 추가 요청 들어와서 6건으로 늘었음)
