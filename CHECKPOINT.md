# CHECKPOINT — 작업 재개용 요약
> 브랜치: `claude/plan-service-project-Ea4Bn`  
> 최신 커밋: `a82fed3` feat: 비즈 관리 전체 기능 확장

---

## 1. 프로젝트 개요

Next.js App Router + Prisma(Supabase PostgreSQL) 기반 제약영업 관리 플랫폼.  
`/biz/*` 경로는 BIZ/ADMIN 전용 관리자 영역.

---

## 2. 현재 구현 완료된 기능

### 2-1. 비즈 메뉴 구조 (`/biz/page.tsx`)
4개 그룹으로 재편됨:
- **거래처/유저 관리**: 병·의원, 법인·딜러, 영업사원
- **정산 관리**: 정산내역서 업로드, 검수, 추가수수료 매핑
- **제약사/제품 관리**: 통계제출처, 코프로모션 예외
- **필터링 관리**: 필터링 통합 관리

### 2-2. 완성된 페이지 목록

| 경로 | 파일 | 상태 |
|------|------|------|
| `/biz/clients` | `src/app/biz/clients/page.tsx` | ✅ 병의원 코드(H-) 생성버튼 추가됨 |
| `/biz/dealers` | `src/app/biz/dealers/page.tsx` | ✅ 법인 코드(C-) 생성버튼 추가됨 |
| `/biz/sales-reps` | `src/app/biz/sales-reps/page.tsx` | ✅ 영업사원 승인토글 + S-코드 생성 |
| `/biz/settlement/upload` | `src/app/biz/settlement/upload/page.tsx` | ✅ 드롭다운 + 컬럼매핑 미리보기 |
| `/biz/filter-status` | `src/app/biz/filter-status/page.tsx` | ✅ 탭3개(현황/매핑/플로우) |
| `/biz/filter-mapping` | `src/app/biz/filter-mapping/page.tsx` | ✅ 제약사→상위법인, 세로형 엑셀 |
| `/biz/submission-routes` | `src/app/biz/submission-routes/page.tsx` | ⚠️ CRUD는 완성, 제출현황탭 미완성(아래 참고) |
| `/biz/co-promotion` | `src/app/biz/co-promotion/page.tsx` | ✅ 완성 |
| `/biz/corp-rates` | `src/app/biz/corp-rates/page.tsx` | ✅ 완성 (법인별 그룹핑 + 엑셀) |

### 2-3. 완성된 API 목록

| 경로 | 파일 | 기능 |
|------|------|------|
| `/api/sales-reps` | GET/PATCH | 영업사원 목록, 승인토글 |
| `/api/generate-code` | POST `{type, id}` | 코드 생성 H/C/S + YYYYMM-0001 |
| `/api/submission-routes` | GET/POST/PATCH/DELETE | 제출처 CRUD |
| `/api/submission-routes/check` | GET | 제출처별 문서 매칭 현황 (누락/매칭 카운트) |
| `/api/submission-routes/download` | GET `?submissionEntity=XXX` | ZIP 다운로드 |
| `/api/co-promotion` | GET/POST/PATCH/DELETE | 코프로모션 CRUD |
| `/api/corp-rates` | GET/POST/PATCH/DELETE | 추가수수료 CRUD |
| `/api/filter-request/resend` | POST `{id}` | 알림톡 재발송 |

---

## 3. ⚠️ 미완성 작업 (다음 세션에서 이어할 것)

### 3-1. [최우선] submission-routes 페이지에 "제출 현황" 탭 추가

**현재 상태**: API 2개는 만들어졌지만 커밋 안 됨, 페이지 UI는 아직 미작성.

**만들어야 할 것**:  
`/biz/submission-routes/page.tsx` 에 탭 2개 추가:
- 탭1 `제출처 목록` — 기존 CRUD 테이블 (현재 코드 그대로)
- 탭2 `제출 현황` — 아래 `EntityStatusTab` 컴포넌트 구현 필요

**`EntityStatusTab` 구현 스펙**:
```
1. 마운트시 GET /api/submission-routes/check 호출
2. 제출처별 카드 표시:
   - 카드 헤더: 제출처명 + 매칭건수/전체건수 + 누락건수(빨간 뱃지)
   - 누락 0 → 초록: "ZIP 다운로드" 버튼 활성
   - 누락 있음 → 노란 경고: "X건 누락 — 문서 필요" + 목록 펼쳐보기
3. ZIP 다운로드 버튼: GET /api/submission-routes/download?submissionEntity=XXX
   → Content-Type: application/zip → blob 변환 → <a> 태그 클릭으로 저장
4. 누락 목록 펼치기/접기 (토글)
5. "새로고침" 버튼 (체크 API 재호출)
```

**응답 타입** (`/api/submission-routes/check`):
```typescript
interface EntityStatus {
  submissionEntity: string;
  companies: string[];
  total: number;
  matched: number;
  missingCount: number;
  missing: { clientName: string; companyName: string }[];
}
interface CheckResponse {
  entities: EntityStatus[];
}
```

**ZIP 다운로드 코드 패턴**:
```typescript
async function downloadZip(submissionEntity: string) {
  setZipLoading(submissionEntity);
  try {
    const res = await fetch(
      `/api/submission-routes/download?submissionEntity=${encodeURIComponent(submissionEntity)}`
    );
    if (!res.ok) { alert((await res.json()).error); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${submissionEntity}_사업자등록증.zip`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    setZipLoading(null);
  }
}
```

---

## 4. DB 마이그레이션 (Supabase에서 직접 실행 필요)

Prisma 스키마는 업데이트됐지만 실제 DB에는 아직 적용 안 됨.

```sql
-- 코드 컬럼 추가
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "code" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Client_code_key" ON "Client"("code") WHERE "code" IS NOT NULL;
ALTER TABLE "UserClient" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "salesCode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_salesCode_key" ON "User"("salesCode") WHERE "salesCode" IS NOT NULL;

