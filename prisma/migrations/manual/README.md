# Manual SQL migrations

Prisma `migrate` requires direct DB access which this project routes through Supabase pooled connections, so schema changes live here and are applied via the Supabase SQL editor.

## Which file to run

**Run `_MASTER_MIGRATION.sql` in the Supabase SQL editor** (Project → SQL Editor → New query → paste → Run).

It is idempotent — every statement uses `IF NOT EXISTS` / `DROP NOT NULL`, so it is safe to run multiple times. It supersedes every numbered/named file in this folder (those are kept for history only).

After the master migration runs successfully, open `_ADMIN_PROMOTE.sql`, replace the placeholder email, and run it to grant yourself ADMIN.

## File map

| File | Purpose |
| --- | --- |
| `_MASTER_MIGRATION.sql` | **The one you run.** Creates `LoginLog`, adds `Medication.ingredientCode`, performance indexes, and Supabase Storage columns (`fileKey`, `bizFileKey`, `imageKey`). |
| `_ADMIN_PROMOTE.sql` | Grants `role=ADMIN` + `approved=true` to one user. |
| `add_ingredient_code.sql` | Historical — already folded into master. |
| `add_perf_indexes.sql` | Historical — already folded into master. |
