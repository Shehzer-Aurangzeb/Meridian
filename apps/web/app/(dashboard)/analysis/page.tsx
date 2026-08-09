'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AnalysisPageHeader } from '@/components/features/analysis/analysis-page-header';
import { AnalysisInput } from '@/components/features/analysis/analysis-input';
import { AnalysisLoading } from '@/components/features/analysis/analysis-loading';
import { RegimeCard } from '@/components/features/analysis-detail/regime-card';
import { PlanCard } from '@/components/features/analysis-detail/plan-card';
import { LevelMapCard } from '@/components/features/analysis-detail/level-map';
import { Disclaimer } from '@/components/ui/disclaimer';
import { useRunAnalysis } from '@/lib/hooks/use-analyses';

const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}$/;

function AnalysisContent() {
  const searchParams = useSearchParams();
  const [coin, setCoin] = useState(searchParams.get('coin')?.toUpperCase() ?? '');
  const run = useRunAnalysis();

  const analysis = run.data?.analysis;
  const symbol = coin.trim().toUpperCase();

  const handleAnalyze = () => {
    if (SYMBOL_PATTERN.test(symbol)) run.mutate(symbol);
  };

  return (
    <>
      <AnalysisPageHeader coin={analysis?.symbol ?? (symbol || undefined)} />

      <div className="mt-10">
        <AnalysisInput
          coin={coin}
          onCoinChange={setCoin}
          onSubmit={handleAnalyze}
          isLoading={run.isPending}
        />
      </div>

      {run.isPending && <AnalysisLoading coin={symbol} />}

      {run.error && (
        <div className="mt-8 bg-surface border border-rust/30 rounded-xl p-6 text-center">
          <p className="text-rust font-medium">Could not analyse {symbol}</p>
          <p className="text-text-tertiary text-sm mt-1.5">{run.error.message}</p>
        </div>
      )}

      {analysis && !run.isPending && (
        <>
          <div className="mt-10 flex items-baseline justify-between gap-4">
            <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-text-tertiary">
              Saved · {analysis.symbol}
            </div>
            {run.data && (
              <Link
                href={`/history/${run.data.id}`}
                className="text-[13px] text-text-secondary hover:text-text-primary transition-colors"
              >
                Open with outcomes →
              </Link>
            )}
          </div>

          <div className="mt-4">
            <RegimeCard analysis={analysis} />
          </div>

          <section className="mt-8">
            <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-text-tertiary mb-3">
              Plans
            </div>
            {analysis.plans.length === 0 ? (
              <div className="bg-surface border border-border/10 dark:border-border rounded-xl p-8 text-center text-text-secondary text-sm">
                No zone was close enough to build a plan from.
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {analysis.plans.map((plan) => (
                  <PlanCard key={plan.direction} plan={plan} />
                ))}
              </div>
            )}
          </section>

          <section className="mt-8">
            {/* Freshly run, so spot is the live price. */}
            <LevelMapCard map={analysis.map} currentPrice={analysis.map.spot} />
          </section>
        </>
      )}

      <Disclaimer
        text="For research purposes. Not investment advice. Every price here is computed from the level map — none is a prediction."
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
