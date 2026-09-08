-- CreateTable
CREATE TABLE "SimTrade" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entry" DOUBLE PRECISION NOT NULL,
    "stop" DOUBLE PRECISION NOT NULL,
    "targets" JSONB NOT NULL,
    "rationale" TEXT,
    "mapSnapshot" JSONB NOT NULL,
    "spotAtDecision" DOUBLE PRECISION NOT NULL,
    "usedOutsideData" BOOLEAN NOT NULL DEFAULT false,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "grossR" DOUBLE PRECISION,
    "netR" DOUBLE PRECISION,
    "targetsHit" INTEGER,
    "barsHeld" INTEGER,
    "filledAt" TIMESTAMP(3),
    "scoredAt" TIMESTAMP(3),

    CONSTRAINT "SimTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimTrade_batchId_idx" ON "SimTrade"("batchId");

-- CreateIndex
CREATE INDEX "SimTrade_symbol_decidedAt_idx" ON "SimTrade"("symbol", "decidedAt");

-- CreateIndex
CREATE INDEX "SimTrade_scoredAt_idx" ON "SimTrade"("scoredAt");
