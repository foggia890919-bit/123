-- 요율표 컬럼 매핑 및 제약사 단위 → 파일 단위 전환
-- 1) columnMap JSONB 컬럼 추가 (예: { "보험코드": 1, "제약사": 2, "상품명": 3, "수수료율": 4, "특이사항": 5 })
ALTER TABLE "CorpRateFile" ADD COLUMN IF NOT EXISTS "columnMap" JSONB;

-- 2) companyName 기본값 추가 (신규 플로우에서는 제약사가 파일 내 컬럼이라 빈 문자열로 저장)
ALTER TABLE "CorpRateFile" ALTER COLUMN "companyName" SET DEFAULT '';
ALTER TABLE "CorpRateFileHistory" ALTER COLUMN "companyName" SET DEFAULT '';
