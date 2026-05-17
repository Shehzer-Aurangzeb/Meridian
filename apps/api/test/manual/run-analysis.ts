/**
 * Manual E2E Analysis Test
 * 
 * This script runs a complete analysis for a single coin and saves
 * the result to a JSON file for verification.
 * 
 * Usage: npx ts-node test/manual/run-analysis.ts
 * 
 * Prerequisites:
 * - Server must be running on port 3001 (pnpm dev)
 * - .env must have valid ANTHROPIC_API_KEY
 */

import * as fs from 'fs';
import * as path from 'path';

// Import request types
import { MultiTimeframeAnalysisDto } from '../../src/analysis/dto/multi-timeframe-request.dto';
import { CompleteAnalysisDto } from '../../src/analysis/dto/complete-analysis.dto';
import { CalculatePositionSizeDto } from '../../src/risk-management/dto/position-sizing.dto';
import { RecommendLeverageDto } from '../../src/risk-management/dto/leverage.dto';

// Import response/interface types
import { HealthResponseDto } from '../../src/common/dto/api-responses.dto';
import { MultiTimeframeAnalysisResult, HTFBiasResult } from '../../src/analysis/interfaces/multi-timeframe.types';
import { EntryChecklistResult } from '../../src/analysis/interfaces/checklist.types';
import { SupportResistanceLevel } from '../../src/analysis/interfaces/support-resistance.types';
import { CompleteAnalysisResponse, TradeSummary } from '../../src/analysis/interfaces/complete-analysis.types';
import { PositionSizingResult } from '../../src/risk-management/interfaces/position-sizing.types';
import { LeverageRecommendation } from '../../src/risk-management/interfaces/leverage.types';

const BASE_URL = 'http://localhost:3001';

// ============ API Response Wrappers ============

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error?: string | null;
  timestamp?: string;
}

type BiasApiResponse = ApiResponse<{
  symbol: string;
  htfBias: HTFBiasResult;
  shouldTrade: boolean;
  reasoning: string;
}>;

type LevelsApiResponse = ApiResponse<{
  symbol: string;
  timeframe: string;
  currentPrice: number;
  levels: SupportResistanceLevel[];
  nearestSupport: SupportResistanceLevel | null;
  nearestResistance: SupportResistanceLevel | null;
}>;

type MultiTimeframeApiResponse = ApiResponse<MultiTimeframeAnalysisResult>;
type PositionSizeApiResponse = ApiResponse<PositionSizingResult>;
type LeverageApiResponse = ApiResponse<LeverageRecommendation>;
type CompleteAnalysisApiResponse = ApiResponse<CompleteAnalysisResponse>;

// ============ API Helper ============

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }
  
  return response.json() as Promise<T>;
}

async function checkHealth(): Promise<boolean> {
  console.log('\n📡 Checking server health...');
  try {
    const health = await fetchJSON<HealthResponseDto>(`${BASE_URL}/health`);
    console.log(`   Status: ${health.status}`);
    console.log(`   Cache: ${health.cache}`);
    console.log(`   Binance: ${health.binance}`);
    console.log(`   Database: ${health.database}`);
    // Accept 'healthy' or 'degraded' (degraded = cache issue but Binance works)
    const isOk = health.status === 'healthy' || health.status === 'degraded';
    if (health.status === 'degraded') {
      console.log('   ⚠️  Server degraded but functional (cache issue)');
    }
    return isOk;
  } catch (error: unknown) {
    console.error('   ❌ Server not reachable. Is it running on port 3001?');
    if (error instanceof Error) {
      console.error('   Error:', error.message);
    }
    return false;
  }
}

async function runBiasAnalysis(coin: string): Promise<BiasApiResponse> {
  console.log(`\n📊 Running HTF bias analysis for ${coin}...`);
  return fetchJSON<BiasApiResponse>(`${BASE_URL}/analysis/bias/${coin}`);
}

async function runLevelsAnalysis(coin: string, timeframe: string): Promise<LevelsApiResponse> {
  console.log(`\n📈 Running S/R levels analysis for ${coin} (${timeframe})...`);
  return fetchJSON<LevelsApiResponse>(`${BASE_URL}/analysis/levels/${coin}?timeframe=${timeframe}`);
}

