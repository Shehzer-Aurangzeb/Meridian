'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { 
  Timeframe, 
  CoordinateAnalysisResponse,
  StreamAnalysisEvent 
} from '@/types';
import { queryKeys } from './query-keys';

// ============ Types ============

interface CoordinateAnalysisParams {
  coin: string;
  timeframe: Timeframe;
}

// ============ Fetch Helper ============

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }
  
  return response.json();
}

// ============ Hooks ============

/**
 * Hook for running coordinated analysis (non-streaming)
 */
export function useCoordinateAnalysis() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (params: CoordinateAnalysisParams) => {
      return fetchApi<CoordinateAnalysisResponse>('/api/analysis/coordinate', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },
    onSuccess: (_data, variables) => {
      // Invalidate related queries after successful analysis
      queryClient.invalidateQueries({ queryKey: queryKeys.history.byCoin(variables.coin) });
      queryClient.invalidateQueries({ queryKey: queryKeys.performance.all });
    },
  });
}

/**
 * Create SSE stream for real-time analysis updates
 * 
 * Usage:
 * ```tsx
 * const stream = useAnalysisStream();
 * 
 * const handleAnalyze = () => {
 *   const eventSource = stream.connect({ coin: 'BTC', timeframe: '1h' });
 *   
 *   stream.onEvent(eventSource, (event) => {
 *     if (event.status === 'COMPLETE') {
 *       // Handle completion
 *     }
 *   });
 * };
 * ```
 */
export function useAnalysisStream() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  
  const connect = (params: CoordinateAnalysisParams): EventSource => {
    const url = new URL(`${API_URL}/analysis-coordinator/stream`);
    url.searchParams.set('coin', params.coin.toUpperCase());
    url.searchParams.set('timeframe', params.timeframe);
    
    return new EventSource(url.toString());
  };
  
  const onEvent = (
    eventSource: EventSource,
    callback: (event: StreamAnalysisEvent) => void
  ) => {
    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as StreamAnalysisEvent;
        callback(event);
        
        // Auto-close on terminal events
        if (event.status === 'COMPLETE' || event.status === 'ERROR') {
          eventSource.close();
        }
      } catch {
        console.error('Failed to parse SSE event:', e.data);
      }
    };
    
    eventSource.onerror = () => {
      eventSource.close();
    };
  };
  
  return { connect, onEvent };
}
