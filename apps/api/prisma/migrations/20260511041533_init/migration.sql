-- CreateTable
CREATE TABLE "TradeAnalysis" (
    "id" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "tp1" DOUBLE PRECISION NOT NULL,
    "tp2" DOUBLE PRECISION NOT NULL,
    "tp3" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "leverage" INTEGER NOT NULL,
    "suggestion" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "rsiValue" DOUBLE PRECISION,
    "bbUpper" DOUBLE PRECISION,
    "bbMiddle" DOUBLE PRECISION,
    "bbLower" DOUBLE PRECISION,
    "atrValue" DOUBLE PRECISION,
    "priceAtAnalysis" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeAnalysis_coin_idx" ON "TradeAnalysis"("coin");

-- CreateIndex
CREATE INDEX "TradeAnalysis_createdAt_idx" ON "TradeAnalysis"("createdAt");
