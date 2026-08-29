-- The list orders by createdAt DESC and pages on (createdAt, id). Only
-- (symbol, createdAt) existed, so an unfiltered list was a sequential scan.
-- Irrelevant at 603 rows, load-bearing at 11,000.
CREATE INDEX "CoordinatorRun_createdAt_idx" ON "CoordinatorRun"("createdAt");
