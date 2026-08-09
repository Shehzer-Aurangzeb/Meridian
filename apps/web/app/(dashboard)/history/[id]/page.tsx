'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { formatCurrency, formatFullDate, formatRelative } from '@/lib/format';
import { useAnalysis } from '@/lib/hooks/use-analyses';
import { FreshnessBadge } from '@/components/features/analysis-detail/badges';
import { VerdictCard } from '@/components/features/analysis-detail/verdict-card';
import { AnalysisChart } from '@/components/features/analysis-detail/analysis-chart';
import { PlanCard } from '@/components/features/analysis-detail/plan-card';
import { RegimeCard } from '@/components/features/analysis-detail/regime-card';
import { LevelMapCard } from '@/components/features/analysis-detail/level-map';
import { Disclaimer } from '@/components/ui/disclaimer';
import { Skeleton } from '@/components/ui/skeleton';

function BackLink() {
  return (
    <Link
      href="/history"
      className="text-[13px] text-text-secondary hover:text-text-primary transition-colors"
    >
      ← All analyses
    </Link>
  );
}

export default function AnalysisDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useAnalysis(id);

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <Skeleton className="h-6 w-32 mb-6" />
        <Skeleton className="h-24 mb-8" />
        <Skeleton className="h-64 mb-4" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <BackLink />
        <div className="bg-surface border border-rust/30 rounded-xl p-8 mt-6 text-center">
          <p className="text-rust font-medium">Could not load this analysis</p>
          <p className="text-text-tertiary text-sm mt-1.5">
            {error?.message ?? 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  const { analysis, outcomes, freshness, currentPrice, createdAt, verdict, narration } = data;
  const drift = ((currentPrice - analysis.map.spot) / analysis.map.spot) * 100;

  return (
    <div>
      <BackLink />

      <header className="mt-4 mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-[44px] md:text-[52px] font-semibold tracking-[0.04em] uppercase leading-none text-text-primary">
              {analysis.symbol}
            </h1>
            <FreshnessBadge freshness={freshness} />
          </div>
          <p className="text-[13px] text-text-secondary mt-2.5">
            {formatFullDate(createdAt)} · {formatRelative(createdAt)} · took{' '}
            {(analysis.durationMs / 1000).toFixed(1)}s
          </p>
        </div>

        <div className="text-right">
          <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-text-tertiary">
            Price now
          </div>
          <div className="font-display text-[32px] font-semibold leading-none text-text-primary mt-1.5">
            {formatCurrency(currentPrice)}
          </div>
          <div className="font-mono text-[11px] text-text-tertiary mt-1.5">
            {drift >= 0 ? '+' : ''}
            {drift.toFixed(2)}% since the analysis
          </div>
        </div>
      </header>

      <VerdictCard
        id={data.id}
        verdict={verdict}
        narration={narration}
        freshness={freshness}
      />

      <section className="mt-8">
        <AnalysisChart analysis={analysis} analysedAt={createdAt} />
      </section>

      <section className="mt-8">
        <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-text-tertiary mb-3">
          The evidence
        </div>
        <RegimeCard analysis={analysis} />
      </section>

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
            {analysis.plans.map((plan, idx) => (
              <PlanCard key={plan.direction} plan={plan} outcome={outcomes[idx]} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <LevelMapCard map={analysis.map} currentPrice={currentPrice} />
      </section>

      <Disclaimer text="Every price here is computed from the level map — none is a prediction. Outcomes are replayed from 1h candles since the analysis; a plan that never filled within 24 hours counts as missed." />
    </div>
  );
}
