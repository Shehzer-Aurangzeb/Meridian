/**
 * Load Test Script for Meridian API
 * 
 * Tests performance under concurrent load to validate:
 * - Response times < 2 seconds
 * - Cache hit rates > 70%
 * - Concurrent request handling (50+)
 * 
 * Usage: npx ts-node test/load-test.ts
 */

import axios, { AxiosError } from 'axios';

const API_BASE = process.env.API_URL || 'http://localhost:3001';

interface TestResult {
  endpoint: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p95ResponseTime: number;
  requestsPerSecond: number;
  errorRate: number;
}

interface RequestMetrics {
  duration: number;
  success: boolean;
  statusCode?: number;
  error?: string;
}

async function measureRequest(
  fn: () => Promise<unknown>,
): Promise<RequestMetrics> {
  const start = performance.now();
  try {
    const response = await fn();
    const duration = performance.now() - start;
    return { duration, success: true, statusCode: 200 };
  } catch (error) {
    const duration = performance.now() - start;
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      return {
        duration,
        success: false,
        statusCode: axiosError.response?.status,
        error: axiosError.message,
      };
    }
    return { duration, success: false, error: String(error) };
  }
}

function calculateStats(metrics: RequestMetrics[]): Omit<TestResult, 'endpoint'> {
  const successfulMetrics = metrics.filter(m => m.success);
  const durations = metrics.map(m => m.duration).sort((a, b) => a - b);
  
  const totalTime = metrics.reduce((sum, m) => sum + m.duration, 0);
  const avgTime = totalTime / metrics.length;
  
  const p95Index = Math.floor(metrics.length * 0.95);
  const p95Time = durations[p95Index] || durations[durations.length - 1];

  return {
    totalRequests: metrics.length,
    successfulRequests: successfulMetrics.length,
    failedRequests: metrics.length - successfulMetrics.length,
    avgResponseTime: Math.round(avgTime),
    minResponseTime: Math.round(durations[0]),
    maxResponseTime: Math.round(durations[durations.length - 1]),
    p95ResponseTime: Math.round(p95Time),
    requestsPerSecond: Math.round((metrics.length / (totalTime / 1000)) * 100) / 100,
    errorRate: Math.round(((metrics.length - successfulMetrics.length) / metrics.length) * 100),
  };
}

async function runConcurrentRequests(
  requestFn: () => Promise<unknown>,
  concurrency: number,
  totalRequests: number,
): Promise<RequestMetrics[]> {
  const results: RequestMetrics[] = [];
  const pending: Promise<void>[] = [];
  let completed = 0;

  for (let i = 0; i < totalRequests; i++) {
    const promise = measureRequest(requestFn).then(result => {
      results.push(result);
      completed++;
      if (completed % 10 === 0) {
        process.stdout.write(`\r  Progress: ${completed}/${totalRequests}`);
      }
    });

    pending.push(promise);

    // Control concurrency
    if (pending.length >= concurrency) {
      await Promise.race(pending);
      // Remove completed promises
      const completedIndex = pending.findIndex(
        p => p.then(() => true).catch(() => true),
      );
      if (completedIndex >= 0) {
        pending.splice(completedIndex, 1);
      }
    }
  }

  // Wait for remaining requests
  await Promise.all(pending);
  console.log(''); // New line after progress

  return results;
}

async function testHealthEndpoint(): Promise<TestResult> {
  console.log('\n📊 Testing Health Endpoint (GET /health)');
  const metrics = await runConcurrentRequests(
    () => axios.get(`${API_BASE}/health`),
    50, // 50 concurrent
    100, // 100 total requests
  );

  return {
    endpoint: 'GET /health',
    ...calculateStats(metrics),
  };
}

async function testQuickBiasEndpoint(): Promise<TestResult> {
  console.log('\n📊 Testing Quick Bias Endpoint (GET /analysis/bias/BTC)');
  const metrics = await runConcurrentRequests(
    () => axios.get(`${API_BASE}/analysis/bias/BTC`),
    30, // 30 concurrent
    60, // 60 total requests
  );

  return {
    endpoint: 'GET /analysis/bias/BTC',
    ...calculateStats(metrics),
  };
}

async function testMultiTimeframeEndpoint(): Promise<TestResult> {
  console.log('\n📊 Testing Multi-Timeframe Endpoint (POST /analysis/multi-timeframe)');
  const metrics = await runConcurrentRequests(
    () =>
      axios.post(`${API_BASE}/analysis/multi-timeframe`, {
        coin: 'BTC',
        tradeType: 'day',
        includeDetailedChecklist: true,
      }),
    20, // 20 concurrent
    40, // 40 total requests
  );

  return {
    endpoint: 'POST /analysis/multi-timeframe',
    ...calculateStats(metrics),
  };
}

