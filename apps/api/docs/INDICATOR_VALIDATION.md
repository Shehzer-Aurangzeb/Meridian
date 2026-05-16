# Indicator Validation Results

This document tracks the validation of all technical indicators against TradingView to ensure accuracy.

## Validation Process

1. **Test Data Source**: Binance BTC/USDT and ETH/USDT daily candles
2. **Reference**: TradingView with default indicator settings
3. **Tolerance**: Small differences are acceptable due to:
   - Rounding differences
   - Timestamp alignment
   - Data source variations

## Indicator Validation Status

### RSI (Relative Strength Index)

| Property | Value |
|----------|-------|
| **Period** | 14 |
| **Smoothing** | Wilder's smoothing (EMA-based) |
| **Library** | `technicalindicators` |
| **Formula** | RSI = 100 - (100 / (1 + RS)) where RS = Avg Gain / Avg Loss |
| **Accuracy** | Within ±0.5 points of TradingView |
| **Status** | ⏳ Pending validation |

**Known Issues:**
- None identified

**Validation Notes:**
- Uses Wilder's smoothing method (industry standard)
- First value appears after `period + 1` candles

---

### Bollinger Bands

| Property | Value |
|----------|-------|
| **Period** | 20 (configurable) |
| **Std Dev Multiplier** | 2 (configurable) |
| **Middle Band** | Simple Moving Average (SMA) |
| **Upper/Lower** | Middle ± (StdDev × Multiplier) |
| **Library** | `technicalindicators` |
| **Accuracy** | Within ±1% of TradingView |
| **Status** | ⏳ Pending validation |

**Known Issues:**
- None identified

**Validation Notes:**
- Middle band exactly matches 20-period SMA
- Standard deviation uses population formula (n, not n-1)

---

### ATR (Average True Range)

| Property | Value |
|----------|-------|
| **Period** | 14 |
| **Smoothing** | Wilder's smoothing |
| **True Range** | max(high-low, abs(high-prevClose), abs(low-prevClose)) |
| **Library** | `technicalindicators` |
| **Accuracy** | Within ±$50 for BTC (±1% relative) |
| **Status** | ⏳ Pending validation |

**Known Issues:**
- First 14 values are undefined (expected behavior)

**Validation Notes:**
- Uses Wilder's smoothing for consistency
- Returns absolute value (not percentage)

---

### QQE Mod (Quantitative Qualitative Estimation)

| Property | Value |
|----------|-------|
| **RSI Period** | 14 |
| **Smoothing Period** | 5 (EMA) |
| **Output** | Color (green/red/neutral), value, trend |
| **Formula** | Custom RSI-based with momentum detection |
| **Accuracy** | N/A (custom indicator) |
| **Status** | ✅ Consistent |

**Known Issues:**
- Cannot compare directly with TradingView (custom implementation)

**Validation Notes:**
- Based on smoothed RSI with trend detection
- Crossover detection working correctly
- Color assignments:
  - Green: Bullish momentum (RSI rising, above 50)
  - Red: Bearish momentum (RSI falling, below 50)
  - Neutral: No clear direction

---

### Band Width

| Property | Value |
|----------|-------|
| **Formula** | (Upper - Lower) / Middle × 100 |
| **Output** | Percentage |
| **Accuracy** | Exact (simple math) |
| **Status** | ✅ Validated |

**Example Calculation:**
```
Upper: 30000
Middle: 29000
Lower: 28000
Width = (30000 - 28000) / 29000 × 100 = 6.9%
```

---

## Manual Validation Steps

### Using the Validation Endpoint

1. Start the API server: `pnpm dev`
2. Call the validation endpoint:
   ```bash
   curl http://localhost:3000/analysis/validate/BTC?timeframe=1d
   ```
3. Open TradingView with BTC/USDT Daily chart
4. Add indicators:
   - RSI (14)
   - Bollinger Bands (20, 2)
   - ATR (14)
5. Compare values from the API response with TradingView
6. Document any differences below

### Validation Records

#### BTC/USDT Daily - [DATE]

| Indicator | API Value | TradingView Value | Difference | Status |
|-----------|-----------|-------------------|------------|--------|
| RSI(14) | - | - | - | ⏳ |
| BB Upper | - | - | - | ⏳ |
| BB Middle | - | - | - | ⏳ |
| BB Lower | - | - | - | ⏳ |
| ATR(14) | - | - | - | ⏳ |

#### ETH/USDT Daily - [DATE]

| Indicator | API Value | TradingView Value | Difference | Status |
|-----------|-----------|-------------------|------------|--------|
| RSI(14) | - | - | - | ⏳ |
| BB Upper | - | - | - | ⏳ |
| BB Middle | - | - | - | ⏳ |
| BB Lower | - | - | - | ⏳ |
| ATR(14) | - | - | - | ⏳ |

---

## Edge Cases Tested

### Flat Market (No Volatility)
- **RSI**: Returns ~50 or undefined (no gains/losses)
- **BB**: Upper = Middle = Lower (no deviation)
- **ATR**: Returns 0 (no range)

### Strong Uptrend (All Gains)
- **RSI**: Approaches 100 (typically >90)
- **BB**: Price near upper band
- **QQE**: Green color, rising trend

### Strong Downtrend (All Losses)
- **RSI**: Approaches 0 (typically <10)
- **BB**: Price near lower band
- **QQE**: Red color, falling trend

### Insufficient Data
- All indicators throw appropriate errors
- Minimum data requirements documented

---

## Library Information

**technicalindicators** (v3.1.0)
- Well-maintained TypeScript library
- Uses industry-standard formulas
- Implements Wilder's smoothing correctly
- Open source: https://github.com/anandanand84/technicalindicators

---

## Running Tests

```bash
cd apps/api

# Run all indicator tests
pnpm test indicators.service.spec.ts

# Run with verbose output
pnpm test indicators.service.spec.ts --verbose

# Run with coverage
pnpm test:cov
```

---

## Troubleshooting

### RSI Doesn't Match TradingView

1. **Check candle alignment**: TradingView may include current (incomplete) candle
2. **Verify period**: Ensure both use period=14
3. **Check smoothing**: TradingView uses Wilder's smoothing by default

### Bollinger Bands Don't Match

1. **Check SMA**: Middle band should exactly match 20-period SMA
2. **Verify std dev**: TradingView uses 2.0 multiplier by default
3. **Population vs Sample**: Both should use population std dev

### ATR Doesn't Match

1. **Check True Range**: Verify correct TR formula
2. **Verify smoothing**: Should use Wilder's smoothing
3. **Check period**: Both should use period=14

---

## Version History

| Date | Changes |
|------|---------|
| 2024-01-15 | Initial documentation created |
| - | Pending: First validation pass |
