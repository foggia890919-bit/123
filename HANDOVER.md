# HANDOVER — 네이버 매출 자동화 (claude/naver-sales-automation-VKAMr)

> **세션 시작 시 첫 액션**: 이 파일을 끝까지 읽고 → 「현재 상태」 검증 → 「다음 액션」 시작.
> **세션 종료 시 의무**: 이 파일을 갱신하고 커밋·푸시한 뒤 종료.

---

## 어디서 무엇이 돌고 있나

| 항목 | 값 |
|---|---|
| 리포 | `https://github.com/foggia890919-bit/123` |
| 브랜치 | `claude/naver-sales-automation-VKAMr` |
| 실행 호스트 | AWS Lightsail (1GB RAM, `/home/ubuntu/sales/simple`) |
| cron | 매일 08:00 `run.ts` + 매분 `scheduler.ts` |
| 시트 | Google Sheets (탭: 주문원본, 옵션매핑, 일일집계, 자동화, 검색량조회, …) |
| 알림 | 텔레그램 |
| 마지막 커밋 | `90eb05a` feat(simple): 체크박스 트리거 지원 |

`simple/` 가 라이브 시스템 본체. `src/app/...` 는 별개 Next.js 프로젝트(이 브랜치 무관).

## 핵심 파일 위치

- `simple/run.ts` — 매출 보고 (어제 + 7일 롤링, 백필)
- `simple/scheduler.ts` — 시트 「자동화」 탭 1분 폴링 + lock file
- `simple/catalog.ts` — 상품 카탈로그 (Lightsail 1GB 에서 OOM 위험)
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
- 90eb05a 푸시까지 완료

### ❌ 막힌 곳

**1. 시트 체크박스가 자동으로 안 생긴다**
- 증상: `scheduler.ts` 가 「자동화」 탭에 작업 행은 등록하지만, B열에 체크박스 데이터 검증을 박지 않음
- 원인 추정: `ensureTasks()` 에서 `writeRange` 로 빈 문자열만 쓰고 있음 (scheduler.ts:72). Sheets API 의 `setDataValidation` 또는 `addDataValidation` 호출 누락
- 워크어라운드: 사장님이 시트 메뉴 「삽입」 → 「체크박스」 수동 추가

**2. 검색량 조회 중 ~1분 시점에 멈춤 (의심: 타임아웃)**
- 증상: `volume.ts` 일부 키워드 처리 후 에러로 종료
- 원인 *미확인*. 가설:
  - (a) scheduler.ts 가 1분 cron 인데 작업이 1분 넘으면 lock 충돌 후 강제 종료? — 그런데 `execSync` timeout 은 90분(scheduler.ts:134) 이라 모순
  - (b) 네이버 검색광고 API 자체 rate limit / per-request timeout
  - (c) Lightsail 1GB OOM
- **금지**: 추측만으로 코드 수정 X. 다음 세션에서 정확한 에러 메시지·스택·실행 시각 먼저 확보.

### ⏸ 미확인 (사장님 액션 대기)
- `bash scripts/install-cron.sh` 결과 + `crontab -l` 출력 확인 안 됨
- cron 2줄(매일 8시 run + 매분 scheduler) 다 등록됐는지 검증 필요

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

1. **install-cron.sh 결과 확인** — 사장님이 Lightsail SSH 에서 한 줄 실행 후 출력 첨부:
   ```
   cd ~/sales/simple && git pull && bash scripts/install-cron.sh && crontab -l
   ```
2. **체크박스 자동 생성 구현** — `simple/sheets.ts` 에 `setCheckboxValidation(range)` 헬퍼 추가 후 `scheduler.ts:ensureTasks()` 에서 B열에 적용. Sheets API `batchUpdate` + `setDataValidation` 사용
3. **검색량 조회 타임아웃 원인 추적** — 추측 X. 다음 실행 시:
   - 에러 메시지 전문
   - `console.log` 로 처리 키워드 번호/시각
   - Lightsail `free -m` 메모리 상태
   - 그 후에야 수정 방향 결정

---

## 작업 흐름 (세션 끊김 대응)

이 브랜치는 **claude.ai 원격 에이전트**가 돌리고 있어서 `--resume` 이 없습니다. 세션 끊기면 컨텍스트 통째로 날아갑니다. 그래서:

1. **세션 시작 시**: 이 HANDOVER.md 를 먼저 읽고 `git log --oneline -10` 으로 최근 커밋 확인
2. **작업 단위는 작게**: 한 사이클(작업 → 검증 → 커밋·푸시) 안에 끝낼 수 있는 크기로
3. **세션 종료 시**: 이 HANDOVER.md 의 「현재 상태」, 「다음 액션」 업데이트 후 푸시
4. **연속성 중요 작업**은 로컬 Claude Code (`C:\Users\김성준\sales`) 로 — `claude --resume` 가능
