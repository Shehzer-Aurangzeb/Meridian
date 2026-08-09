'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ArrowRightIcon } from '@/assets/icons/arrow-right-icon';
import { Card } from '@/components/ui/card';
import { SectionHead } from '@/components/ui/section-head';
import { TimeframeSelector, type Timeframe } from '@/components/ui/timeframe-selector';
import { NotWired } from '@/components/ui/not-wired';
import { isFeatureEnabled } from '@/lib/feature-flags';

export function QuickAnalyze() {
  if (!isFeatureEnabled('ANALYSIS')) {
    return (
      <section className="mt-10">
        <SectionHead eyebrow="Quick analyze" title="Start a new analysis" />
        <NotWired
          title="Not wired"
          detail="The analysis screen still calls a deleted route. Rewire it to POST /api/analyses."
        />
      </section>
    );
  }
  return <QuickAnalyzeForm />;
}

function QuickAnalyzeForm() {
  const router = useRouter();
  const [coin, setCoin] = useState('');
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (coin.trim()) {
      router.push(`/analysis?coin=${coin.toUpperCase()}&tf=${timeframe}`);
    } else {
      router.push('/analysis');
    }
  };

  return (
    <section className="mt-10">
      <SectionHead
        eyebrow="Quick analyze"
        title="Start a new analysis"
        linkText="Open full editor →"
        linkHref="/analysis"
      />

      <Card className="p-6">
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-4 items-end"
        >
          {/* Coin input */}
          <div className="flex flex-col gap-2.5">
            <label
              htmlFor="quick-coin"
              className="text-xs tracking-[0.16em] uppercase text-text-tertiary font-medium"
            >
              Asset
            </label>
            <input
              id="quick-coin"
              type="text"
              value={coin}
              onChange={(e) => setCoin(e.target.value)}
              placeholder="BTC, ETH, SOL…"
              autoComplete="off"
              className={cn(
                'w-full bg-transparent border-0 border-b border-border-hover/18 dark:border-border-hover',
                'py-2 pb-2.5 outline-none',
                'font-antonio text-[26px] font-semibold tracking-[0.06em] uppercase',
                'text-text-primary placeholder:text-text-tertiary/50',
                'transition-colors focus:border-primary'
              )}
            />
          </div>

          {/* Timeframe selector */}
          <div className="flex flex-col gap-2.5 self-stretch">
            <label className="text-xs tracking-[0.16em] uppercase text-text-tertiary font-medium">
              Timeframe
            </label>
            <TimeframeSelector value={timeframe} onChange={setTimeframe} />
          </div>

          {/* Submit button */}
          <div className="self-end">
            <button
              type="submit"
              className={cn(
                'border-0 bg-primary text-background',
                'font-inter text-[13px] font-semibold tracking-wide uppercase',
                'px-6 py-3.5 rounded-full cursor-pointer',
                'inline-flex items-center gap-2.5',
                'transition-all duration-200',
                'hover:opacity-90 active:translate-y-px'
              )}
            >
              Analyze
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </Card>
    </section>
  );
}
