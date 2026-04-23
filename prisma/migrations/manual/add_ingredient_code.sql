-- Add ingredientCode field: HIRA 주성분코드 (separate from categoryB = 식약분류)
ALTER TABLE "Medication" ADD COLUMN IF NOT EXISTS "ingredientCode" TEXT;
CREATE INDEX IF NOT EXISTS "Medication_ingredientCode_idx" ON "Medication"("ingredientCode");
