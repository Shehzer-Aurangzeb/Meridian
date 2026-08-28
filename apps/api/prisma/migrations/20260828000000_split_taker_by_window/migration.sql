-- `takerBuySellRatio` was collected at period=1h only, so every existing row is
-- Binance's HOURLY taker aggregate. The 5-minute series imported from the bulk
-- archive is a different statistic: measured over 41 hours of BTCUSDT, the mean
-- of twelve 5m ratios misses the 1h ratio by 13.9% at the median and 67.3% at
-- worst, and only sum(buyVol)/sum(sellVol) reconstructs it -- which the archive
-- does not publish.
--
-- Sharing one metric name would therefore put a silent discontinuity at the
-- archive/collector boundary. Rename so the window is in the name.
UPDATE "FlowSample" SET metric = 'takerBuySellRatio1h' WHERE metric = 'takerBuySellRatio';
