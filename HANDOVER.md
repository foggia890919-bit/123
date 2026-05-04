# 자동주문 시스템 — 새 세션 핸드오버 (2026-05-04)

> **새 Claude 세션에서 이 파일부터 읽고 시작하세요.**
> 브랜치: `claude/sales-data-portal-NpLDG` (베이스: `claude/plan-service-project-Ea4Bn`)

---

## 1. 인프라 (변경 X)

| 영역 | 정보 |
|---|---|
| 프론트엔드 | Vercel 프로젝트 `123` — 도메인 `123-nine-lyart.vercel.app` |
| DB | Supabase Postgres |
| 워커 | AWS Lightsail `inventory-worker` (Seoul) — IP `54.180.228.148` 포트 8080 |
| 워커 경로 | `~/inventory/` (전체 레포 클론) — worker는 `worker/src/`, systemd 서비스 `inventory-worker` |
| 깃 | `https://github.com/foggia890919-bit/123` |

### 워커 명령어 모음

```bash
# 코드 갱신 + 재시작 + 상태
cd ~/inventory && git pull origin claude/sales-data-portal-NpLDG && sudo systemctl restart inventory-worker && sleep 3 && sudo systemctl status inventory-worker --no-pager -n 10

# 실시간 로그
sudo journalctl -u inventory-worker -f | grep "\[products\]"

# 최근 로그
sudo journalctl -u inventory-worker --since "10 minutes ago" --no-pager | tail -50
```

### Vercel 환경변수 (이미 세팅됨)
- `EPHARMS_ENC_KEY` (32바이트 hex, 워커와 동일)
- `WORKER_BASE_URL` = `http://54.180.228.148:8080`
- `WORKER_TOKEN` (워커와 동일)

---

## 2. 완성된 단계 (✅)

### 0단계: 영업사원 대량등록 (PR #27 머지됨)
- `/biz/sales-reps` 우상단 **"대량등록"** 버튼
- 양식: 이름·이메일·휴대폰·임시PW(비우면 자동생성)·사업자번호
- 기존 이메일이면 거래처 매핑만 추가 (✨신규/🔗매핑추가/❌실패 3색)
- 영맨 행에 "담당 거래처 N곳" 컬럼 (펼치기)
- API: `POST /api/sales-reps/bulk`

### 1단계 인프라: 이팜스 매출원장 자동수집 (이전 PR로 머지됨)
- `/biz/epharms-accounts` — 거래처별 ePharms 계정 등록 (PW AES-256-GCM)
- `/mypage/ledger` — 영업사원이 본인 거래처 매출원장 보기 + 엑셀다운(녹색) + 수금요청서 생성
- 워커가 매일 00:00 KST 자동 sync
- 마스터 계정 `2110948285` (와이케이팜) `isMaster=true`

### 1단계 상품 마스터 (코드 머지됨, 데이터는 재sync 필요)
- `/biz/products` — 상품 카탈로그 + "워커 자동 동기화" / "엑셀 업로드" 버튼
- 워커가 페이지별 크롤링 (그룹 단위로 ">" 화살표 이동)
- AJAX 데이터 로드 대기 / mustache 템플릿 행 스킵 / __name 호환성 stub

---

## 3. 직전에 한 작업 (스키마 마이그레이션) ⚠️

**사장님이 방금 실행한 SQL** — `priceCode` 단독 UNIQUE → `(priceCode, spec)` 복합 UNIQUE.

이유: 이팜스는 같은 보험코드를 **포장 다른 행으로 별도 표시**(예: PTP/병). 기존 스키마는 `priceCode` UNIQUE라 dedup 시 가격 정보 손실.

마지막 SQL 위치: 이 파일 하단 또는 `prisma/migrations/manual/add_epharms_products.sql` 갱신본.

워커 dedup 키: `priceCode` → `priceCode|spec` (이미 코드 반영됨).

**상태**: 사장님이 마지막에 실행했는지 새 세션에서 확인 필요. 아래 SQL로 검증:

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = '"EpharmsProduct"'::regclass
  AND contype = 'u';
-- 결과에 "EpharmsProduct_priceCode_spec_key" 보이면 OK
-- "EpharmsProduct_priceCode_key" 보이면 마이그레이션 미완

