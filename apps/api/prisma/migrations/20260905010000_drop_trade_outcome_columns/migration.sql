-- Drop the R-multiple columns from CoordinatorRun.
--
-- These describe trades the product no longer plans: entry ladders, stops and
-- targets were removed when the directional programme was closed on 5 Sept 2026
-- after twenty pre-registered tests. See docs/PRODUCT_LAYERS.md Layer 0.
--
-- DESTRUCTIVE AND IRREVERSIBLE. It ends the live forward-test record that has
-- been accumulating since 1 September. Snapshot the table first if that record
-- is worth keeping:
--
--   pg_dump "$DATABASE_URL" -t '"CoordinatorRun"' > coordinator-run-YYYYMMDD.sql
--
-- `outcome` and `scoredAt` are deliberately KEPT: they are the resolution
-- machinery Layer 2 repoints at calibrated probabilities, not trade fields.

ALTER TABLE "CoordinatorRun" DROP COLUMN "grossR";
ALTER TABLE "CoordinatorRun" DROP COLUMN "netR";
ALTER TABLE "CoordinatorRun" DROP COLUMN "targetsHit";
ALTER TABLE "CoordinatorRun" DROP COLUMN "entryFilledAt";
ALTER TABLE "CoordinatorRun" DROP COLUMN "outcomeDirection";
