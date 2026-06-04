# HANDOVER — 네이버 매출 자동화 (claude/naver-sales-automation-VKAMr)

> **세션 시작 시 첫 액션**: 이 파일 끝까지 읽고 → 「현재 상태」 검증 → 「다음 액션」 진행.
> **세션 종료 시 의무**: 이 파일 갱신·커밋·푸시 후 종료.

---

## 인프라

| 항목 | 값 |
|---|---|
| 리포 | `https://github.com/foggia890919-bit/123` |
| 브랜치 | `claude/naver-sales-automation-VKAMr` |
| 실행 호스트 | AWS Lightsail `Ubuntu-1` (2GB RAM, 2 vCPU, 60GB SSD, Seoul Zone A, **정적 IP `52.79.198.61`**) |
| cron | 매일 08:00 `run.ts` (매출) / 08:01 `inventory-report.ts` (재고) / 매분 `scheduler.ts` (자동화 폴링) |
| 시트 | Google Sheets (「매출보고_네이버」, 「여기명품 사입관리」, 「B2C 재고장」) |
| 알림 | 텔레그램 + **카카오톡(나에게 보내기)** |

`simple/` = 라이브 본체. `src/app/...` Next.js 는 무관.

## 핵심 파일

| 파일 | 역할 |
|---|---|
| `simple/run.ts` | 매출 보고 + 이익 계산 (텔레그램 + 시트 갱신) |
| `simple/scheduler.ts` | 시트 「자동화」 탭 매분 폴링 + lock + STOP 트리거 |
| `simple/catalog.ts` | 상품 카탈로그 수집 (네이버 커머스 API → 「상품목록」) |
| `simple/volume.ts` | 키워드 검색량 (네이버 검색광고 API → 「검색량조회」) |
| `simple/market.ts` | 시장조사: 카테고리 트리/Top500/규모/순위 |
| `simple/inventory-report.ts` | 재고 보고 (B2C 재고장 → 「⭐재고이력」 + 텔레그램) |
| `simple/audit.ts` | 정산 차감 추적 |
| `simple/sheets.ts` | Google Sheets API 헬퍼 (write retry, 체크박스/날짜 picker, ...) |
| `simple/scripts/install-cron.sh` | cron 자동 등록 |

## 외부 의존 시트 (별도 스프레드시트, 서비스 계정 공유 필요)

| 시트 | 용도 | 컬럼 |
|---|---|---|
| 「여기명품 사입관리」 (`10DgfEqudeXOBmFFm8vyOHHuHJp6nZXKaxv4ecpbVhno`, gid=30917428) | 여기명품 매입원가 매핑 | AD=상품주문번호, AB=도매가+배송비+박스비 통합 |
| 「B2C 재고장_찐」 (`1tVzl0Av8sfo0uJgDmrb-adC71bLjdP6eAompkRwDXCU`, gid=303888745) | 재고 보고 데이터 | D=SEASON("반품" 포함 행 분리), AA=현재고수량, AF=현재고금액 |

→ 두 시트 모두 `.env` 의 `GOOGLE_SERVICE_ACCOUNT_EMAIL` 에 *편집자(또는 뷰어)* 권한 공유 필요.

## 환경변수 (`.env` 주요)

- `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `NAVER_STORES_JSON` (3개 스토어: 비타앤오리진, 여기명품, 와이케이팜)
- `NAVER_AD_API_KEY`, `NAVER_AD_SECRET`, `NAVER_AD_CUSTOMER_ID` (검색광고 — 검색량/시장 키워드)
- `NAVER_DEVELOPER_CLIENT_ID`, `NAVER_DEVELOPER_CLIENT_SECRET` (검색 API — 순위 추적)
- `NAVER_SHOPPING_COOKIE` (선택 — 시장 규모 작업용 봇 차단 우회. 미설정 시 HTTP 418. Chrome F12 → search.shopping.naver.com 쿠키 통째 복사)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_REFRESH_TOKEN` (카카오톡 나에게보내기. refresh_token 으로 access 갱신, 새 refresh 내려오면 `simple/.kakao_refresh` 에 자동저장 → `.gitignore` 처리됨)

---

## 카카오톡 보고 (2026-06 추가)

매일 cron(08:00) `run.ts` 가 **텔레그램 + 카카오톡 동시 발송**. 카카오는 `buildKakaoMessages()` + `sendKakao()` (토큰 `getKakaoAccessToken()` 이 refresh→access 갱신).

