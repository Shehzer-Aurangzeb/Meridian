# Meridian API Reference

## Overview

Base URL: `http://localhost:3001` (development)

All endpoints return JSON. Successful responses have 200 status code.

---

## Main Endpoints

### POST /analysis/complete

**Complete analysis with all features**

The primary endpoint for getting full trade analysis including multi-timeframe analysis, checklist, support/resistance, AI recommendations, and risk management.

**Request Body:**

```json
{
  "coin": "BTC",
  "tradeType": "day",
  "timeframe": "1h",
  "accountBalance": 10000,
  "riskPercentage": 1,
  "experienceLevel": "intermediate",
  "riskTolerance": "moderate",
  "includeFibonacci": true
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| coin | string | Yes | Coin symbol (BTC, ETH, SOL, etc.) |
| tradeType | enum | No | 'swing', 'day', or 'scalp' (default: 'day') |
| timeframe | string | No | '1h', '4h', '1d', etc. (default based on tradeType) |
| accountBalance | number | No | Account size in USD (enables risk management) |
| riskPercentage | number | No | Risk per trade 0.5-5% (default: 1) |
| experienceLevel | enum | No | 'beginner', 'intermediate', 'advanced', 'expert' |
| riskTolerance | enum | No | 'conservative', 'moderate', 'aggressive' |
| includeRiskManagement | boolean | No | Enable risk calculations (default: true if accountBalance provided) |
| includeFibonacci | boolean | No | Include Fibonacci levels (default: false) |

**Response:**

```json
{
  "coin": "BTC",
  "timestamp": "2024-01-15T10:30:00Z",
  "currentPrice": 28750,
  
  "summary": {
    "action": "LONG",
    "confidence": "high",
    "quickReason": "5/5 conditions met. Strong oversold setup at support.",
    "entry": 28750,
    "stopLoss": 27750,
    "targets": [29500, 30500, 31750],
    "leverage": 5,
    "warnings": [],
    "shouldTrade": true
  },
  
  "checklist": {
    "totalScore": 100,
    "conditionsMet": 5,
    "passed": true,
    "tradeType": "day",
    "conditions": [
      { "name": "RSI Oversold/Overbought", "passed": true, "score": 20, "reason": "..." },
      { "name": "QQE Color Match", "passed": true, "score": 20, "reason": "..." },
      { "name": "Bollinger Band Position", "passed": true, "score": 20, "reason": "..." },
      { "name": "Market Structure", "passed": true, "score": 20, "reason": "..." },
      { "name": "Support/Resistance Level", "passed": true, "score": 20, "reason": "..." }
    ]
  },
  
  "timeframeAnalysis": {
    "htfBias": {
      "bias": "bullish",
      "confidence": 100,
      "reasoning": "All HTF showing HH/HL pattern"
    },
    "ltfEntry": {
      "signal": "long",
      "timeframe": "1h",
      "hasEntry": true,
      "reason": "RSI oversold at support"
    },
    "tradeSuggestion": {
      "action": "LONG",
      "reasoning": "HTF bullish, LTF entry signal confirmed"
    },
    "timeframeAnalyses": [...]
  },
  
  "keyLevels": {
    "support": [
      { "price": 28600, "strength": 4, "type": "support", "distancePercent": 0.5 }
    ],
    "resistance": [
      { "price": 29800, "strength": 3, "type": "resistance", "distancePercent": 3.6 }
    ]
  },
  
  "aiAnalysis": {
    "action": "LONG",
    "confidence": 95,
    "entry": { "price": 28750, "reasoning": "..." },
    "stopLoss": { "price": 27750, "method": "Below recent swing low" },
    "takeProfit": {
      "tp1": { "price": 29500, "percentage": 2.6, "reasoning": "..." },
      "tp2": { "price": 30500, "percentage": 6.1, "reasoning": "..." },
      "tp3": { "price": 31750, "percentage": 10.4, "reasoning": "..." }
    },
    "leverage": { "recommended": 5, "rationale": "..." },
    "summary": "Strong oversold setup at support...",
    "reasoning": {
      "primary": "...",
      "htfAlignment": "...",
      "indicatorSignals": "...",
      "riskConsiderations": "..."
    }
  },
  
  "riskManagement": {
    "leverageRecommendation": {
      "recommended": 5,
      "conservative": 3,
      "moderate": 5,
      "aggressive": 7,
      "reasoning": "Base 5x for 1h day trades",
      "adjustments": ["..."],
      "liquidationPrice": 27187.5,
      "liquidationDistance": "5.4% below entry",
      "maxDrawdown": "20.0%",
      "warnings": [],
      "tradeStyle": "day",
      "riskLevel": "medium"
    },
    "positionSizing": {
      "riskAmount": 100,
      "positionSize": 2801.12,
      "coinAmount": 0.097426,
      "margin": 560.22,
      "marginPercentage": 5.6,
      "stopLossPercentage": 3.57,
      "liquidationPrice": 27187.5,
      "direction": "long",
      "maxLoss": 100,
      "isValid": true,
      "warnings": []
    },
    "riskReward": {
      "overall": 2.55,
      "tp1": 0.75,
      "tp2": 1.5,
      "tp3": 3.0
    }
  },
  
  "meta": {
    "processingTimeMs": 1850,
    "cacheHit": false,
    "dataFreshness": "Real-time"
  }
}
```

---

### POST /analysis/quick

**Quick analysis without risk management**

Same as `/complete` but skips risk management calculations. Faster response.

**Request:**
```json
{
  "coin": "ETH"
}
```

**Response:** Same structure as `/complete` but without `riskManagement` field.

---

## Position Sizing Endpoints

### POST /analysis/position-size

Calculate position size for a trade.

**Request:**
```json
{
  "accountBalance": 10000,
  "riskPercentage": 1,
  "entryPrice": 28000,
  "stopLoss": 27000,
  "leverage": 5
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "riskAmount": 100,
    "positionSize": 2800,
    "coinAmount": 0.1,
    "margin": 560,
    "marginPercentage": 5.6,
    "stopLossPercentage": 3.57,
    "liquidationPrice": 26600,
    "direction": "long",
    "maxLoss": 100,
    "isValid": true,
    "warnings": []
  }
}
```

### POST /analysis/risk-reward

Calculate risk/reward ratios for take profit levels.

**Request:**
```json
{
  "entryPrice": 28000,
  "stopLoss": 27000,
  "tp1": 29000,
  "tp2": 30000,
  "tp3": 31500
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tp1": 1,
    "tp2": 2,
    "tp3": 3.5,
    "overall": 2.55
  }
}
```

### GET /analysis/portfolio-allocation

Get portfolio allocation based on Miraj's 60/20/20 rule.

**Query params:** `?balance=10000`

**Response:**
```json
{
  "success": true,
  "data": {
    "totalBalance": 10000,
    "longTerm": { "allocation": 6000, "leverage": 1, "description": "HTF swing trades" },
    "midTerm": { "allocation": 2000, "leverage": 2, "description": "Day trades" },
    "shortTerm": { "allocation": 2000, "leverage": 5, "description": "Scalps" }
  }
}
```

---

## Leverage Endpoints

### POST /analysis/leverage-recommendation

Get smart leverage recommendation based on multiple factors.

**Request:**
```json
{
  "timeframe": "4h",
  "checklistScore": 80,
  "atr": 400,
  "currentPrice": 28000,
  "stopLossPercentage": 3,
  "experienceLevel": "intermediate",
  "riskTolerance": "moderate",
  "marketCycle": "bull"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "recommended": 5,
    "conservative": 3,
    "moderate": 5,
    "aggressive": 7,
    "reasoning": "Base 5x for 4h day trades",
    "adjustments": [],
    "liquidationPrice": 26600,
    "liquidationDistance": "5.0% below entry",
    "maxDrawdown": "20.0%",
    "warnings": [],
    "tradeStyle": "day",
    "riskLevel": "medium"
  }
}
```

### GET /analysis/leverage-constraints

Get leverage constraints for experience level and timeframe.

**Query params:** `?experienceLevel=intermediate&timeframe=4h`

**Response:**
```json
{
  "success": true,
  "data": {
    "min": 1,
    "max": 5,
    "reason": "intermediate traders on 4h timeframe"
  }
}
```

### GET /analysis/leverage/:timeframe

Get recommended leverage for a specific timeframe.

**Response:**
```json
{
  "success": true,
  "data": {
    "timeframe": "4h",
    "recommended": 5,
    "min": 3,
    "max": 7
  }
}
```

---

## Multi-Timeframe Endpoints

### POST /analysis/multi-timeframe

Full multi-timeframe analysis with 5-point checklist.

**Request:**
```json
{
  "coin": "BTC",
  "tradeType": "day",
  "includeDetailedChecklist": true
}
```

### GET /analysis/bias/:coin

Get quick HTF bias for a coin.

**Query params:** `?tradeType=day`

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "BTCUSDT",
    "htfBias": {
      "bias": "bullish",
      "confidence": 85,
      "reasoning": "Daily and 12h showing HH/HL"
    },
    "shouldTrade": true,
    "reasoning": "HTF bias bullish, conditions met"
  }
}
```

