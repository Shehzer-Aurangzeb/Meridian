'use client';

import { useState, useCallback } from 'react';
import { AnalysisPageHeader } from '@/components/features/analysis/analysis-page-header';
import { AnalysisInput } from '@/components/features/analysis/analysis-input';
import type { Timeframe } from '@/components/features/analysis/analysis-input';
import { AnalysisLoading } from '@/components/features/analysis/analysis-loading';
import { SignalCard, MOCK_SIGNAL } from '@/components/features/analysis/signal-card';
import type { SignalData } from '@/components/features/analysis/signal-card';
import { IndicatorsSection, MOCK_INDICATORS } from '@/components/features/analysis/indicators-section';
import type { IndicatorData } from '@/components/features/analysis/indicators-section';
import { ReasoningSection, MOCK_REASONING } from '@/components/features/analysis/reasoning-section';
import type { ReasoningData } from '@/components/features/analysis/reasoning-section';
import { Disclaimer } from '@/components/ui/disclaimer';
import { useToast } from '@/components/ui/toast';

export default function AnalysisPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [coin, setCoin] = useState<string | null>(null);
  const [signal, setSignal] = useState<SignalData | null>(null);
  const [indicators, setIndicators] = useState<IndicatorData[] | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningData | null>(null);
  const { addToast } = useToast();

  const handleAnalyze = useCallback(async (inputCoin: string, timeframe: Timeframe) => {
    setIsLoading(true);
    setCoin(inputCoin);

    try {
      // TODO: Replace with actual API call
      await new Promise((resolve) => setTimeout(resolve, 1500));

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
  }, [addToast]);

  const hasResults = signal && indicators && reasoning;

  return (
    <>
      <AnalysisPageHeader coin={coin || undefined} />

      <div className="mt-10">
        <AnalysisInput onSubmit={handleAnalyze} isLoading={isLoading} />
      </div>

      {isLoading && <AnalysisLoading coin={coin || undefined} />}

      {hasResults && !isLoading && (
        <>
          <SignalCard signal={signal} />
          <IndicatorsSection indicators={indicators} />
          <ReasoningSection reasoning={reasoning} />
        </>
      )}

      <Disclaimer
        text="For research purposes. Not investment advice. Always size positions to your own risk tolerance and conviction."
        variant="hero"
      />
    </>
  );
}
