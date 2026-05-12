# HANDOVER — 네이버 매출 자동화 (claude/naver-sales-automation-VKAMr)

> **세션 시작 시 첫 액션**: 이 파일을 끝까지 읽고 → 「현재 상태」 검증 → 「다음 액션」 시작.
> **세션 종료 시 의무**: 이 파일을 갱신하고 커밋·푸시한 뒤 종료.

---

## 어디서 무엇이 돌고 있나

| 항목 | 값 |
|---|---|
| 리포 | `https://github.com/foggia890919-bit/123` |
| 브랜치 | `claude/naver-sales-automation-VKAMr` |
| 실행 호스트 | AWS Lightsail 인스턴스 `Ubuntu-1` (2GB RAM, 2 vCPU, 60GB SSD, Seoul Zone A, **3.35.13.72**) — 2026-05-12 업그레이드 완료 |
| cron | 매일 08:00 `run.ts` + 매분 `scheduler.ts` |
| 시트 | Google Sheets (탭: 주문원본, 옵션매핑, 일일집계, 자동화, 검색량조회, …) |
| 알림 | 텔레그램 |
| 마지막 커밋 | `90eb05a` feat(simple): 체크박스 트리거 지원 |

`simple/` 가 라이브 시스템 본체. `src/app/...` 는 별개 Next.js 프로젝트(이 브랜치 무관).

## 핵심 파일 위치

- `simple/run.ts` — 매출 보고 (어제 + 7일 롤링, 백필)
- `simple/scheduler.ts` — 시트 「자동화」 탭 1분 폴링 + lock file
- `simple/catalog.ts` — 상품 카탈로그 (Lightsail 512MB 에서 OOM 위험)
- `simple/volume.ts` — 키워드 검색량 (시트 「검색량조회」 탭)
- `simple/market.ts` — 시장 카테고리/Top500/규모/순위
- `simple/audit.ts` — 정산 차감 추적
- `simple/sheets.ts` — Google Sheets 헬퍼
- `simple/scripts/install-cron.sh` — cron 자동 등록 + 중복 정리

---

## 현재 상태 (2026-05-11)

### ✅ 작동 확인
- 검색량 조회 (`volume.ts`) — 헬렌카민스키 107,600회 등 시트에 박힘
- scheduler.ts 트리거 인식 — GO/실행/TRUE(체크박스) 다 처리
- 체크박스 자동 생성 검증 완료 (B열 7개, DATE_* 행 제외) ✓

### ✅ 해결된 사고 (2026-05-11 → 2026-05-12)
- catalog OOM: 512MB 인스턴스에서 catalog.ts 가 메모리 부족으로 SIGKILL → 2GB 인스턴스 업그레이드로 해결
- 2026-05-12 19:49 catalog.ts OK 완주 확인
- 부수적으로 발견·수정한 버그: scheduler.ts 의 RUNNING 칼럼 오인식 + FALSE 트리거 차단 (c51dce1 까지 푸시)

### ❌ 막힌 곳

**1. 검색량 조회 중 ~1분 시점에 멈춤 (의심: 타임아웃)** ← 유일하게 남은 코드 이슈
- 증상: `volume.ts` 일부 키워드 처리 후 에러로 종료
- 원인 *미확인*. 가설(검증 전):
  - (a) scheduler.ts 가 1분 cron 인데 작업이 1분 넘으면 lock 충돌? — `execSync` timeout 은 90분(scheduler.ts:141) 이라 모순
  - (b) 네이버 검색광고 API 자체 rate limit / per-request timeout
  - (c) Lightsail 512MB OOM
- **금지**: 추측만으로 코드 수정 X. 다음 세션에서 정확한 에러 메시지·스택·실행 시각·메모리 상태 먼저 확보.

### ⏸ 사장님 액션 대기

**A. 체크박스 자동 생성 검증** (이번 세션 산출물)
1. `cd ~/sales/simple && git pull` (Lightsail)
2. 1분 안에 scheduler 가 한 번 돌아감 — 시트 「자동화」 탭 B열 (GO 행들) 체크박스 자동 생성 확인
3. 안 보이면 콘솔 로그 `/home/ubuntu/scheduler.log` 에서 `[scheduler] 체크박스 설정 실패` 메시지 확인

**B. `bash scripts/install-cron.sh` 결과** (이전 세션부터 미확인)
- 한 줄: `cd ~/sales/simple && git pull && bash scripts/install-cron.sh && crontab -l`
- cron 2줄(매일 8시 run + 매분 scheduler) 다 등록됐는지 확인

