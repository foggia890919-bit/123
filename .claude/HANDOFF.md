# 세션 인수인계 — 2026-05-24~25

> 다음 세션의 Claude 가 이 파일을 읽고 맥락 즉시 파악 + 이어서 작업 가능하도록 정리.

---

## 1. 프로젝트 개요

**Korea Medicine Data (KMD)** — 한국 의약품 영업/정산 관리 SaaS.
- Next.js (App Router) + Prisma + PostgreSQL (Supabase) + Vercel 배포
- Gemini Vision API 로 처방통계 사진 OCR → 약품 행 추출 → 마스터DB 매칭 → 검수 → 정산

### 회원 구조
- **일반회원** (가입 직후, `isBusinessApproved=false`) → 통합검색만 사용 가능
- **사업자회원** (마이페이지 사업자등록증 제출 + 어드민 승인 → `isBusinessApproved=true`) → 모든 기능
- **ADMIN** → 전체 관리

### 상위/하위법인 구조
- `SubmissionRoute.parentUserId` 로 매핑 (다대다 가능, 단일 hierarchy 아님)
- 거래처관리(의료기관) > 제약사 필터링 탭에서 거래처 + 제약사 + 상위법인 선택 → 자동 등록
- 상위법인은 자기 매핑된 하위 회원의 통계도 봄 (`/api/stats/submissions` 의 viewableIds)
- User.parentUserId (기존 단일 hierarchy) 도 별도로 살아있음 (ParentLinkRequest workflow)

---

## 2. 핵심 파일 위치 (한글 메뉴 ↔ 코드)

| 한글 메뉴 | 코드 경로 | 설명 |
|---|---|---|
| 거래처관리(의료기관) | `/src/app/mypage/clients/page.tsx` | 거래처 등록 + 제약사 필터링 탭 (상위법인 선택 + 자동 매핑) |
| 통계제출처 | `/src/app/submission-routes/page.tsx` | 매핑 list 조회 + 수정/삭제만 (신규 등록 폼 제거됨) |
| AI 처방통계 등록 | `/src/app/stats/photo/page.tsx` | 사진 업로드 → Gemini OCR |
| AI 처방통계 검수 | `/src/app/biz/stats-review/page.tsx` | 사진+표 분할 검수 (1300+ 줄) |
| 마이페이지 | `/src/app/mypage/page.tsx` | 프로필 + 사업자 정보 + 회원 등급 카드 |
| 회원가입 | `/src/app/register/page.tsx` | 가입 폼 + 사업자 정보 (선택) |
| 어드민 대시보드 | `/src/app/admin/dashboard/page.tsx` | 회원 관리 탭 (5000+ 줄) |
| Navbar | `/src/components/Navbar.tsx` | 메뉴 잠금 + 알람 종 |

### 핵심 API

| API | 역할 |
|---|---|
| `/api/stats/photo-auto` | 사진 업로드 → after() 로 processRxPhoto 호출 |
| `/api/stats/photo-retry` | ERROR 사진 재분석 (같은 processRxPhoto 호출) |
| `/api/stats/submissions` | 거래처×월 통계 조회 (viewableIds 기반 권한) |
| `/api/submission-routes` | 통계제출처 매핑 CRUD (parentUserId 포함) |
| `/api/dealers/search` | 상위법인 검색 — User 기반, 의료기관 키워드 제외 |
| `/api/notifications` | 알람 CRUD + 사업자 미인증 자동 안내 |
| `/api/admin/users` | 어드민 회원 관리 (승인/이름/사업자 수정) |
| `/api/mypage` | 마이페이지 GET/PATCH (프로필 + 사업자 정보) |
| `/api/auth/register` | 회원가입 + 즉시 알람 생성 |
| `/api/health/self-validate` | Gemini 자가검증 ENV 진단 |

### 핵심 라이브러리

