-- CreateTable
CREATE TABLE "CoordinatorRun" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "strategyRoute" TEXT NOT NULL,
    "checklistStatus" TEXT,
    "totalScore" INTEGER,
    "shouldInvokeAI" BOOLEAN NOT NULL,
    "aiAction" TEXT,
    "aiConfidence" INTEGER,
    "coordinatorPayload" JSONB NOT NULL,
    "aiPayload" JSONB,
    "durationMs" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoordinatorRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoordinatorRun_symbol_createdAt_idx" ON "CoordinatorRun"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "CoordinatorRun_strategyRoute_createdAt_idx" ON "CoordinatorRun"("strategyRoute", "createdAt");

-- CreateIndex
CREATE INDEX "CoordinatorRun_aiAction_createdAt_idx" ON "CoordinatorRun"("aiAction", "createdAt");
