# HANDOVER — 네이버 매출 자동화 (claude/naver-sales-automation-VKAMr)

> **세션 시작 시 첫 액션**: 이 파일을 끝까지 읽고 → 「현재 상태」 검증 → 「다음 액션」 시작.
> **세션 종료 시 의무**: 이 파일을 갱신하고 커밋·푸시한 뒤 종료.

---

## 어디서 무엇이 돌고 있나

| 항목 | 값 |
|---|---|
| 리포 | `https://github.com/foggia890919-bit/123` |
| 브랜치 | `claude/naver-sales-automation-VKAMr` |
| 실행 호스트 | AWS Lightsail 인스턴스 `naver-sales` (512MB RAM, 2 vCPU, 20GB SSD, Seoul Zone A, 43.203.82.234) — 업그레이드 대상 |
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

### 🚨 발생한 사고 (2026-05-11 catalog OOM)
- 「상품 카탈로그 갱신」 시작 후 ~7분 시점에 Linux OOM 킬러가 catalog.ts 강제 종료
- `Killed` 시그너처 + `/home/ubuntu/scheduler.log` 의 lock 600초+ 까지 skip 누적이 증거
- SIGKILL 때문에 `finally { unlinkSync(LOCK_FILE) }` 안 돌아서 `/tmp/sales-scheduler.lock` stale 상태
- 시트 5행: B5=TRUE, C5=RUNNING 박힌 채 멈춤
- 추가로 발견된 코드 버그: `scheduler.ts:113` 의 RUNNING 체크가 잘못된 칼럼(B) 을 보고 있어서 2시간 후 stale lock 자동 제거되면 무한 OOM 루프 위험. 한 줄 수정 완료(C열 보도록 변경) + 푸시 대기.

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

### 🚑 긴급 — catalog OOM 사고 정리 (사장님 직접)

**순서대로**:
1. 시트 「자동화」 탭 5행:
   - B5 체크박스 클릭 해제 (☑ → ☐)
   - C5 「RUNNING」 텍스트 삭제 (셀 비우기)
2. Lightsail SSH:
   ```
   rm /tmp/sales-scheduler.lock
   cd ~/sales/simple && git pull   # 버그 수정 반영
   ```
3. 1분 기다린 후 시트 확인 — scheduler.log 에 lock skip 메시지 끊겨야 정상

### 결정됨 — (A) Lightsail 512MB → 2GB 업그레이드
- 대상 인스턴스: `naver-sales` (Seoul Zone A, 43.203.82.234)
- 결정 사유: 시간 절약 + 다른 무거운 작업(market.ts tree, volume.ts) 도 같은 위험 → RAM 여유가 의사결정 자유도 증가
- 비용: 월 $3.50 → $12 수준 (512MB nano → 2GB 등급)
- 참고: 같은 계정에 별개 인스턴스 `inventory-worker` (13.125.11.218) 있는데 이번 업그레이드 대상 아님
- 절차: 스냅샷 → 2GB plan 으로 새 인스턴스 생성 → 정적 IP 재할당 (또는 SSH 접속 정보 갱신) → 검증 후 구 인스턴스 삭제

### 보류 중
- **검색량 조회 타임아웃** — 에러 로그·메모리 상태 확보 후 다음 세션에서 진단 (추측 금지)
- **시장 작업 검증** — catalog 정리 후 「시장 카테고리 트리」 부터 단계별 진행 (의존 순서: 트리 → 추적 표시 → 키워드 → 규모/순위)

---

## 작업 흐름 (세션 끊김 대응)

이 브랜치는 **claude.ai 원격 에이전트**가 돌리고 있어서 `--resume` 이 없습니다. 세션 끊기면 컨텍스트 통째로 날아갑니다. 그래서:

1. **세션 시작 시**: 이 HANDOVER.md 를 먼저 읽고 `git log --oneline -10` 으로 최근 커밋 확인
2. **작업 단위는 작게**: 한 사이클(작업 → 검증 → 커밋·푸시) 안에 끝낼 수 있는 크기로
3. **세션 종료 시**: 이 HANDOVER.md 의 「현재 상태」, 「다음 액션」 업데이트 후 푸시
4. **연속성 중요 작업**은 로컬 Claude Code (`C:\Users\김성준\sales`) 로 — `claude --resume` 가능