| 파일 | 역할 |
|---|---|
| `/src/lib/process-rx-photo.ts` | Gemini 분석 + 마스터 매칭 + 자가검증 + 시트 + DB update (photo-auto/retry 공유) |
| `/src/lib/gemini-rx-stats-extract.ts` | Gemini Vision 호출 (maxOutputTokens=32768, thinkingBudget=8192) |
| `/src/lib/gemini-self-validate.ts` | Gemini 텍스트 양방향 자가검증 (byCode + byName) |
| `/src/lib/medication-master-match.ts` | 마스터DB 매칭 + ValidationResult 인터페이스 |
| `/src/lib/hierarchy.ts` | User.parentUserId BFS hierarchy |
| `/src/lib/company-name.ts` | normalizeCompanyName 정규화 |
| `/src/lib/auth.ts` | NextAuth 설정 (session 에 isBusinessApproved 포함) |

---

## 3. DB 스키마 핵심 사항

### User 모델
- `isBusinessApproved Boolean @default(false)` — 사업자 인증 여부
- `canBeParent Boolean @default(false)` — 사용 안 함 (잔재, 제거 안 함)
- `parentUserId String?` — 기존 단일 hierarchy (ParentLinkRequest)
- 기존 모든 회원은 SQL 로 `isBusinessApproved=true` 적용 완료

### SubmissionRoute 모델
- `parentUserId String?` — 상위법인 회원 id (매핑별 다대다)
- `submissionEntity String` — 상위법인 표시명
- unique: `(ownerId, clientName, companyName)`
- 테이블 재생성 SQL 실행 완료 (2026-05-25)

### Notification 모델
- `type String` — "BUSINESS_PROMPT" | "BUSINESS_APPROVED" | 향후 확장
- `isRead Boolean`
- 테이블 생성 SQL 실행 완료

### UserClient 모델
- `dealerType null` = 본인 대표 사업자 또는 의료기관 거래처
- `dealerType != null` = dealer 분류 (UPPER_CORP 등)
- 본인 대표 사업자 = `dealerType=null + createdAt 가장 오래된 row`

---

## 4. 환경변수 (Vercel)

| 변수 | 값 | 설명 |
|---|---|---|
| `GEMINI_SELFVALIDATE_ENABLED` | `true` | Gemini 자가검증 동작 (false면 skip) |
| `GEMINI_SELFVALIDATE_DEBUG` | `true` (옵션) | raw 양방향 답 ocrData 보존 |
| `GEMINI_API_KEY` | (기존) | Gemini Vision + 텍스트 API |

---

## 5. Vercel 배포 설정

- **Production branch**: `claude/gemini-api-data-extraction-jRsBl` (Vercel Settings > Environments 에서 변경됨)
- **GitHub default branch**: 같은 브랜치 (사용자가 GitHub Settings 에서 변경)
- **push 만으로 자동 Production 배포** (PR 머지 불필요)

---

## 6. 오늘 세션 변경 사항 (commit 순서)

### Gemini 자가검증
- Phase 1 (f30e83f): Case B 약품명 자동 교체 + 파란 AI 배지
- Phase 2 (15982d2): Gemini 단방향 자가검증 + 노란 "검증대상" 배지 + 필터
- Phase 3 (e9ee858): 양방향 cross-check (마스터DB 독립)
- Phase 3b (55d7075): 약가 완전 일치 + hallucination 분기

### 검수 페이지 UX
- 화살표 키 표 안에서만 scroll (36883fe → 27eadf0 → c9d3b9d)
- 사진+표 한 viewport (794373d)
- 표 행 사이즈 절반 + focus outline 제거 (2bcd7ba)
- 호버 툴팁 ADMIN 만 (e344962)
- 단가 신호등 dot (3569f9c)
- 처리 실패 사진 재분석 버튼 + 일괄 + 자동 (9ffa8d1, e1b2bb7, eaa7ba9)
- 그룹 목록 체크박스 + 외부 일괄 재시도 (b5115ab)

### 회원 등급 + 상위법인
- User.isBusinessApproved 추가 + 가입/마이페이지/어드민 (37ab09c → 7ef2fba)
- 일반회원 메뉴 잠금 + 알람 (d0cc2ba)
- 상위법인 검색 = User 기반 + 뱃지 (a5afc77 → 6af5ddd → 7425a4e → dce1039 → f637274)
- SubmissionRoute.parentUserId 라우팅 (ff2f21b)

### 통계제출처 매핑 플로우
- 거래처관리 > 제약사 필터링 탭에 상위법인 선택 추가 (c257fbf → 0ae5fd8 → a5afc77)
- 자동 등록 실패 명시 표시 (23a8305)
- 통계제출처 메뉴 신규 등록 폼 제거 (fd020ca)

