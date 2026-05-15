'use client';

import { useState } from 'react';
import {
  AnalysisPageHeader,
  AnalysisInput,
  SignalCard,
  IndicatorsSection,
  ReasoningSection,
  MOCK_SIGNAL,
  MOCK_INDICATORS,
  MOCK_REASONING,
  type Timeframe,
  type SignalData,
  type IndicatorData,
  type ReasoningData,
} from '@/components/analysis';
import { Disclaimer } from '@/components/dashboard';
import { useToast } from '@/components/ui/Toast';
import { API_URL } from '@/lib/constants';

export default function AnalysisPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [coin, setCoin] = useState<string | null>(null);
  const [signal, setSignal] = useState<SignalData | null>(null);
  const [indicators, setIndicators] = useState<IndicatorData[] | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningData | null>(null);
  const { addToast } = useToast();

  const handleAnalyze = async (inputCoin: string, timeframe: Timeframe) => {
    setIsLoading(true);
    setCoin(inputCoin);

    try {
      // TODO: Replace with actual API call
      // For now, use mock data with a simulated delay
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Update mock data with the selected coin
      const updatedSignal = {
        ...MOCK_SIGNAL,
        coin: inputCoin,
        timeframe: timeframe === '1D' ? 'Daily' : timeframe === '1W' ? 'Weekly' : `${timeframe}`,
      };

      setSignal(updatedSignal);
      setIndicators(MOCK_INDICATORS);
      setReasoning(MOCK_REASONING);
      addToast(`Analysis complete for ${inputCoin}`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      addToast(message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const hasResults = signal && indicators && reasoning;

  return (
    <>
      <AnalysisPageHeader coin={coin || undefined} />

      <div className="mt-10">
        <AnalysisInput onSubmit={handleAnalyze} isLoading={isLoading} />
      </div>

      {isLoading && (
        <div className="mt-14 text-center py-20">
          <div className="inline-flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            <span className="text-text-secondary font-medium">Analyzing {coin}...</span>
          </div>
        </div>
      )}

      {hasResults && !isLoading && (
        <>
          <SignalCard signal={signal} />
          <IndicatorsSection indicators={indicators} />
          <ReasoningSection reasoning={reasoning} />
        </>
      )}

      <Disclaimer />
    </>
  );
}
