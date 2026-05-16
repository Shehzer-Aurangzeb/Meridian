# Meridian API - Usage Examples

## Quick Start

### Basic Analysis (No Risk Management)

Get a quick analysis to see if there's a trade setup.

```bash
curl -X POST http://localhost:3001/analysis/complete \
  -H "Content-Type: application/json" \
  -d '{
    "coin": "BTC"
  }'
```

**Use case:** Just want to see if there's a setup, don't need position sizing.

---

## Complete Analysis Examples

### Day Trade with Risk Management

Full analysis for a day trader with $10,000 account.

```bash
curl -X POST http://localhost:3001/analysis/complete \
  -H "Content-Type: application/json" \
  -d '{
    "coin": "ETH",
    "tradeType": "day",
    "accountBalance": 10000,
    "riskPercentage": 1,
    "experienceLevel": "intermediate",
    "riskTolerance": "moderate"
  }'
```

**Expected response highlights:**
- Leverage recommendation: 3-5x
- Position size based on 1% risk
- Risk/reward ratios for each TP

---

### Swing Trade Setup (Conservative)

For beginners looking for daily swing trades with low leverage.

```bash
curl -X POST http://localhost:3001/analysis/complete \
  -H "Content-Type: application/json" \
  -d '{
    "coin": "SOL",
    "tradeType": "swing",
    "timeframe": "1d",
    "accountBalance": 5000,
    "riskPercentage": 1,
    "experienceLevel": "beginner",
    "riskTolerance": "conservative",
    "includeFibonacci": true
  }'
```

**Expected:**
- Leverage capped at 2-3x (beginner + conservative)
- Daily timeframe analysis
- Fibonacci levels included

---

### Scalp Setup (Aggressive)

For expert scalpers looking for 15m setups with higher leverage.

```bash
curl -X POST http://localhost:3001/analysis/complete \
  -H "Content-Type: application/json" \
  -d '{
    "coin": "BTC",
    "tradeType": "scalp",
    "timeframe": "15m",
    "accountBalance": 20000,
    "riskPercentage": 2,
    "experienceLevel": "expert",
    "riskTolerance": "aggressive"
  }'
```

**Expected:**
- Higher leverage (10-15x possible)
- 15m entry signals
- Tight stops with quick targets

---

## Standalone Utility Examples

### Position Sizing Only

Calculate position size without full analysis.

```bash
curl -X POST http://localhost:3001/analysis/position-size \
  -H "Content-Type: application/json" \
  -d '{
    "accountBalance": 10000,
    "riskPercentage": 1,
    "entryPrice": 28000,
    "stopLoss": 27000,
    "leverage": 5
  }'
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

---

### Leverage Recommendation Only

Get smart leverage recommendation.

```bash
curl -X POST http://localhost:3001/analysis/leverage-recommendation \
  -H "Content-Type: application/json" \
  -d '{
    "timeframe": "4h",
    "checklistScore": 80,
    "atr": 400,
    "currentPrice": 28000,
    "stopLossPercentage": 3,
    "experienceLevel": "intermediate",
    "marketCycle": "bull"
  }'
```

---

### Quick Bias Check

Check HTF bias without full analysis.

```bash
curl -X GET "http://localhost:3001/analysis/bias/BTC?tradeType=day"
```

---

### Support/Resistance Levels

Get key levels for a coin.

```bash
curl -X GET "http://localhost:3001/analysis/levels/BTC?timeframe=1d"
```

---

## Frontend Integration

### React/Next.js Example

```typescript
// types.ts
interface CompleteAnalysis {
  coin: string;
  timestamp: string;
  currentPrice: number;
  summary: {
    action: 'LONG' | 'SHORT' | 'WAIT';
    confidence: 'high' | 'medium' | 'low';
    quickReason: string;
    entry?: number;
    stopLoss?: number;
    targets?: number[];
    leverage?: number;
    warnings: string[];
    shouldTrade: boolean;
  };
  checklist: any;
  timeframeAnalysis: any;
  keyLevels: any;
  aiAnalysis: any;
  riskManagement?: any;
  meta: {
    processingTimeMs: number;
    cacheHit: boolean;
    dataFreshness: string;
  };
}

// api.ts
export async function analyzeToken(
  coin: string,
  accountBalance?: number,
  experienceLevel = 'intermediate',
  riskPercentage = 1,
): Promise<CompleteAnalysis> {
  const response = await fetch('/api/analysis/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coin,
      accountBalance,
      experienceLevel,
      riskPercentage,
      tradeType: 'day',
    }),
  });
  
  if (!response.ok) {
    throw new Error('Analysis failed');
  }
  
  return response.json();
}

