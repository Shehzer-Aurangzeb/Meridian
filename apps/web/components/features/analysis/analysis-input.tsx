'use client';

import { cn } from '@/lib/utils';
import { ArrowRightIcon } from '@/assets/icons/arrow-right-icon';
import { Card } from '@/components/ui/card';
import { SectionHead } from '@/components/ui/section-head';

/**
 * Symbol only. There is no timeframe to pick: the pipeline reads 12h/4h/1h for
 * levels, 12h for the Fib anchor and the regime, 4h for ATR — every one a
 * declared decision, not a preference. The selector used to imply otherwise.
 */
interface AnalysisInputProps {
  coin: string;
  onCoinChange: (coin: string) => void;
  onSubmit: () => void;
  isLoading?: boolean;
}

export function AnalysisInput({
  coin,
  onCoinChange,
  onSubmit,
  isLoading = false,
}: AnalysisInputProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (coin.trim() && !isLoading) onSubmit();
  };

  return (
    <section>
      <SectionHead eyebrow="Begin" title="Analyse a coin" />

      <Card className="p-6 md:p-8">
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end"
        >
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
              onChange={(e) => onCoinChange(e.target.value)}
              placeholder="BTC, ETH, SOL…"
              autoComplete="off"
              disabled={isLoading}
              className={cn(
                'w-full bg-transparent border-0 border-b border-border-hover/18 dark:border-border-hover',
                'py-2.5 pb-3 outline-none',
                'font-antonio text-[30px] font-semibold tracking-[0.06em] uppercase',
                'text-text-primary placeholder:text-text-tertiary/50',
                'transition-colors focus:border-primary',
                isLoading && 'opacity-50 cursor-not-allowed'
              )}
            />
          </div>

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
              {isLoading ? 'Analysing…' : 'Analyse'}
              <ArrowRightIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>

        <p className="text-[12px] text-text-tertiary mt-5">
          Fetches 12h, 4h and 1h from Binance, finds where they agree, and saves
          the result. Takes a few seconds.
        </p>
      </Card>
    </section>
  );
}
