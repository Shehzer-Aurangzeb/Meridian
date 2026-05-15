import { API_URL } from './constants';
import type { AnalysisResponse } from '@/types/analysis';
import type { PerformanceResponse } from '@/types/history';

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

/**
 * Analyze a coin
 */
export async function analyzeCooin(coin: string): Promise<AnalysisResponse> {
  return fetchApi<AnalysisResponse>('/analysis/analyze', {
    method: 'POST',
    body: JSON.stringify({ coin }),
  });
}

/**
 * Get performance stats
 */
export async function getPerformance(coin?: string): Promise<PerformanceResponse> {
  const endpoint = coin && coin !== 'all'
    ? `/analysis/performance/${coin}`
    : '/analysis/performance';
  return fetchApi<PerformanceResponse>(endpoint);
}

/**
 * Get analysis history
 */
export async function getHistory(): Promise<{ success: boolean; data?: unknown[]; error?: string }> {
  return fetchApi('/analysis/history');
}