---

## Support/Resistance Endpoints

### GET /analysis/levels/:coin

Get support/resistance levels.

**Query params:** `?timeframe=1d`

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "BTCUSDT",
    "timeframe": "1d",
    "currentPrice": 28750,
    "levels": [...],
    "nearestSupport": {...},
    "nearestResistance": {...}
  }
}
```

### GET /analysis/levels/:coin/full

Get full S/R analysis including Fibonacci levels.

### GET /analysis/levels/:coin/nearest

Get nearest level.

**Query params:** `?type=support&timeframe=1d`

---

## AI Analysis Endpoints

### POST /analysis/ai-analyze

Enhanced AI analysis using multi-timeframe data and checklist.

**Request:**
```json
{
  "coin": "BTC",
  "tradeType": "day"
}
```

### POST /analysis/test-prompt

Test the prompt that would be sent to Claude (debugging).

---

## Validation Endpoints

### GET /analysis/validate/:coin

Validate indicator calculations against TradingView.

**Query params:** `?timeframe=1d`

---

## Basic Endpoints

### POST /analysis/analyze

Simple single-timeframe analysis.

**Request:**
```json
{
  "coin": "BTC",
  "timeframe": "4h"
}
```

### GET /analysis/history

Get analysis history.

**Query params:** `?limit=50&startDate=2024-01-01&endDate=2024-01-31`

### GET /analysis/history/:coin

Get analysis history for specific coin.

### GET /analysis/performance

Get performance metrics.

### GET /analysis/performance/:coin

Get performance metrics for specific coin.

---

## Error Responses

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "accountBalance",
      "message": "accountBalance must be at least 100"
    }
  ]
}
```

**Common Status Codes:**
- 200: Success
- 400: Bad request (invalid input)
- 429: Rate limited
- 500: Server error

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| /analysis/complete | 5 req/min |
| /analysis/ai-analyze | 5 req/min |
| /analysis/analyze | 10 req/min |
| /analysis/multi-timeframe | 20 req/min |
| /analysis/bias/:coin | 30 req/min |
| Position/Leverage endpoints | No limit |
| GET endpoints | 100 req/min |

---

## Health Check

### GET /health

Check API health status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "services": {
    "database": "connected",
    "binance": "connected",
    "claude": "available"
  }
}
```
