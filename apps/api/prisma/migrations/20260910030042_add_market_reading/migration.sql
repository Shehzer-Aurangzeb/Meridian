-- CreateTable
CREATE TABLE "MarketReading" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "universeKey" TEXT NOT NULL,
    "barTime" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketReading_symbol_barTime_idx" ON "MarketReading"("symbol", "barTime");

-- CreateIndex
CREATE UNIQUE INDEX "MarketReading_symbol_universeKey_barTime_key" ON "MarketReading"("symbol", "universeKey", "barTime");