-- 새 테이블 3개
CREATE TABLE IF NOT EXISTS "SubmissionRoute" (
  "id" TEXT NOT NULL,
  "clientName" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "submissionEntity" TEXT NOT NULL,
  "submissionEmail" TEXT,
  "memo" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubmissionRoute_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubmissionRoute_clientName_companyName_key" UNIQUE ("clientName","companyName")
);
CREATE INDEX IF NOT EXISTS "SubmissionRoute_clientName_idx" ON "SubmissionRoute"("clientName");
CREATE INDEX IF NOT EXISTS "SubmissionRoute_companyName_idx" ON "SubmissionRoute"("companyName");
CREATE INDEX IF NOT EXISTS "SubmissionRoute_submissionEntity_idx" ON "SubmissionRoute"("submissionEntity");

CREATE TABLE IF NOT EXISTS "CoPromotion" (
  "id" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "statCompany" TEXT NOT NULL,
  "billingCompany" TEXT NOT NULL,
  "memo" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoPromotion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoPromotion_productName_statCompany_key" UNIQUE ("productName","statCompany")
);

CREATE TABLE IF NOT EXISTS "CorpCompanyRate" (
  "id" TEXT NOT NULL,
  "corpName" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "additionalRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "memo" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorpCompanyRate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpCompanyRate_corpName_companyName_key" UNIQUE ("corpName","companyName")
);
```

---

## 5. 커밋 안 된 파일 (다음 세션에서 커밋 필요)

```
src/app/api/submission-routes/check/route.ts   ← NEW (미커밋)
src/app/api/submission-routes/download/route.ts ← NEW (미커밋)
```

**주의**: submission-routes 페이지의 "제출 현황" 탭 코드 작성 후 함께 커밋할 것.

---

## 6. 사용자 미확인 질문 (피드백 필요)

1. **코드 형식** — 현재 `H202501-0001` (병의원) / `C202501-0001` (법인) / `S202501-0001` (영업사원)으로 구현됨. 기존에 쓰시던 형식이 있으면 수정 필요.
2. **requestType(신규/이관)** — FilterRequest 스키마에 존재하지만 UI에 노출 안 됨. 향후 이관처/신규처 구분 기능이 필요한지 확인 필요.
3. **ZIP 다운로드 문서 누락시 플로우** — 현재 구현: 누락 있어도 매칭된 것만 ZIP + `_누락목록.txt` 포함. 누락 0건일 때만 다운로드 허용으로 바꿀지 확인 필요.

---

## 7. 핵심 파일 구조 요약

```
src/
├── app/
│   ├── biz/
│   │   ├── page.tsx                    ← BizLayout + BIZ_MENU_GROUPS (4그룹)
│   │   ├── clients/page.tsx            ← 병의원 관리 + H-코드 생성
│   │   ├── dealers/page.tsx            ← 법인 관리 + C-코드 생성
│   │   ├── sales-reps/page.tsx         ← 영업사원 + S-코드 생성
│   │   ├── submission-routes/page.tsx  ← ⚠️ CRUD만 완성, 제출현황 탭 미완성
│   │   ├── co-promotion/page.tsx       ← 완성
│   │   ├── corp-rates/page.tsx         ← 완성
│   │   ├── filter-status/page.tsx      ← 완성 (탭3: 플로우관리 포함)
│   │   ├── filter-mapping/page.tsx     ← 완성
│   │   └── settlement/upload/page.tsx  ← 완성 (드롭다운 방식)
│   └── api/
│       ├── generate-code/route.ts      ← H/C/S 코드 생성
│       ├── sales-reps/route.ts         ← 영업사원 CRUD
│       ├── submission-routes/
│       │   ├── route.ts                ← CRUD
│       │   ├── check/route.ts          ← ⚠️ 미커밋
│       │   └── download/route.ts       ← ⚠️ 미커밋 (JSZip 사용)
│       ├── co-promotion/route.ts
│       ├── corp-rates/route.ts
│       └── filter-request/
│           ├── route.ts                ← GET: 실시간 전화번호 조회 포함
│           └── resend/route.ts         ← 알림톡 재발송
├── lib/
│   ├── company-name.ts                 ← normalizeCompanyName() — 법인형태 제거
│   └── storage.ts                      ← Supabase Storage 헬퍼
└── prisma/schema.prisma                ← FilterMapping(companyName @unique), 3개 신규모델
```

---

## 8. 다음 세션 첫 번째 작업 순서

1. `CHECKPOINT.md` 읽기 (이 파일)
2. `/biz/submission-routes/page.tsx` 열기
3. 파일 상단 import에 `FileArchive`, `RefreshCw`, `ChevronDown`, `ChevronUp` 추가
4. 파일 최상단에 `activeTab` state 추가 → "목록" | "현황" 탭 전환
5. `EntityStatusTab` 컴포넌트 구현 (섹션 3-1 스펙 참고)
6. `src/app/api/submission-routes/check/route.ts` + `download/route.ts` + 업데이트된 page.tsx 함께 커밋
7. `git push -u origin claude/plan-service-project-Ea4Bn`