SELECT column_name FROM information_schema.columns
WHERE table_name = 'ClientProductPrice';
-- 결과에 productId 보이고 priceCode 안 보이면 OK
```

---

## 4. 미완성 작업 (다음 세션 우선순위)

### 우선순위 ① — 상품 마스터 재sync 검증
1. 워커 살아있는지 확인 (`active (running)` 녹색)
2. KMD `/biz/products` → "워커 자동 동기화" 클릭
3. 10~15분 대기 → 결과 확인
4. **기대**: 약 3500~4500개 상품 (포장 변형 포함). 같은 priceCode 다른 spec은 별도 행.
5. 첫 행 단가 검증 — 코드값(649801741)이 아닌 진짜 가격(예: 21000원)이어야 함.

### 우선순위 ② — 2-A: 단가 엔진 L1~L4
- L1: `LedgerEntry`(매출원장)에서 거래처×상품 fuzzy 매칭으로 최근 단가 추출 (한글 약품명 토큰화 + 용량 매칭, 까다로움)
- L2: `ClientProductPrice` 영구 저장 — 영업사원이 수동 단가 입력 시 자동 학습
- L3: 이익율조회 엑셀 임포트 메뉴 (`/biz/products` 옆에 신규 메뉴)
- L4: 영업사원 수동 입력 → L2 자동 저장
- 추천 단가 + 색상 표시 (🟢일치 / 🟡다름 / 🔴 50% 차이)

### 우선순위 ③ — 2-B: 주문 작성 UI
- `/mypage/orders/new` (영업사원이 본인 거래처 주문 작성)
- 거래처 선택 → 제품 검색 → 카트 → "이전 주문" 사이드 패널 (이팜스 캡쳐 디자인 따라)
- 각 라인에 단가 자동 추천 (L1~L4) + 색상 표시
- "주문 검토" 모달 → 텔레그램 발송 미리보기 → "카톡발송 + 주문전송" 버튼
- DB: 새 모델 `Order`, `OrderLine` 필요

### 우선순위 ④ — 3단계: 워커 자동주문 어댑터
- 영업사원이 KMD에서 입력한 주문 → 워커가 ePharms에 자동 로그인 → 카트 추가 → 체크아웃
- 안전장치: 1건 50만원 / 1일 200만원 한도, 5분 내 동일주문 차단

### 우선순위 ⑤ — 4단계: 텔레그램 알림 + 안전장치
- 코드베이스에 텔레그램 봇 이미 셋업됨 (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID_BIZ`)
- 주문 발생 시 창고팀 채팅방에 자동 발송
- 사장님 알림 + 실패 시 알림

---

## 5. 사장님 답변받은 비즈니스 룰 (잊지 마세요)

- **거래처 분리 X**: 거래처는 시스템 존재 모름. 영업사원이 대신 주문.
- **PW 자동 통일**: 거래처 ePharms PW는 사장님이 임의 설정 (7777 같은 특수값).
- **단가**: L1(매출원장 학습) 우선. 한 번 입력한 단가 영구 학습. 비급여 10원 / 급여 정상가, 예외 케이스(급여→비급여) 영업사원이 매번 확인.
- **주문 흐름**: 영업사원 입력 → 검토 모달 → "카톡발송 + 주문전송" 버튼 → 텔레그램(창고팀+영업사원본인) + ePharms 자동 등록.
- **이전 주문 패널**: 사이드에 같은 거래처의 최근 주문 표시 (이팜스 디자인 참고).

---

## 6. 알려진 이슈 / 주의사항

| 이슈 | 대응 |
|---|---|
| 워커 코드 변경 후 자동 배포 X | `git pull` + `systemctl restart` 수동 필요 |
| 라이트세일 인스턴스 stop/start 시 워커 자동 시작 (systemd enabled) | 그래도 status로 확인 권장 |
| `__name is not defined` (tsx/esbuild) | `addInitScript`로 stub 주입 (이미 적용) |
| 동일 priceCode 다른 spec | 복합 UNIQUE로 처리 (이번에 수정) |
| ePharms 첫 로그인 팝업 (배송일정 안내) | 자동 닫기 로직 있음 |
| ePharms 페이지 1-10이 한 batch | ">" 화살표로 다음 batch 로드 |

---

## 7. 다음 세션 첫 명령

```
1. 사장님: /biz/products 페이지 캡쳐 — 동기화 로그 + 상품 행 보여주기
2. Claude: SQL로 스키마 상태 확인 (위 §3 검증 쿼리)
3. 둘 다 OK면 → 2-A 단가 엔진 작업 시작
```

---

## 부록: 주요 파일 위치

```
prisma/schema.prisma                           ← 스키마 (EpharmsProduct, ClientProductPrice, Order(미생성))
prisma/migrations/manual/                      ← 수동 마이그레이션 SQL

src/app/biz/sales-reps/page.tsx                ← 영업사원 관리 + 대량등록
src/app/biz/products/page.tsx                  ← 상품 마스터
src/app/biz/epharms-accounts/page.tsx          ← ePharms 계정 등록
src/app/mypage/ledger/page.tsx                 ← 영업사원 매출원장 보기

src/app/api/sales-reps/bulk/route.ts           ← 대량등록 API
src/app/api/products/route.ts                  ← 상품 검색
src/app/api/products/sync/route.ts             ← 워커 sync 트리거
src/app/api/products/upload/route.ts           ← 엑셀 업로드
src/app/api/products/logs/route.ts             ← 동기화 로그
src/app/api/ledger/route.ts                    ← 매출원장 조회

worker/src/server.ts                           ← Express 엔드포인트
worker/src/scheduler.ts                        ← 매출원장 cron
worker/src/epharms/adapter.ts                  ← 이팜스 로그인 + 매출원장 fetch
worker/src/epharms/products.ts                 ← 이팜스 상품 카탈로그 페이지별 스크랩
worker/src/epharms/sync.ts                     ← 매출원장 sync runner
worker/src/epharms/cron.ts                     ← ePharms 매출원장 cron (00:00 KST)
worker/src/epharms/db.ts                       ← pg 헬퍼 (decrypt + upsert)

src/lib/crypto-secret.ts                       ← AES-256-GCM (Vercel 측)
```

---

**마지막 푸시**: `f71859c fix(products): (priceCode, spec) 복합 UNIQUE`