async function runMultiTimeframe(coin: string, tradeType: string): Promise<MultiTimeframeApiResponse> {
  console.log(`\n🕐 Running multi-timeframe analysis for ${coin} (${tradeType})...`);
  const body: Partial<MultiTimeframeAnalysisDto> = { coin, tradeType: tradeType as 'swing' | 'day' | 'scalp' };
  return fetchJSON<MultiTimeframeApiResponse>(`${BASE_URL}/analysis/multi-timeframe`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function runPositionSize(params: CalculatePositionSizeDto): Promise<PositionSizeApiResponse> {
  console.log(`\n💰 Calculating position size...`);
  return fetchJSON<PositionSizeApiResponse>(`${BASE_URL}/analysis/position-size`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

async function runLeverageRecommendation(params: RecommendLeverageDto): Promise<LeverageApiResponse> {
  console.log(`\n⚡ Getting leverage recommendation...`);
  return fetchJSON<LeverageApiResponse>(`${BASE_URL}/analysis/leverage-recommendation`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

async function runCompleteAnalysis(coin: string, params: Partial<CompleteAnalysisDto> = {}): Promise<CompleteAnalysisApiResponse> {
  console.log(`\n🔬 Running complete analysis for ${coin}...`);
  console.log(`   Parameters: ${JSON.stringify(params, null, 2)}`);
  
  const startTime = Date.now();
  const result = await fetchJSON<CompleteAnalysisApiResponse>(`${BASE_URL}/analysis/complete`, {
    method: 'POST',
    body: JSON.stringify({ coin, ...params }),
  });
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`   ⏱️  Completed in ${duration}s`);
  
  return result;
}

function saveResults(filename: string, data: Record<string, unknown>): void {
  const dir = path.join(__dirname, 'results');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`\n💾 Results saved to: ${filepath}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                  MERIDIAN E2E ANALYSIS TEST                   ');
  console.log('═══════════════════════════════════════════════════════════════');
  
  const coin = 'BTC';
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    coin,
    tests: {} as Record<string, unknown>,
  };
  const tests = results.tests as Record<string, unknown>;

  try {
    // Step 1: Health Check (FREE)
    console.log('\n[1/7] Health Check');
    const isHealthy = await checkHealth();
    tests.health = { passed: isHealthy };
    
    if (!isHealthy) {
      console.error('\n❌ Server health check failed. Aborting.');
      saveResults('analysis-results.json', results);
      process.exit(1);
    }

    // Step 2: HTF Bias Analysis (FREE - Binance only)
    console.log('\n[2/7] HTF Bias Analysis');
    const biasResponse = await runBiasAnalysis(coin);
    const biasData = biasResponse.data;
    tests.bias = {
      passed: biasResponse.success && !!biasData?.htfBias,
      data: biasData,
    };
    if (biasData) {
      console.log(`   ✅ HTF Bias: ${biasData.htfBias.bias} (${biasData.htfBias.confidence}% confidence)`);
      console.log(`   Reasoning: ${biasData.reasoning}`);
    }

    // Step 3: S/R Levels Analysis (FREE - Binance only)
    console.log('\n[3/7] Support/Resistance Levels');
    const levelsResponse = await runLevelsAnalysis(coin, '1d');
    const levelsData = levelsResponse.data;
    tests.levels = {
      passed: levelsResponse.success && !!levelsData?.levels?.length,
      levelCount: levelsData?.levels?.length ?? 0,
      data: levelsData?.levels?.slice(0, 3),
    };
    if (levelsData?.levels?.length) {
      console.log(`   ✅ Found ${levelsData.levels.length} key levels`);
      const nearest = levelsData.levels[0];
      console.log(`   Nearest: $${nearest.price} (${nearest.type}, strength ${nearest.strength}/5)`);
    }

    // Step 4: Multi-Timeframe Analysis (FREE - Binance only)
    console.log('\n[4/7] Multi-Timeframe Analysis');
    const mtfResponse = await runMultiTimeframe(coin, 'day');
    const mtfData = mtfResponse.data;
    tests.multiTimeframe = {
      passed: mtfResponse.success && !!mtfData?.currentPrice,
      currentPrice: mtfData?.currentPrice,
      checklistScore: mtfData?.fivePointChecklist?.totalScore,
    };
    if (mtfData) {
      console.log(`   ✅ Current price: $${mtfData.currentPrice?.toLocaleString()}`);
      console.log(`   ✅ HTF Bias: ${mtfData.htfBias?.bias} (${mtfData.htfBias?.confidence}% confidence)`);
      if (mtfData.fivePointChecklist) {
        console.log(`   ✅ Checklist: ${mtfData.fivePointChecklist.totalScore}/100 (${mtfData.fivePointChecklist.conditionsMet}/5 conditions)`);
      }
    }

    // Step 5: Position Size Calculator (FREE - No external API)
    console.log('\n[5/7] Position Size Calculator');
    const currentPrice = mtfData?.currentPrice || 48000;
    const positionParams: CalculatePositionSizeDto = {
      accountBalance: 10000,
      riskPercentage: 1,
      entryPrice: currentPrice,
      stopLoss: currentPrice * 0.97,
      leverage: 5,
    };
    const positionResponse = await runPositionSize(positionParams);
    const positionData = positionResponse.data;
    tests.positionSize = {
      passed: positionResponse.success && !!positionData?.positionSize,
      data: positionData,
    };
    if (positionData) {
      console.log(`   ✅ Position size: $${positionData.positionSize?.toLocaleString()}`);
      console.log(`   ✅ Risk amount: $${positionData.riskAmount}`);
      console.log(`   ✅ Margin required: $${positionData.margin?.toFixed(2)}`);
      console.log(`   ✅ Liquidation price: $${positionData.liquidationPrice?.toLocaleString()}`);
    }

    // Step 6: Leverage Recommendation (FREE - No external API)
    console.log('\n[6/7] Leverage Recommendation');
    const leverageParams: RecommendLeverageDto = {
      timeframe: '1h',
      checklistScore: mtfData?.fivePointChecklist?.totalScore || 75,
      atr: 500,
      currentPrice: currentPrice,
      stopLossPercentage: 3,
      experienceLevel: 'intermediate',
      riskTolerance: 'moderate',
    };
    const leverageResponse = await runLeverageRecommendation(leverageParams);
    const leverageData = leverageResponse.data;
    tests.leverage = {
      passed: leverageResponse.success && !!leverageData?.recommended,
      data: leverageData,
    };
    if (leverageData) {
      console.log(`   ✅ Recommended: ${leverageData.recommended}x`);
      console.log(`   ✅ Conservative: ${leverageData.conservative}x`);
      console.log(`   ✅ Moderate: ${leverageData.moderate}x`);
      console.log(`   ✅ Aggressive: ${leverageData.aggressive}x`);
      console.log(`   Reasoning: ${leverageData.reasoning}`);
    }

    // Step 7: COMPLETE ANALYSIS (PAID - Uses Claude API ~$0.01)
    console.log('\n[7/7] Complete Analysis with AI');
    console.log('⚠️  This step uses Claude API (costs ~$0.01)');
    
    const completeResponse = await runCompleteAnalysis(coin, {
      accountBalance: 10000,
      riskPercentage: 1,
      experienceLevel: 'intermediate',
      tradeType: 'day',
    });
    const completeData = completeResponse.data;
    
    tests.completeAnalysis = {
      passed: completeResponse.success && !!completeData?.summary,
      data: completeData,
    };
    
    if (completeData) {
      console.log('\n═══════════════════════════════════════════════════════════════');
      console.log('                      ANALYSIS SUMMARY                          ');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`   💰 Price: $${completeData.currentPrice?.toLocaleString()}`);
      console.log(`   📊 Action: ${completeData.summary?.action}`);
      console.log(`   💪 Confidence: ${completeData.summary?.confidence}`);
      console.log(`   ✅ Checklist: ${completeData.checklist?.totalScore}/100 (${completeData.checklist?.conditionsMet}/5)`);
      console.log(`   ✔️  Should Trade: ${completeData.summary?.shouldTrade ? 'YES' : 'NO'}`);
      console.log(`   📝 Reason: ${completeData.summary?.quickReason}`);
      
      if (completeData.summary?.warnings?.length) {
        console.log(`\n   ⚠️  Warnings:`);
        completeData.summary.warnings.forEach((w: string) => console.log(`      - ${w}`));
      }
      
      if (completeData.summary?.action !== 'WAIT' && completeData.aiAnalysis) {
        const ai = completeData.aiAnalysis as { entry?: { price: number }; stopLoss?: { price: number }; takeProfit?: { tp1?: { price: number; gain: string }; tp2?: { price: number; gain: string }; tp3?: { price: number; gain: string } } };
        console.log('\n   💼 Trade Setup:');
        console.log(`      Entry: $${ai.entry?.price?.toLocaleString()}`);
        console.log(`      Stop Loss: $${ai.stopLoss?.price?.toLocaleString()}`);
        console.log(`      TP1: $${ai.takeProfit?.tp1?.price?.toLocaleString()} (${ai.takeProfit?.tp1?.gain})`);
        console.log(`      TP2: $${ai.takeProfit?.tp2?.price?.toLocaleString()} (${ai.takeProfit?.tp2?.gain})`);
        console.log(`      TP3: $${ai.takeProfit?.tp3?.price?.toLocaleString()} (${ai.takeProfit?.tp3?.gain})`);
        
        const rm = completeData.riskManagement;
        if (rm) {
          console.log('\n   🎯 Risk Management:');
          console.log(`      Leverage: ${rm.leverageRecommendation?.recommended}x`);
          console.log(`      Position Size: $${rm.positionSizing?.positionSize?.toLocaleString()}`);
          console.log(`      Margin Required: $${rm.positionSizing?.margin?.toFixed(2)}`);
          console.log(`      Risk Amount: $${rm.positionSizing?.riskAmount}`);
          console.log(`      R:R Ratio: ${rm.riskReward?.overall?.toFixed(2)}:1`);
          console.log(`      Liquidation: $${rm.positionSizing?.liquidationPrice?.toLocaleString()}`);
        }
      }
    }

    // Calculate final results
    const passedTests = Object.values(tests).filter((t: unknown) => (t as { passed: boolean }).passed).length;
    const totalTests = Object.keys(tests).length;
    
    results.summary = {
      passedTests,
      totalTests,
      allPassed: passedTests === totalTests,
    };

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`                 RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (passedTests === totalTests) {
      console.log('✅ All tests passed! Backend is ready for frontend integration.');
    } else {
      console.log('❌ Some tests failed. Review the errors above.');
    }

    // Save results
    saveResults(`analysis-${coin}-${Date.now()}.json`, results);

    process.exit(passedTests === totalTests ? 0 : 1);
    
  } catch (error: unknown) {
    console.error('\n❌ Fatal error:', error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
      results.error = error.message;
      results.stack = error.stack;
    }
    saveResults('analysis-error.json', results);
    process.exit(1);
  }
}

main();
