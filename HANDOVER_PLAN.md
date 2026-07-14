# HANDOVER — plan-service-project (검색어로 품목찾기 / 약품·재고)

> **세션 시작 시 첫 액션**: 이 파일 끝까지 읽고 → 「현재 상태」 검증 → 「다음 액션」 진행.
> **세션 종료 시 의무**: 이 파일 갱신·커밋·푸시 후 종료.
> ⚠️ 이 HANDOVER 는 `claude/plan-service-project-Ea4Bn` 브랜치(약품/재고/검색) 용. 매출 자동화건은 별도 `HANDOVER.md` 참조.

---

## 프로젝트 개요

| 항목 | 값 |
|---|---|
| 레포 | `github.com/foggia890919-bit/123` |
| 작업 브랜치 | `claude/plan-service-project-Ea4Bn` (production) |
| 로컬 경로 (사장님 측 다른 기기) | `/home/user/123` |
| 로컬 경로 (이 PC) | `C:\Users\김성준\sales` |
| 배포 | Vercel `https://123-nine-lyart.vercel.app` |
| DB | Supabase (Postgres) |
| 워커 서버 | AWS Lightsail (한국 의약품 도매상 재고 크롤러) |

## 최근 푸시 순서 (이전 세션 기준)

- `46e8b89` 검색 시 snapshot 없는 코드 자동 라이브 트리거 (최대 50개)
- `b4b4a97` 배치 fetch + JSON 파싱 견고화 (SyntaxError 수정)
- `358de84` 검색 페이지 재고 UX (자동 워밍업 + 인라인 새로고침)
- `4eafa48` 재고 일괄 조회 빈 화면 → 행 표시
- `127fd36` 처방통계 합계 박스(총수량/총금액) 위치 이동
- `f258993` ICD 분석 응답 파싱 견고화
- `180ad7c` Claude → Gemini 전환 + 컬럼 너비

---

## 인프라 현황

### Lightsail 워커

| 항목 | 값 |
|---|---|
| 옛 인스턴스 | `inventory-worker` 512MB ($5/월) — **삭제 예정** |
| 새 인스턴스 | `Ubuntu-2medical` 1GB ($7/월), 스냅샷 복원, 호스트네임 `ip-172-26-3-82` |
| Static IP | `13.125.11.218` — **✅ 새 인스턴스에 attached 확인됨 (2026-05-18)** |
| 워커 상태 | 살아 있음 (systemctl 자동 시작) — 단 외부 접근은 8080 방화벽 룰 추가 후 가능 |
| 동시성 | `CONCURRENCY_PER_SITE=2` (사이트당 2 lane × 2 사이트 = 4 동시 브라우저) |
| cron | `0 0,12 * * *` (KST 자정/정오) |
| 활성 어댑터 | `ibjp`, `family` (inchun 은 IP 차단으로 제외) |

### Vercel 환경변수

- `GEMINI_API_KEY` = 사용자 키 (Claude → Gemini 전환)
- `WORKER_URL` = `http://13.125.11.218:8080`
- `WORKER_TOKEN` = Lightsail `.env` 의 토큰값과 일치해야 함

---

## 🔴 현재 막힌 문제 (2026-05-18)

**증상**: 검색 결과 재고 칸 "실시간 조회 서버에 연결할 수 없습니다. Lightsail 워커가 실행 중인지 방화벽이 열려있는지..."

### 진단 결과 (스크린샷 대조)

1. **Static IP 이전**: ✅ 완료 — Ubuntu-2medical 에 `13.125.11.218` attached 확인됨
2. **8080 방화벽 룰**: 🟡 입력 도중, Create 미클릭. 게다가 **Source IP 가 `Custom IPv4 address` + `192.0.2.0` placeholder 로 박혀 있음** → 그대로 Create 누르면 Vercel 호출 차단됨
3. **Vercel `WORKER_URL`**: 이미 신규 IP 와 동일 (`13.125.11.218:8080`) — 변경 불필요

### 사장님 즉시 액션

**📍 Lightsail 콘솔 IPv4 Firewall**
- Source IP address 드롭다운 `Custom IPv4 address` → **`Any IPv4 address`** 변경
- Create 클릭
- 룰 목록에 `Custom / TCP / 8080 / Any IPv4 address` 행 추가되면 성공
- 이유: 기존 HTTP(80) 룰도 Any IPv4 로 박혀 있음. Vercel 서버리스는 호출 IP 가 매번 바뀌어서 특정 IP 화이트리스트 불가.

