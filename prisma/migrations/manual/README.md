# Manual SQL migrations

Prisma `migrate` requires direct DB access which this project routes through Supabase pooled connections, so schema changes live here and are applied via the Supabase SQL editor.

## Which file to run

**Run `_MASTER_MIGRATION.sql` in the Supabase SQL editor** (Project → SQL Editor → New query → paste → Run).

It is idempotent — every statement uses `IF NOT EXISTS` / `DROP NOT NULL`, so it is safe to run multiple times. It supersedes every numbered/named file in this folder (those are kept for history only).

After the master migration runs successfully, open `_ADMIN_PROMOTE.sql`, replace the placeholder email, and run it to grant yourself ADMIN.

`_MASTER_MIGRATION.sql` now includes the inventory tables (`WholesaleSite`, `InventorySnapshot`, `ScrapeJob`) and their unique constraint. You do **not** need to run `_INVENTORY_MIGRATION.sql` or `add_inventory_integrity.sql` separately.

## File map

| File | Purpose |
| --- | --- |
| `_MASTER_MIGRATION.sql` | **Run first.** Creates `LoginLog`, indexes, Storage columns, and inventory tables (`WholesaleSite` / `InventorySnapshot` / `ScrapeJob`). |
| `_BOARD_MIGRATION.sql` | **Run second.** Adds Notice popup columns, `HomeBanner`, `Board`, `Post`, `BoardEditor` tables, and 3 sample boards. |
| `_ADMIN_PROMOTE.sql` | Grants `role=ADMIN` + `approved=true` to one user. |
| `_INVENTORY_MIGRATION.sql` | Historical — already folded into master. |
| `add_inventory_integrity.sql` | Historical — already folded into master. |
| `add_ingredient_code.sql` | Historical — already folded into master. |
| `add_perf_indexes.sql` | Historical — already folded into master. |

## Supabase Storage buckets to create

In addition to the 4 buckets from the master migration, create 2 more **public** buckets:

| Bucket name | Public |
| --- | --- |
| `banners` | **ON (공개)** |
| `post-images` | **ON (공개)** |

These two buckets are public because banner images and board post images are shown to all visitors.