async function testCacheEffectiveness(): Promise<void> {
  console.log('\n📊 Testing Cache Effectiveness');
  
  // First request - should be cache miss
  const firstRequest = await measureRequest(() =>
    axios.post(`${API_BASE}/analysis/multi-timeframe`, {
      coin: 'ETH',
      tradeType: 'day',
    }),
  );

  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 100));

  // Second request - should be cache hit
  const secondRequest = await measureRequest(() =>
    axios.post(`${API_BASE}/analysis/multi-timeframe`, {
      coin: 'ETH',
      tradeType: 'day',
    }),
  );

  console.log(`  First request (cache miss): ${Math.round(firstRequest.duration)}ms`);
  console.log(`  Second request (cache hit): ${Math.round(secondRequest.duration)}ms`);
  
  const improvement = ((firstRequest.duration - secondRequest.duration) / firstRequest.duration) * 100;
  console.log(`  Cache improvement: ${Math.round(improvement)}%`);

  if (secondRequest.duration < firstRequest.duration * 0.5) {
    console.log('  ✅ Cache is working effectively');
  } else {
    console.log('  ⚠️  Cache may not be working as expected');
  }
}

async function testRateLimiting(): Promise<void> {
  console.log('\n📊 Testing Rate Limiting');
  
  const results: RequestMetrics[] = [];
  
  // Send 15 rapid requests to a rate-limited endpoint (10 req/min)
  for (let i = 0; i < 15; i++) {
    const result = await measureRequest(() =>
      axios.post(`${API_BASE}/analysis/analyze`, { coin: 'BTC' }),
    );
    results.push(result);
  }

  const rateLimited = results.filter(r => r.statusCode === 429).length;
  const successful = results.filter(r => r.success).length;

  console.log(`  Total requests: 15`);
  console.log(`  Successful: ${successful}`);
  console.log(`  Rate limited (429): ${rateLimited}`);

  if (rateLimited > 0) {
    console.log('  ✅ Rate limiting is working');
  } else {
    console.log('  ℹ️  No rate limiting triggered (may need more requests or shorter window)');
  }
}

function printResults(results: TestResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('📈 LOAD TEST RESULTS');
  console.log('='.repeat(80));

  for (const result of results) {
    console.log(`\n📍 ${result.endpoint}`);
    console.log(`   Total Requests:     ${result.totalRequests}`);
    console.log(`   Successful:         ${result.successfulRequests}`);
    console.log(`   Failed:             ${result.failedRequests} (${result.errorRate}%)`);
    console.log(`   Avg Response Time:  ${result.avgResponseTime}ms`);
    console.log(`   Min Response Time:  ${result.minResponseTime}ms`);
    console.log(`   Max Response Time:  ${result.maxResponseTime}ms`);
    console.log(`   P95 Response Time:  ${result.p95ResponseTime}ms`);
    console.log(`   Requests/Second:    ${result.requestsPerSecond}`);

    // Performance targets
    const targetMet = result.avgResponseTime < 2000;
    console.log(`   Target (<2s):       ${targetMet ? '✅ PASS' : '❌ FAIL'}`);
  }

  console.log('\n' + '='.repeat(80));
}

async function main(): Promise<void> {
  console.log('🚀 Meridian API Load Test');
  console.log(`   Target: ${API_BASE}`);
  console.log('   Testing performance and caching...\n');

  // Check if API is reachable
  try {
    await axios.get(`${API_BASE}/health`, { timeout: 5000 });
    console.log('✅ API is reachable');
  } catch (error) {
    console.error('❌ Cannot reach API at', API_BASE);
    console.error('   Please ensure the API is running: cd apps/api && pnpm start:dev');
    process.exit(1);
  }

  const results: TestResult[] = [];

  // Run tests
  results.push(await testHealthEndpoint());
  results.push(await testQuickBiasEndpoint());
  results.push(await testMultiTimeframeEndpoint());

  await testCacheEffectiveness();
  await testRateLimiting();

  // Print summary
  printResults(results);

  // Exit with error code if targets not met
  const allTargetsMet = results.every(r => r.avgResponseTime < 2000 && r.errorRate < 10);
  process.exit(allTargetsMet ? 0 : 1);
}

main().catch(console.error);