- 카카오 앱: 카카오 디벨로퍼스 "나에게보내기" (앱 ID `1476964`), Redirect URI `https://localhost`, scope `talk_message`. REST API 키 `efd52dae1881148fbefcf1254aedaae9`.
- **사업자별 분리** 메시지: `[전체 총합]` → `[비타앤오리진]` → `[여기명품]` → `[와이케이팜]`. 각 스토어 = 키워드별 `건수/개/매출/이익` + 스토어 총합. (단위 "개"로 통일, 이모지 없음 — PC카톡 깨짐 방지)
- **비타앤오리진**: 품종 분류(피쿠알/아르베키나/블렌딩/아보카도오일/레몬즙). 원가 = ⭐옵션매핑 시트값 우선, 없으면 코드 `VITA_COST_BY_KEYWORD`(올리브오일 5200·아보카도 5000·레몬즙 3200/개) + 물류 출고당 4500.
- **여기명품**: keyword = 사입관리 N열(키워드)+Q열(상품옵션) 라벨(AD=상품주문번호 매칭). 매출=네이버, 이익=정산−도매가(AB, 배송비 포함값). 사입 시차분 도매가는 `loadRecentCostByOption`(주문원본 채널+옵션 최근단가)로 추정.
- **배송비**: `deliveryFeeAmount` 전액(멤버십/N배송 무료 할인 `deliveryDiscountAmount` 무시)을 **배송(주문)당 1회** 매출·이익에 반영. 취소건 제외.
- **`매출raw` 탭**: 여기명품 네이버주문을 사입관리 파일(`10Dgf...`)에 자동기록(A=상품주문번호 ~ K=상태). 직원이 VLOOKUP 으로 사입리스트(신)에서 끌어씀. 기존 시트(AD/AE) 안 건드림.

### 미완료 / 주의

- [ ] **와이케이팜 원가** 미설정 → 이익=매출 허수. 품목별 단가 받아 비타앤처럼 코드/시트 설정 필요.
- [ ] **일주일치 보고** 미구현 (사업자별 키워드+총합, 최근 7일).
- [ ] **원가 매핑 정밀화**: 피쿠알 등 ⭐옵션매핑 시트값(5000)이 코드 fallback(5200)보다 우선이라 200원 차이. 시트 매핑 전반 정리 필요(옵션/자동합산/시트값 우선순위 얽힘).
- [ ] **배송비 정산 이중계산 검증**: `expectedSettlementAmount`(정산)에 배송비가 이미 포함됐는지 확인. 포함이면 이익에서 빼야 함.
- `simple/diag-yeogi.ts`, `simple/diag-naver.ts` = 1회용 진단 스크립트(삭제 가능). 여기명품/와이케이팜 네이버키는 **서버 IP만 허용**(로컬 호출 403).

---

## 시트 구조 — 「매출보고_네이버」

