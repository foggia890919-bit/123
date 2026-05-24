-- Rename Role enum value SALES_REP → BUSINESS
-- 운영 DB 에서 한 번만 실행. PostgreSQL ≥ 10 필요.
-- ALTER TYPE ... RENAME VALUE 는 enum 값을 그대로 rename — 기존 row 의 데이터는 보존되며 자동으로 BUSINESS 로 보임.
-- @default(SALES_REP) 였던 컬럼도 enum rename 에 따라 자동으로 default 가 BUSINESS 로 따라감.

ALTER TYPE "Role" RENAME VALUE 'SALES_REP' TO 'BUSINESS';