**📍 사장님 cmd.exe (8080 열린 직후 외부 헬스체크)**
```cmd
curl http://13.125.11.218:8080/health
```
200 OK + JSON 응답 = 정상. 응답 없으면 워커 프로세스 자체 미기동 → SSH 필요.

**📍 사장님 브라우저 (Vercel 사이트)**
- `https://123-nine-lyart.vercel.app` 검색 페이지에서 ↻ 클릭 → "오류" → 숫자로 바뀌는지 확인

**📍 Lightsail 콘솔 (위 2단계 모두 성공 후)**
- Instances → 옛 `inventory-worker` 512MB → Delete (양쪽 청구 방지)

---

## 미해결 큰 이슈 (다음 세션 우선순위)

### 1. Medication 테이블 데이터 구조 분리 (FK 리팩토링)

**문제**: 요율표 업로드가 마스터 데이터(`insuranceCode` 등)까지 덮어쓰고 새 레코드 생성 → `D...` 같은 비표준 코드 339개가 마스터에 박혀있음.

**사용자 요구**: `Medication` 은 공공데이터(HIRA)만 유지. 새 `MedicationRate` 테이블 만들어 수수료/정산 데이터 FK 로 분리.

**Phase 1 SQL (사장님이 Supabase 에서 실행 대기 중)**:
```sql
CREATE TABLE IF NOT EXISTS "MedicationRate" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "medicationId" TEXT NOT NULL UNIQUE,
  "commissionRate" DOUBLE PRECISION,
  "isSettlement" BOOLEAN NOT NULL DEFAULT false,
  "settlementType" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MedicationRate_medicationId_fkey"
    FOREIGN KEY ("medicationId") REFERENCES "Medication"("id") ON DELETE CASCADE
);
INSERT INTO "MedicationRate" ("medicationId", "commissionRate", "isSettlement", "settlementType", "notes", "updatedAt")
SELECT "id", "commissionRate", "isSettlement", "settlementType", "notes", CURRENT_TIMESTAMP
FROM "Medication"
WHERE "commissionRate" IS NOT NULL OR "isSettlement" = true OR "notes" IS NOT NULL
ON CONFLICT ("medicationId") DO NOTHING;
```

**DB 현황**: 전체 45,334개 / EXCEL 출처 10,075개 / D 접두사 339개

### 2. ICD 코드 AI 분석 정확도

- Gemini 가 추정치 만들어내는 거라 비율이 5/10단위로 깔끔하게 떨어짐 + 동반질환(고지혈증약에 당뇨병) 섞임
- 사용자 방침: **"정확하지 않은 정보는 가져오면 안돼"**
- 결정 보류: 제거 / 큰 disclaimer / HIRA 실제 데이터 연동 중 택1

### 3. 처방통계 합계 박스 위치

- 합계 박스(총수량/총금액/예상수수료/최종승인) 이미 헤더 바로 아래로 이동 완료 (`127fd36`)
- 사용자 확인 필요

---

## 주요 파일 맵

| 영역 | 파일 |
|---|---|
| 검색 라우트 | `src/app/api/medications/search/route.ts` |
| 재고 조회 API | `src/app/api/inventory/check/route.ts` |
| 재고 캐시 (배치 fetch 지원) | `src/lib/stock-cache.ts` |
| 검색 페이지 | `src/app/search/page.tsx` |
| 의약품 테이블 (행 컴포넌트) | `src/components/MedicationTable.tsx` |
| 재고 모달 | `src/components/StockCheckModal.tsx`, `StockCheckBatchModal.tsx` |
| 처방통계 OCR | `src/app/stats/page.tsx` |
| AI 라우트 | `src/app/api/ai/auto-switch/route.ts`, `src/app/api/medications/icd-analysis/route.ts` |
| 워커 | `worker/src/scheduler.ts`, `server.ts`, `db.ts` |
| 스키마 | `prisma/schema.prisma` |

---

## 새 세션 첫 메시지 예시

```
sales/HANDOVER_PLAN.md 읽고 「현재 막힌 문제」 진행 상황 확인한 다음 「다음 액션」 1번부터 진행해줘.
작업 끝나면 HANDOVER_PLAN.md 갱신하고 커밋·푸시한 다음 종료.
```