// TradeCard.tsx
function TradeCard({ coin }: { coin: string }) {
  const [analysis, setAnalysis] = useState<CompleteAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  
  async function handleAnalyze() {
    setLoading(true);
    try {
      const result = await analyzeToken(coin, 10000);
      setAnalysis(result);
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setLoading(false);
    }
  }
  
  if (!analysis) {
    return <button onClick={handleAnalyze}>Analyze {coin}</button>;
  }
  
  const { summary } = analysis;
  
  if (!summary.shouldTrade) {
    return (
      <div className="trade-card wait">
        <h3>WAIT</h3>
        <p>{summary.quickReason}</p>
      </div>
    );
  }
  
  return (
    <div className={`trade-card ${summary.action.toLowerCase()}`}>
      <h3>{summary.action} {coin}</h3>
      <div className="confidence">{summary.confidence} confidence</div>
      
      <div className="trade-details">
        <div>Entry: ${summary.entry?.toLocaleString()}</div>
        <div>Stop: ${summary.stopLoss?.toLocaleString()}</div>
        <div>TP1: ${summary.targets?.[0]?.toLocaleString()}</div>
        <div>TP2: ${summary.targets?.[1]?.toLocaleString()}</div>
        <div>TP3: ${summary.targets?.[2]?.toLocaleString()}</div>
        <div>Leverage: {summary.leverage}x</div>
      </div>
      
      {summary.warnings.length > 0 && (
        <div className="warnings">
          {summary.warnings.map((w, i) => (
            <div key={i} className="warning">{w}</div>
          ))}
        </div>
      )}
      
      <div className="meta">
        Processed in {analysis.meta.processingTimeMs}ms
      </div>
    </div>
  );
}
```

---

### Mobile App Example (React Native)

```typescript
import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';

const API_BASE = 'https://api.meridian.app';

async function quickAnalysis(coin: string) {
  const response = await fetch(`${API_BASE}/analysis/quick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coin }),
  });
  return response.json();
}

function QuickAnalysisWidget({ coin }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const analyze = async () => {
    setLoading(true);
    const data = await quickAnalysis(coin);
    setResult(data);
    setLoading(false);
  };
  
  if (loading) return <ActivityIndicator />;
  
  if (!result) {
    return (
      <TouchableOpacity onPress={analyze}>
        <Text>Check {coin}</Text>
      </TouchableOpacity>
    );
  }
  
  return (
    <View>
      <Text>{result.summary.action}</Text>
      <Text>{result.summary.quickReason}</Text>
    </View>
  );
}
```

---

## Batch Analysis Example

Analyze multiple coins in sequence.

```typescript
const WATCHLIST = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK'];

async function analyzeWatchlist() {
  const results = [];
  
  for (const coin of WATCHLIST) {
    try {
      const analysis = await fetch('/api/analysis/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin }),
      }).then(r => r.json());
      
      results.push({
        coin,
        action: analysis.summary.action,
        confidence: analysis.summary.confidence,
        shouldTrade: analysis.summary.shouldTrade,
      });
      
      // Rate limit: wait 1 second between requests
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      results.push({ coin, error: 'Analysis failed' });
    }
  }
  
  // Filter to only tradeable setups
  const tradeable = results.filter(r => r.shouldTrade);
  console.log('Tradeable setups:', tradeable);
  
  return results;
}
```

---

## Error Handling Example

```typescript
async function safeAnalyze(coin: string) {
  try {
    const response = await fetch('/api/analysis/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coin }),
    });
    
    if (response.status === 429) {
      // Rate limited - wait and retry
      await new Promise(r => setTimeout(r, 60000));
      return safeAnalyze(coin);
    }
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Analysis failed');
    }
    
    return response.json();
  } catch (error) {
    console.error(`Analysis failed for ${coin}:`, error);
    return null;
  }
}
```

---

## Webhook Example (for alerts)

```typescript
// Server-side webhook handler
async function analyzeAndAlert(coin: string, webhookUrl: string) {
  const analysis = await fetch('http://localhost:3001/analysis/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coin,
      accountBalance: 10000,
      riskPercentage: 1,
    }),
  }).then(r => r.json());
  
  if (analysis.summary.shouldTrade) {
    // Send alert to Discord/Telegram
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🚀 **${analysis.summary.action} ${coin}**\n` +
          `Entry: $${analysis.summary.entry}\n` +
          `Stop: $${analysis.summary.stopLoss}\n` +
          `Targets: ${analysis.summary.targets?.join(', ')}\n` +
          `Leverage: ${analysis.summary.leverage}x\n` +
          `Confidence: ${analysis.summary.confidence}`,
      }),
    });
  }
}
```
