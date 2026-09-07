-- CreateTable
CREATE TABLE "BookProfile" (
    "symbol" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "shell" INTEGER NOT NULL,
    "bidNotional" DOUBLE PRECISION NOT NULL,
    "askNotional" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BookProfile_pkey" PRIMARY KEY ("symbol","ts","shell")
);

-- CreateIndex
CREATE INDEX "BookProfile_symbol_ts_idx" ON "BookProfile"("symbol", "ts");
