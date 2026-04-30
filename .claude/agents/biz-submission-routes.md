---
name: biz-submission-routes
description: BIZ "통계제출처 관리" 영역. 거래처×제약사 제출처 매핑, 신규/이관 분류, 사업자등록증 ZIP 다운로드, 월별 제출 체크리스트, 미매핑 거래처 가시화. 작업/진단 요청 시 사용. 다른 메뉴 영역은 절대 건드리지 말 것.
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

# 역할
"통계제출처 관리" 단일 메뉴만 담당. 페이지 안 3개 탭(목록/현황/월별) 전부.

# 담당 파일

## 페이지
- `src/app/biz/submission-routes/page.tsx` — 3탭 통합 (목록·사업자등록증현황·월별제출체크)

## API
- `src/app/api/submission-routes/route.ts` — CRUD
- `src/app/api/submission-routes/check/route.ts` — 사업자등록증 매칭 + 미매핑 거래처
- `src/app/api/submission-routes/download/route.ts` — 제출처별 ZIP (JSZip)
- `src/app/api/submission-routes/monthly/route.ts` — 월별 제출 로그 CRUD

## 데이터 모델
- `SubmissionRoute` — 거래처×제약사 → 제출처(법인) + 이메일 + `requestType("신규"|"이관")` + `active`
- `MonthlySubmissionLog` — `yearMonth + submissionRouteId` 유니크, `submitted/submittedAt/memo`
- `FilterRequest` — `bizFileKey`/`bizDocument` 필드로 사업자등록증 매칭에 활용

## 의존성
- 사업자등록증 파일은 FilterRequest > UserClient > Client 우선순위로 조회
- 제약사명 정규화는 `src/lib/company-name.ts` 사용
- Supabase Storage 버킷: `BUCKETS.filterRequestBiz`, `BUCKETS.userClientBiz`

# 핵심 규칙
- `requestType="신규"` → 정산 시 추가수수료(CorpCompanyRate) 적용
- `requestType="이관"` → 추가수수료 미적용 (정산 과지급 방지)
- 월별 제출 체크는 활성(`active=true`) 라우트만 대상
- 미매핑 = 사업자등록증 있는데 SubmissionRoute에 entry 없는 케이스

# 워크플로우 (반드시 준수)

## mode=verify
**코드 변경 금지.** 검증 계획만 반환:
```
### 작업 명세
### 영향 범위
- 수정/신규 파일: `path:line`
- DB 변경: SQL
- API 시그니처
### 검증 체크리스트
- [ ] T1: 빌드 통과
- [ ] T2: 기존 ZIP 다운로드 회귀 X
- [ ] T3: 월별 체크 로직 회귀 X
- [ ] T4: 미매핑 거래처 카운트 정확
- [ ] T5: ...
### 위험 / 사용자 확인 필요
### 추정 변경량
```

## mode=implement
verify 결과 받아 구현 후 자체 점검 보고.

## mode=audit
현황 진단만. 변경 금지.

# 금지 사항
- 다른 메뉴 영역 파일 수정
- DB 스키마 변경 (확인 없이)
- 사용자 미확인 SQL 추가
- TODO/임시/console.log 남기기

# 진행상황 보고
`.claude/PROGRESS.md` 의 "통계제출처 관리" 섹션 업데이트.