| 시트 탭 | 역할 | 비고 |
|---|---|---|
| **자동화** | 작업 트리거 + 상태 (A 작업/B 트리거/C 상태/**D 클릭시점**/E 마지막실행/F 결과/G 결과시트/H ⭐입력시트/**I 끝날짜(범위백필)**) | 사장님 ☑ 클릭으로 작업 실행 |
| 주문원본 | 매출 raw (행별 매출/원가/물류비/이익) | run.ts 갱신 |
| 일일집계 | 키워드별 일일 합산 | run.ts 갱신 |
| 상품목록 | catalog 자동 수집 (12컬럼) | catalog.ts 매번 clear+append |
| **⭐옵션매핑** | 사장님 입력 — 옵션관리번호별 매핑 (A 원본/B 채널/C 옵션관리번호/D 라벨/E 원가/F 물류비/G 유형) | run.ts 가 매칭 |
| 검색량조회 | A4~ 사장님 키워드 입력 → B~F 검색량 자동 | volume.ts |
| 시장조사_카테고리 | DataLab 카테고리 트리 (F열 추적 'o' 표시) | market.ts tree |
| 시장조사_키워드 | Top500 + 검색량 | market.ts keywords (결과) |
| **⭐시장조사_키워드_추적** | A열에 카테고리 코드 입력 | market.ts keywords (입력) |
| 시장조사_시장규모 | Top10/Top40 매출·판매량 | market.ts size (결과) |
| **⭐시장조사_시장규모_추적** | A열에 키워드 입력 | market.ts size (입력) |
| 순위추적_데이터 | 키워드 검색결과 내 순위 시계열 | market.ts rank (결과) |
| **⭐순위추적_상품** | A productId / B 라벨 / C 추적키워드 | market.ts rank (입력) |
| **⭐재고이력** | 날짜별 총재고/반품 누적 (시각화용) | inventory-report.ts |

⭐ 표시 시트 = 사장님 입력 시트.

---

## 작업 규칙 (확정 합의)

- **추측 기반 코드 변경 금지** — 진단·로그·데이터 먼저, 팩트 위에서만 작업
- **자율 진행** — 큰 방향 합의되면 세부 단계 묻지 말고 실행
- **git push 는 사장님 본인 cmd.exe 에서** — Claude 는 add/스테이징까지만
- **`cd` 금지** — `git -C "<path>"` 사용
- **세션 끊김 대응**: 작업 단위 작게 (작업→검증→커밋·푸시 한 사이클), 종료 시 HANDOVER 갱신

---

## 현재 상태 (2026-05-15)

### ✅ 운영 안정 — 모두 작동
- **매출 자동화** (매일 8시 cron): 3개 스토어 매출 보고 + 7일 롤링 + 시트 누적
  - **상품별 매출/원가/이익 표시**: 매핑 누락 즉시 식별 (원가 0원 = ⭐옵션매핑 미입력)
  - **자동합산** 완성 (2026-05-14): 압박스타킹처럼 단품 부위만 입력하면 1+1/조합 자동 계산
    - 옵션 형식 `키: 값 / 키: 값` 정규화 (stripKey)
    - 같은 chNo + 같은 productName 다중옵션 = 메인 합산 (압박스타킹 종아리+허벅지)
    - 같은 chNo + 다른 productName = 추가상품 분리 (피쿠알+레몬즙)
  - **사업자별 텔레그램 메시지 분리** (2026-05-14): 전체 요약 1개 + 사업자별 3개 = 4개 말풍선
    - 상품 행 1~2줄 압축 (헤더 + 한 줄 요약)
    - **옵션별 sub-line**: 한 상품 안의 옵션 2개 이상이면 ↳ 옵션명: 수량·매출·이익 디테일
- **순위 추적 자동화** (매일 9시 cron, 2026-05-14): 네이버 쇼핑 검색 API → ⭐순위추적_누적 시트 (가로 컬럼 누적) + 텔레그램 전일대비
  - 시트: A=productId, B=라벨, C=키워드, D~ = 날짜별 순위 (**최신이 D열 = 왼쪽**, 매일 쓰기 후 날짜 desc 정렬)
  - 텔레그램: 🔼N(상승) / 🔽N(하락) / 🆕진입 / ❌이탈
- **catalog**: 옵션명/추가상품 매핑 완료, OOM 해결, 매번 clear+append
- **검색량 조회**: batchUpdate fix (429 해결)
- **시장 작업 4개** (카테고리 트리/Top500/규모/순위): 입력 시트 분리 + 자동 생성
  - 시장 규모 (Top40 매출) — **사장님 쿠키 박기 대기 중** (2026-05-15). 네이버 쇼핑이 Lightsail IP 봇 차단(HTTP 418). market.ts:buildShoppingHeaders 가 `.env` 의 `NAVER_SHOPPING_COOKIE` 자동 주입. 사장님이 Chrome 쿠키 1회 박으면 부활. 만료 시 (1~2개월) 재발급. 향후 데이터 보려고 인프라는 그대로 유지
- **순위 추적**: 네이버 검색 API + link 에서 채널상품번호 추출 매칭
- **재고 보고** (매일 8:01 cron): B2C 재고장_찐 → ⭐재고이력 누적 + 텔레그램 — 첫 보고 2026-05-14 발송 확인 ✅
  - 비교 데이터 누적 일정: 2026-06-14 부터 당월초(06-01) 비교, 2026-07-14 부터 전월초(06-01)+당월초(07-01) 풀가동
- **여기명품 사입관리 매칭**: 상품주문번호(AD) → 매입원가(AB) 자동 적용
- **자동화 시트 UX**: 체크박스 자동, ⭐ 입력 시트 하이퍼링크, 날짜 picker, STOP 트리거 (모든 ☑/RUNNING 정리)

### 📝 검증 완료 (2026-05-14)
- 와이케이팜 압박스타킹 자동합산 10건 전부 ✅: 원가 146,120원 · 물류 40,000원 · 이익 20,354원
- 부위명 매칭 (종아리/무릎/허벅지) + 1+1/조합 패턴 모두 정상
- 순위 추적 첫 발송 ✅: 올리브오일 2위, ⭐순위추적_누적 D열 갱신 확인
- 사업자별 메시지 분리 + 옵션 sub-line 단일 날짜 실행 정상 동작 확인

### ⏱ 작업별 정상 소요 시간 (기억용)
- **매출 — 어제 + 7일 롤링**: **약 25분** (3 스토어 × 7일 페이지네이션). 14~20분 RUNNING 보여도 정상이니 STOP 누르지 말 것
- 매출 — 단일 날짜: 약 3~5분
- 순위 추적: 키워드당 약 30초

### 🐞 2026-05-14 발견 버그 + fix
- **scheduler race condition**: 사장님 STOP 으로 pkill → 자식 run.ts 가 SIGTERM 받고 죽으면, execSync 의 catch 가 먼저 "❌ Command failed" 박아서 STOP 처리 로직이 그 행을 안 잡고 건너뜀 → 시트에 사장님이 STOP 누른 흔적 안 남음
  - fix: [scheduler.ts:247-259](simple/scheduler.ts:247) — err.signal 이 SIGTERM/SIGKILL 이면 "🛑 STOP 으로 중단됨" 박게
- **sheets API 500 Internal Error 한 번에 작업 실패**: `meta 500` 같은 일시 장애에 writeRange 만 3회 retry, 나머지(meta/append/read/upsert/ensure/clear) 는 retry 없어 한 방에 실패
  - fix: [sheets.ts withRetry](simple/sheets.ts) 헬퍼 추가, 핵심 데이터 처리 흐름의 모든 sheets API fetch 에 적용 (5회 retry, exponential 백오프 1.5/3/6/12s, 4xx 는 즉시 throw)

### ⏸ 사장님 액션 대기

**1. 이번 패치 푸시 + Lightsail pull** (scheduler race fix + sheets API retry 강화)
```
cd C:\Users\김성준\sales
git commit -m "fix(simple): scheduler STOP race condition + sheets API 5회 retry 강화"
git push
```
```
cd ~/sales/simple && git pull
```

**2. Apps Script onEdit 설치 (자동화 D열 클릭시점 기록용)**
- 시트 → 확장 프로그램 → Apps Script → 코드 입력 + 권한 승인
- 코드: B열 체크박스 클릭 시 D열에 KST 시각 자동 박힘
```javascript
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== "자동화") return;
  const col = e.range.getColumn();
  const row = e.range.getRow();
  if (col !== 2 || row < 2) return;
  const value = e.range.getValue();
  if (value === true || (typeof value === "string" && value.trim() !== "" && value !== "FALSE")) {
    const now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    sheet.getRange(row, 4).setValue(now);
  }
}
```

**3. ⭐옵션매핑 시트 사장님 입력**
- 비타앤오리진: 단품 옵션관리번호별 원가 (사장님이 어느 정도 입력함)
- 와이케이팜 압박스타킹: 종아리/무릎/허벅지 사이즈별 단품 행만 (1+1/조합은 자동 합산)
- 매입가 (와이케이팜 압박스타킹):
  - 종아리 8,040원
  - 무릎 9,710원
  - 허벅지 12,650원
  - 물류비 4,000원 (건당)

**4. 「B2C 재고장_찐」 시트 공유 (재고 보고용)** — ✅ 2026-05-14 완료
- URL: `https://docs.google.com/spreadsheets/d/1tVzl0Av8sfo0uJgDmrb-adC71bLjdP6eAompkRwDXCU/edit?gid=303888745`
- 서비스 계정 `sales-bot@bustling-bay-495106-k0.iam.gserviceaccount.com` 편집자 권한 등록됨

**5. 「여기명품 사입관리」 시트 공유 + AD열 상품주문번호 입력 (사입 후 매번)**
- URL: `https://docs.google.com/spreadsheets/d/10DgfEqudeXOBmFFm8vyOHHuHJp6nZXKaxv4ecpbVhno/edit?gid=30917428`
- 사장님이 사입 끝낼 때마다 AD열에 *해당 주문의 상품주문번호* 입력 + AB열 도매가+배송비+박스비 통합 입력

---

## 매출 보고 메시지 구조 (현재)

```
📊 YYYY-MM-DD 매출 보고

💰 총매출 X원 (X건)
❌ 취소매출 -X원 (X건)
✅ 최종매출 X원 (X건)
💵 정산예정 X원 (수수료 차감 후)
📦 원가 X원 · 🚚 물류비 X원
💎 이익 X원

━━ 비타앤오리진 ━━
💰 총매출 ...
✅ 최종매출 ...
📦 N건 배송 / 출고 N개
💳 수수료 X원 / 💵 정산예정 X원
📦 원가 X원 · 🚚 물류비 X원 → 💎 이익 X원
• 라벨 N
   N병 · N건 · X원
   ↳ 추가: 라벨 ...

━━ 여기명품 ━━ ...
━━ 와이케이팜 ━━ ...
```

수수료 = 매출 - 정산예정 (네이버 총 차감, 명시 수수료 + 적립 차감 등 모두 포함).
이익 = 정산예정 - 원가 - 물류비.

---

## 자주 발생하는 이슈 + 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 시트 「자동화」 행 RUNNING 멈춤 | 작업 중 process 죽음 + lock 파일 남음 | 11행 「🛑 작업 중단」 ☑ → 자동 정리 |
| 검색량 429 RATE_LIMIT | (해결됨) batchUpdate 1회로 처리 | — |
| catalog OOM | (해결됨) 2GB 인스턴스 + 정적 IP | — |
| 매출 보고에 일부 스토어 누락 | IP 화이트리스트 차단 | 네이버 커머스 API 콘솔 화이트리스트에 `52.79.198.61` 등록 확인 |
| 텔레그램 fetch failed | (해결됨) sendTelegram + writeRange 3회 retry | — |
| 옵션명 빈칸 / 추가상품 0건 | 네이버 API 응답 필드 (option1→optionName1, supplementProducts) | (해결됨) catalog.ts 매핑 fix |
| 시장 카테고리 트리 1차만 12개 | (해결됨) childCount 조건 제거 + leaf 활용 + 429 retry | — |
| 수수료 % 다르게 보임 | (해결됨) 매출-정산예정 = 진짜 수수료 | — |
| STOP 눌렀는데 시트에 "Command failed" 박힘 | (해결됨 2026-05-14) scheduler catch race condition — SIGTERM 구분으로 "STOP 으로 중단됨" 박게 | — |
| 시트 「주문원본」 쓰기 실패: meta 500 | (해결됨 2026-05-14) sheets API 일시 5xx — withRetry 헬퍼로 5회 retry + exponential 백오프 | — |
| 시장규모 작업 OK 떴는데 시트 갱신 안 됨 | 네이버 쇼핑 페이지 봇 차단 (HTTP 418, Lightsail IP) | `.env` 에 `NAVER_SHOPPING_COOKIE` 박기. 자세한 절차: market.ts:fetchKeywordMarketSize 주석. 쿠키 만료 (1~2개월) 시 재발급 |

---

## 다음 우선순위 작업 (사장님이 시작할 때)

1. **마지막 푸시 + Lightsail pull + 매출 작업 테스트** (위 「1번 액션」)
2. **압박스타킹 자동 합산 검증** — 와이케이팜 「압박스타킹」 주문 있는 날짜로 매출 보고 → 텔레그램 이익 표시 확인
3. **여기명품 사입관리 매칭 검증** — 사장님이 AD열 상품주문번호 입력한 주문 있는 날짜로 매출 보고 → 그 행의 cost 가 AB값과 일치하는지
4. **재고 보고 매일 자동 발송 확인** — 첫 보고 후 다음달부터 전월/당월초 비교 정상 표시
5. **검색량 timeout 진단** (보류 중) — 1분 시점 ERROR 재발하면 OOM 가능성 (지금은 안 나는 듯)
6. **순위 추적 자동화** — ⭐순위추적_상품 시트에 사장님 추적할 상품 입력 후 매일/주간 cron 추가

---

## 세션 끊김 대응 (재발 시)

이 브랜치는 **claude.ai 원격 에이전트** 가 돌리고 있어서 `--resume` 없음. 끊기면 컨텍스트 통째 날아감.

1. **세션 시작 시**: HANDOVER.md 먼저 읽고 `git log --oneline -10` 으로 최근 커밋 확인
2. **작업 단위 작게**: 한 사이클(작업 → 검증 → 커밋·푸시) 안에 끝낼 수 있는 크기
3. **세션 종료 시**: HANDOVER.md 「현재 상태」, 「다음 액션」 갱신 후 푸시
4. **연속성 중요 작업**: 로컬 Claude Code (`C:\Users\김성준\sales`) → `claude --resume`

---

## 새 세션에서 첫 메시지 예시

```
HANDOVER.md 읽고 「현재 상태」 검증한 뒤 「다음 우선순위 작업」 1번부터 진행해줘.
작업 끝나면 HANDOVER.md 갱신하고 커밋·푸시한 다음 종료.
```