**C. 검색량 타임아웃 — 다음 실행 시 수집할 데이터**
- 에러 메시지 전문 + 스택
- `volume.ts` 처리 키워드 번호/시각 (현재 console.log 부족하면 임시 추가)
- 실행 중 `free -m` 출력

---

## 사용자 결정사항 (변경 시 여기 업데이트)

- GO 텍스트 입력 대신 **체크박스 UX** 로 전환 (확정)
- catalog OOM 은 별도 트랙 — 인스턴스 업그레이드 또는 catalog 분할 (보류)
- `simple/` 디렉터리가 라이브 본체 — `src/app/...` Next.js 와 분리

## 작업 규칙 (사용자 합의)

- **추측 기반 코드 변경 금지** — 가설로 수정 누적 X, 진단·로그·데이터 먼저
- **자율 진행** — 큰 방향 합의되면 세부 단계는 묻지 말고 실행
- **git push 는 사용자 본인 터미널에서** — Claude 는 add/스테이징까지만, commit·push 는 사장님이 cmd.exe 에서
- **`cd` 금지** — `git -C "<path>"` 로 직접 실행

---

## 다음 액션 (우선순위 순)

### ✅ 완료된 액션 (2026-05-11 ~ 12)
- ~~catalog OOM 사고 정리~~ (시트 정리 + lock 제거 + 코드 fix 푸시)
- ~~Lightsail 512MB → 2GB 업그레이드~~ — 스냅샷 → 새 `Ubuntu-1` 생성 (3.35.13.72) → 기존 `naver-sales` 삭제
- ~~catalog.ts 작동 검증~~ — 2GB 에서 OOM 없이 OK 완주 확인

### 🔧 진행 중 — 검색량 429 fix (2026-05-12)
- 증상: volume.ts 가 150개 키워드 처리 후 시트에 쓸 때 Google Sheets API 429 `RATE_LIMIT_EXCEEDED` (분당 60 write 한도 초과)
- 원인: `volume.ts:180~185` 가 150개 행을 *한 행씩* PUT → 150번 HTTP 요청
- 수정: `values:batchUpdate` 로 한 번의 HTTP 요청으로 묶음 (quota 1회만 소비)
- 푸시 대기. 푸시 후 Lightsail pull → 시트에서 「키워드 검색량 갱신」 재시도

### 🚨 부수로 발견된 별개 문제 — catalog 의 일부 스토어 API IP 막힘
- catalog.ts 로그: `여기명품` `와이케이팜` 두 스토어 → `GW.IP_NOT_ALLOWED` (403)
- 원인: 새 인스턴스 IP `3.35.13.72` 가 네이버 커머스 API IP 화이트리스트에 미등록 (기존 `43.203.82.234` 만 등록돼있던 것)
- 영향: catalog 가 OK 로 끝났지만 두 스토어 데이터는 실제로 못 가져옴 — 사장님이 미인지 가능성
- 해결책 두 가지:
  - (1) 네이버 커머스 API 콘솔에서 새 IP `3.35.13.72` 화이트리스트 추가
  - (2) Lightsail 정적 IP 붙여서 IP 고정 → 향후 인스턴스 교체 시 동일

### 다음 작업 (우선순위 미정)
1. **검색량 429 fix 푸시 + 재시도** — 위 진행 중 항목
2. **catalog IP 화이트리스트 해결** — 위 별개 문제 (1)·(2) 중 사장님 결정
3. **시장 작업** — 「시장 카테고리 트리」 부터 시작 → 「시장조사_카테고리」 시트 F열에 추적할 카테고리 'o' 표시 → 「시장 키워드」 → 시장규모/순위추적
4. **install-cron.sh 정리** — `crontab -l` 헤더 주석 8중 중복 (동작 무관)
5. **스냅샷 정리** — `naver-sales-1778469786` 스냅샷 며칠 후 삭제 (월 $0.5 절약)

---

## 작업 흐름 (세션 끊김 대응)

이 브랜치는 **claude.ai 원격 에이전트**가 돌리고 있어서 `--resume` 이 없습니다. 세션 끊기면 컨텍스트 통째로 날아갑니다. 그래서:

1. **세션 시작 시**: 이 HANDOVER.md 를 먼저 읽고 `git log --oneline -10` 으로 최근 커밋 확인
2. **작업 단위는 작게**: 한 사이클(작업 → 검증 → 커밋·푸시) 안에 끝낼 수 있는 크기로
3. **세션 종료 시**: 이 HANDOVER.md 의 「현재 상태」, 「다음 액션」 업데이트 후 푸시
4. **연속성 중요 작업**은 로컬 Claude Code (`C:\Users\김성준\sales`) 로 — `claude --resume` 가능