### 알람 시스템
- Notification 모델 + API + Navbar 종 아이콘 (cc725ca)
- 회원가입 직후 안내 알람 즉시 생성 (d0cc2ba)
- 어드민 사업자 승인 시 알람 자동 생성 (53882ba)

### 기타
- 본인 대표 사업자 거래처 list 에서 제외 (7da8883, 511fd91)
- 한글 IME 입력 후 등록 실패 fix (42cc385, e45b1b8)
- 사업자 정보 수정 시 bizNumber 누락 fix (d6c02f6)
- 어드민 이름/사업자 수정 기능 (7a0eb0c)
- Gemini maxOutputTokens 32768 + thinkingBudget 8192 (ff2f21b)
- processRxPhoto helper 추출 (9ffa8d1)

---

## 7. 다음 작업 목록 (사용자 요청 대기)

### 즉시 진행 가능
1. **업로드한 회원 표시** — 검수 그룹 카드에 업로드한 회원 이름/이메일 표시
2. **제출 트리 시각화** — 어드민 대시보드에 상위↔하위 hierarchy 트리 (SubmissionRoute.parentUserId 기반)
3. **어드민 모달 편집 폼** — prompt → 깔끔한 modal 폼으로 회원 정보 편집
4. **크롤러 워커 배치 최적화** — 같은 제약사 약품인데 크롤링 시점 차이 큼 (7시간 vs 12분). 배치 단위/동시성/순서 개선 필요. worker/ 또는 src/scrapers/ 영역.
5. **통합검색 trigram 인덱스** — pg_trgm + GIN 인덱스 추가로 ILIKE 검색 10~100배 가속 (SQL 실행 여부 확인 필요)

### 미래 작업
4. **이메일 알림** — 상위법인 연결요청/승인 시 이메일 발송 (V2 보류 상태)
5. **알람 확장** — 공지/쪽지 type 추가
6. **상위 → 자기 상위 재제출** (3단계)
7. **어드민 사업자 승인 일괄 처리**

---

## 8. 주의사항 / 엣지케이스

### AGENTS.md 룰 (mandatory)
- Plan → QA → implement 순서 (변경 2+ 파일 또는 shared utility 시)
- DB 스키마 변경 시 사용자 SQL 가이드 동봉
- `normalizeCompanyName` 모든 write 시점 적용
- `updatedAt` 가 있는 테이블: User ✓, Client ✓, FilterRequest ✓, MemberCompanyRate ✓, CorpCompanyRate ✓ — UserClient ✗, SubmissionRoute ✗ (schema 에는 @updatedAt 있지만 AGENTS.md 표는 옛 정보)

### 사용자 커뮤니케이션
- **코드 경로 (예: /src/app/...) 로 얘기하면 안 됨** — 한글 메뉴 이름으로만 소통
- 사용자가 자주 "다 한번에 진행해" 라고 함 — 자율 모드 + Council 5명 + 한 흐름으로

### 알려진 제한
- `canBeParent` 컬럼 잔재 — 코드에서 사용 안 하지만 DB 에 있음 (cleanup 안 함)
- tsc 기존 에러 11개 (내 작업 외 파일) — 무시
- 일부 페이지 (제안서, 정산, 매출원장 등) 에서 본인 대표 사업자가 거래처 드롭다운에 나올 수 있음 — 추가 페이지 확인 필요
- Gemini 자가검증 비용: 모든 행 호출 (사진당 평균 30회) — ENV gate 로 제어

### Vercel 배포 관련
- 코드 push → 자동 Production (별도 PR/Promote 불필요)
- DB 스키마 변경 시 SQL 먼저 실행 → 그 다음 코드 push (순서 중요)
- prisma generate 빌드 시 자동 실행

---

## 9. 사용자 계정 정보

- 사용자 이메일: foggia890919@gmail.com
- 마스터(ADMIN) 계정: foggia@naver.com
- 테스트 계정들: foggia1~5@naver.com, gelong13@naver.com 등
- 브랜치: `claude/gemini-api-data-extraction-jRsBl`
- 저장소: `foggia890919-bit/123`
