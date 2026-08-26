-- CreateTable
CREATE TABLE "FlowSample" (
    "symbol" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FlowSample_pkey" PRIMARY KEY ("symbol","metric","ts")
);

-- CreateIndex
CREATE INDEX "FlowSample_metric_ts_idx" ON "FlowSample"("metric", "ts");
