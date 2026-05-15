'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ArrowRightIcon } from '@/components/ui/icons';
import { Card } from '@/components/ui/card';
import { SectionHead } from '@/components/ui/section-head';

/**
 * Timeframe options
 */
const TIMEFRAMES = ['1H', '4H', '1D', '1W'] as const;
export type Timeframe = typeof TIMEFRAMES[number];

/**
 * Segmented control for timeframe selection
 */
function TimeframeSelector({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}) {
  return (
    <div className="inline-flex border border-border-hover/18 dark:border-border-hover rounded-full p-[3px] bg-background gap-0">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          className={cn(
            'border-0 bg-transparent px-3.5 py-[7px]',
            'font-mono text-xs cursor-pointer rounded-full',
            'transition-all duration-[160ms] whitespace-nowrap',
            value === tf
              ? 'bg-primary text-primary-foreground'
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}

/**
 * AnalysisInput props
 */
interface AnalysisInputProps {
  onSubmit: (coin: string, timeframe: Timeframe) => void;
  isLoading?: boolean;
  defaultCoin?: string;
}

/**
 * Analysis input form section
 */
export function AnalysisInput({
  onSubmit,
  isLoading = false,
  defaultCoin = '',
}: AnalysisInputProps) {
  const [coin, setCoin] = useState(defaultCoin);
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (coin.trim() && !isLoading) {
      onSubmit(coin.toUpperCase(), timeframe);
    }
  };

  return (
    <section>
      <SectionHead
        eyebrow="Begin"
        title="Pose a question to the market"
        linkText="Models · v4.2 · refreshed 09:42"
        linkHref="#"
      />

      <Card className="p-6 md:p-8">
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-4 items-end"
        >
          {/* Coin input */}
          <div className="flex flex-col gap-2.5">
            <label
              htmlFor="analysis-coin"
              className="text-xs tracking-[0.16em] uppercase text-text-tertiary font-medium"
            >
              Asset
            </label>
            <input
              id="analysis-coin"
              type="text"
              value={coin}
              onChange={(e) => setCoin(e.target.value)}
              placeholder="BTC, ETH, SOL…"
              autoComplete="off"
              disabled={isLoading}
              className={cn(
                'w-full bg-transparent border-0 border-b border-line-strong',
                'py-2.5 pb-3 outline-none',
                'font-antonio text-[30px] font-semibold tracking-[0.06em] uppercase',
                'text-text-primary placeholder:text-text-tertiary/50',
                'transition-colors focus:border-primary',
                isLoading && 'opacity-50 cursor-not-allowed'
              )}
            />
          </div>

          {/* Timeframe selector */}
          <div className="flex flex-col gap-2.5 self-stretch">
            <label className="text-xs tracking-[0.16em] uppercase text-muted-2 font-medium">
              Timeframe
            </label>
            <TimeframeSelector value={timeframe} onChange={setTimeframe} />
          </div>

          {/* Submit button */}
          <div className="self-end">
            <button
              type="submit"
              disabled={!coin.trim() || isLoading}
              className={cn(
                'border-0 bg-primary text-background',
                'font-inter text-[13px] font-semibold tracking-wide uppercase',
                'px-6 py-3.5 rounded-full cursor-pointer',
                'inline-flex items-center gap-2.5',
                'transition-all duration-200',
                'hover:opacity-90 active:translate-y-px',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:opacity-50'
              )}
            >
              {isLoading ? 'Analyzing...' : 'Analyze'}
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </Card>
    </section>
  );
}
