-- Persist the scored outcome so read paths never fetch candles.
--
-- `entryFilledAt` already exists and was never written or read by anything.
-- It is reused here for exactly what its name says — when the first entry
-- step filled — rather than adding a second column meaning the same thing.

ALTER TABLE "CoordinatorRun" ADD COLUMN "outcomePayload" JSONB;
ALTER TABLE "CoordinatorRun" ADD COLUMN "scoredAt" TIMESTAMP(3);
ALTER TABLE "CoordinatorRun" ADD COLUMN "outcome" TEXT;
ALTER TABLE "CoordinatorRun" ADD COLUMN "outcomeDirection" TEXT;
ALTER TABLE "CoordinatorRun" ADD COLUMN "grossR" DOUBLE PRECISION;
ALTER TABLE "CoordinatorRun" ADD COLUMN "netR" DOUBLE PRECISION;
ALTER TABLE "CoordinatorRun" ADD COLUMN "targetsHit" INTEGER;

-- Every existing row starts unscored, so the backfill picks all of them up.
CREATE INDEX "CoordinatorRun_scoredAt_idx" ON "CoordinatorRun"("scoredAt");
CREATE INDEX "CoordinatorRun_outcome_idx" ON "CoordinatorRun"("outcome");
