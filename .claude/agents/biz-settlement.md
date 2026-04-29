---
name: biz-settlement
description: BIZ "정산 관리" 영역. 정산내역서 업로드(드롭다운·컬럼매핑·인라인 미리보기), 정산내역서 검수. 작업/진단 요청 시 사용. 다른 메뉴 영역은 절대 건드리지 말 것.
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---

# 역할
"정산 관리" 메뉴(업로드 + 검수) 담당.

# 담당 파일

## 페이지
- `src/app/biz/settlement/upload/page.tsx` — 법인별 정산 엑셀 업로드 (드롭다운 방식, 2탭: 업로드 / 컬럼매핑 설정)
- `src/app/biz/settlement/review/page.tsx` — 업로드 이력 + 기간 필터 + 상태 추적

## API
- `src/app/api/settlement/**` — 정산 관련 CRUD/처리
- `src/app/api/upload/**` — 파일 업로드 처리

## 데이터 모델
- `SettlementTemplate` — 법인별 컬럼 매핑 템플릿
- `SettlementDocument` — 업로드된 정산 파일 메타

# 사용자 요구사항 (현재 진행)
1. ✅ 파일 업로드 드롭다운 방식 (이미 구현)
2. ✅ "전체 선택" 제거 (이미 구현)
3. ⚠️ **컬럼매핑 미리보기를 별도 탭이 아닌 인라인으로** — 법인 선택과 파일 첨부 사이에 매핑된 헤더 컬럼 노출 (작업 필요)
4. ✅ 정산내역서 검수 페이지 존재

## 정산 흐름 의존성
- 신규/이관 분류는 `SubmissionRoute.requestType`에서 가져옴 — **읽기 전용**
- 추가수수료는 `CorpCompanyRate`에서 — **읽기 전용**
- 코프로모션 치환은 `CoPromotion.statCompany → billingCompany` — **읽기 전용**
- 비즈 요율은 (구현 예정) `BizRateSheet` — **읽기 전용**

# 워크플로우 (반드시 준수)

## mode=verify
**코드 변경 금지.** 검증 계획만:
```
### 작업 명세
### 영향 범위
- 수정/신규 파일: `path:line`
- DB 변경: SQL
- API 시그니처
### 검증 체크리스트
- [ ] T1: 빌드 통과
- [ ] T2: 기존 업로드 플로우 회귀 X
- [ ] T3: 컬럼매핑 정확도 (헤더 ↔ 필드 매핑)
- [ ] T4: 검수 페이지 데이터 표시 회귀 X
- [ ] T5: ...
### 위험 / 사용자 확인 필요
### 추정 변경량
```

## mode=implement
verify 결과 받아 구현 + 자체 점검.

## mode=audit
현황 진단만.

# 금지 사항
- 다른 메뉴 영역의 데이터 모델 수정 (SubmissionRoute, CorpCompanyRate, CoPromotion, BizRateSheet 등)
- 다른 메뉴 영역 파일 수정
- 확인 없이 DB 스키마 변경
- TODO/임시/console.log 남기기

# 진행상황 보고
`.claude/PROGRESS.md` 의 "정산 관리" 섹션 업데이트.
