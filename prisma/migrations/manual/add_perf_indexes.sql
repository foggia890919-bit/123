-- Performance indexes for frequently filtered columns.
-- Run in Supabase SQL editor. Uses IF NOT EXISTS so it is safe to run multiple times.
-- CONCURRENTLY so that it doesn't block writes during creation (Postgres 12+).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Medication_source_idx" ON "Medication"("source");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Medication_settlementType_idx" ON "Medication"("settlementType");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "UserClient_approved_idx" ON "UserClient"("approved");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PrescriptionReport_status_idx" ON "PrescriptionReport"("status");
