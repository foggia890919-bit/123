# HANDOVER — 네이버 매출 자동화 (claude/naver-sales-automation-VKAMr)

> **세션 시작 시 첫 액션**: 이 파일을 끝까지 읽고 → 「현재 상태」 검증 → 「다음 액션」 시작.
> **세션 종료 시 의무**: 이 파일을 갱신하고 커밋·푸시한 뒤 종료.

---

## 어디서 무엇이 돌고 있나

| 항목 | 값 |
|---|---|
| 리포 | `https://github.com/foggia890919-bit/123` |
| 브랜치 | `claude/naver-sales-automation-VKAMr` |
| 실행 호스트 | AWS Lightsail 인스턴스 `Ubuntu-1` (2GB RAM, 2 vCPU, 60GB SSD, Seoul Zone A, **정적 IP `52.79.198.61`** `StaticIp-2`) — 2026-05-12 업그레이드·정적 IP 설정 완료 |
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

### ✅ 추가로 해결된 사고 (2026-05-12)
- ~~검색량 429~~ — volume.ts 의 150개 단건 PUT → `values:batchUpdate` 1회로 묶어 해결, 검증 완료
- ~~catalog 일부 스토어 IP 막힘~~ — 정적 IP `52.79.198.61` 설정 + 3개 스토어 (여기명품/비타앤오리진/와이케이팜) 화이트리스트 등록 완료

### 🟡 진행 중
- **시장 카테고리 트리** 실행 중 — 네이버 DataLab 카테고리 스크래핑 (수만 행). 끝나면 「시장조사_카테고리」 시트 자동 생성

### 다음 작업 (사장님 액션 필요)
1. **시장 카테고리 트리 완료 대기** → 「시장조사_카테고리」 시트 생성 확인 → F열 「추적」 에 모니터링할 카테고리에 'o' 표시
2. **시장 키워드 (Top500)** ☑ → 추적 카테고리만 Top500 키워드 → 「시장조사_키워드」 생성
3. **시장 규모** ☑ → 「시장조사_시장규모」 생성 (5초/키워드, 100개 = 8분)
4. **순위 추적** ☑ → 「순위추적_상품」 빈 시트 생성 → 사장님이 productId/라벨/추적키워드 입력 → 다시 ☑ → 「순위추적_데이터」 생성

### 정리할 거 (여유 있을 때)
- **install-cron.sh 정리** — `crontab -l` 헤더 주석 8중 중복 (동작 무관)
- **스냅샷 정리** — `naver-sales-1778469786` 며칠 후 삭제 (월 $0.5 절약)
- **시트 stale ERROR 정리** — 「자동화」 탭 2,6~10행의 11:56 ERROR 텍스트 셀 수동 삭제 (선택)
- **catalog 재검증** — 화이트리스트 등록 후 catalog ☑ 1번 더 클릭해서 scheduler.log 에 「여기명품」「비타앤오리진」「와이케이팜」 모두 OK 인지 확인

---

## 작업 흐름 (세션 끊김 대응)

이 브랜치는 **claude.ai 원격 에이전트**가 돌리고 있어서 `--resume` 이 없습니다. 세션 끊기면 컨텍스트 통째로 날아갑니다. 그래서:

1. **세션 시작 시**: 이 HANDOVER.md 를 먼저 읽고 `git log --oneline -10` 으로 최근 커밋 확인
2. **작업 단위는 작게**: 한 사이클(작업 → 검증 → 커밋·푸시) 안에 끝낼 수 있는 크기로
3. **세션 종료 시**: 이 HANDOVER.md 의 「현재 상태」, 「다음 액션」 업데이트 후 푸시
4. **연속성 중요 작업**은 로컬 Claude Code (`C:\Users\김성준\sales`) 로 — `claude --resume` 가능
