'use client';

import { useCallback, useMemo, useReducer, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCoordinateAnalysis } from '@/lib/hooks/use-analysis';
import { useToast } from '@/components/ui/toast';
import {
  mapToSignalData,
  mapToIndicatorsData,
  mapToReasoningData,
  mapUITimeframeToApi,
  type UITimeframe,
} from '@/lib/utils/analysis-mapper';
import type { SignalData } from '@/components/features/analysis/signal-card';
import type { IndicatorData } from '@/components/features/analysis/indicators-section';
import type { ReasoningData } from '@/components/features/analysis/reasoning-section';

// ============ Types ============

interface AnalysisState {
  coin: string;
  timeframe: UITimeframe;
  signal: SignalData | null;
  indicators: IndicatorData[];
  reasoning: ReasoningData | null;
}

type AnalysisAction =
  | { type: 'SET_COIN'; coin: string }
  | { type: 'SET_TIMEFRAME'; timeframe: UITimeframe }
  | { type: 'START_ANALYSIS' }
  | { type: 'SET_RESULTS'; signal: SignalData | null; indicators: IndicatorData[]; reasoning: ReasoningData | null };

// ============ Reducer ============

const initialState: AnalysisState = {
  coin: '',
  timeframe: '1D',
  signal: null,
  indicators: [],
  reasoning: null,
};

function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case 'SET_COIN':
      return { ...state, coin: action.coin };
    case 'SET_TIMEFRAME':
      return { ...state, timeframe: action.timeframe };
    case 'START_ANALYSIS':
      return { ...state, signal: null, indicators: [], reasoning: null };
    case 'SET_RESULTS':
      return {
        ...state,
        signal: action.signal,
        indicators: action.indicators,
        reasoning: action.reasoning,
      };
    default:
      return state;
  }
}

// ============ Hook ============

export function useAnalysisPage() {
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const mutation = useCoordinateAnalysis();

  const [state, dispatch] = useReducer(analysisReducer, initialState);

  // Sync URL params on mount only
  useEffect(() => {
    const coinParam = searchParams.get('coin');
    const tfParam = searchParams.get('tf') as UITimeframe | null;

    if (coinParam) {
      dispatch({ type: 'SET_COIN', coin: coinParam.toUpperCase() });
    }
    if (tfParam && ['1H', '4H', '1D', '1W'].includes(tfParam)) {
      dispatch({ type: 'SET_TIMEFRAME', timeframe: tfParam });
    }
  }, [searchParams]);

  // Stable handlers
  const setCoin = useCallback((coin: string) => {
    dispatch({ type: 'SET_COIN', coin });
  }, []);

  const setTimeframe = useCallback((timeframe: UITimeframe) => {
    dispatch({ type: 'SET_TIMEFRAME', timeframe });
  }, []);

  const handleAnalyze = useCallback(async () => {
    const normalizedCoin = state.coin.toUpperCase();
    const apiTimeframe = mapUITimeframeToApi(state.timeframe);

    if (!normalizedCoin.trim()) return;

    dispatch({ type: 'START_ANALYSIS' });

    try {
      const response = await mutation.mutateAsync({
        coin: normalizedCoin,
        timeframe: apiTimeframe,
      });

      if (!response.success) {
        throw new Error(response.error || 'Analysis failed');
      }

      const signalData = mapToSignalData(response, normalizedCoin, apiTimeframe);
      const indicatorsData = mapToIndicatorsData(response);
      const reasoningData = mapToReasoningData(response);

      dispatch({
        type: 'SET_RESULTS',
        signal: signalData,
        indicators: indicatorsData,
        reasoning: reasoningData,
      });

      if (signalData?.direction === 'wait') {
        addToast(`No trade signal for ${normalizedCoin} at this time`, 'info');
      } else {
        addToast(`Analysis complete for ${normalizedCoin}`, 'success');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      addToast(message, 'error');
    }
  }, [state.coin, state.timeframe, mutation, addToast]);

  // Derived state
  const hasResults = useMemo(
    () => Boolean(state.signal && state.reasoning),
    [state.signal, state.reasoning]
  );

  return {
    // Controlled form state
    coin: state.coin,
    timeframe: state.timeframe,
    setCoin,
    setTimeframe,

    // Results
    signal: state.signal,
    indicators: state.indicators,
    reasoning: state.reasoning,

    // Derived
    isLoading: mutation.isPending,
    hasResults,

    // Actions
    handleAnalyze,
  };
}
