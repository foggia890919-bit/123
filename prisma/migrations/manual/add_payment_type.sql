-- Medication.paymentType: HIRA payTpNm (급여구분명)
-- 값 예: "급여" | "비급여" | "전액본인부담" | "선별급여" | NULL(미확인)
-- fill-prices sync 가 HIRA API 응답의 payTpNm 을 그대로 저장하도록 변경됨.
-- price IS NULL 이라는 간접 추정 대신 이 컬럼이 비급여 판정의 신뢰 가능한 source.
ALTER TABLE "Medication" ADD COLUMN IF NOT EXISTS "paymentType" TEXT;
CREATE INDEX IF NOT EXISTS "Medication_paymentType_idx" ON "Medication"("paymentType");
