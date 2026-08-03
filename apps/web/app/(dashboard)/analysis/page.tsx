'use client';

import { Suspense } from 'react';
import { AnalysisPageHeader } from '@/components/features/analysis/analysis-page-header';
import { AnalysisInput } from '@/components/features/analysis/analysis-input';
import { AnalysisLoading } from '@/components/features/analysis/analysis-loading';
import { SignalCard } from '@/components/features/analysis/signal-card';
import { IndicatorsSection } from '@/components/features/analysis/indicators-section';
import { ReasoningSection } from '@/components/features/analysis/reasoning-section';
import { Disclaimer } from '@/components/ui/disclaimer';
import { useAnalysisPage } from '@/lib/hooks/use-analysis-page';

function AnalysisContent() {
  const {
    coin,
    timeframe,
    setCoin,
    setTimeframe,
    signal,
    indicators,
    reasoning,
    isLoading,
    hasResults,
    handleAnalyze,
  } = useAnalysisPage();

  return (
    <>
      <AnalysisPageHeader coin={coin || undefined} />

      <div className="mt-10">
        <AnalysisInput
          coin={coin}
          timeframe={timeframe}
          onCoinChange={setCoin}
          onTimeframeChange={setTimeframe}
          onSubmit={handleAnalyze}
          isLoading={isLoading}
        />
      </div>

      {isLoading && <AnalysisLoading coin={coin || undefined} />}

      {hasResults && !isLoading && signal && reasoning && (
        <>
          <SignalCard signal={signal} />
          {indicators.length > 0 && <IndicatorsSection indicators={indicators} />}
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

export default function AnalysisPage() {
  return (
    <Suspense fallback={<AnalysisLoading />}>
      <AnalysisContent />
    </Suspense>
  );
}
