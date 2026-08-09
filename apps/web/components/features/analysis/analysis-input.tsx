'use client';

import { cn } from '@/lib/utils';
import { ArrowRightIcon } from '@/assets/icons/arrow-right-icon';
import { Card } from '@/components/ui/card';
import { SectionHead } from '@/components/ui/section-head';
import { TimeframeSelector, type Timeframe } from '@/components/ui/timeframe-selector';

// Re-export for backward compatibility
export type { Timeframe } from '@/components/ui/timeframe-selector';

interface AnalysisInputProps {
  /** Current coin value (controlled) */
  coin: string;
  /** Current timeframe value (controlled) */
  timeframe: Timeframe;
  /** Called when coin input changes */
  onCoinChange: (coin: string) => void;
  /** Called when timeframe changes */
  onTimeframeChange: (tf: Timeframe) => void;
  /** Called when form is submitted */
  onSubmit: () => void;
  /** Loading state */
  isLoading?: boolean;
}

/**
 * Analysis input form - fully controlled component
 */
export function AnalysisInput({
  coin,
  timeframe,
  onCoinChange,
  onTimeframeChange,
  onSubmit,
  isLoading = false,
}: AnalysisInputProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (coin.trim() && !isLoading) {
      onSubmit();
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
              onChange={(e) => onCoinChange(e.target.value)}
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
            <TimeframeSelector
              value={timeframe}
              onChange={onTimeframeChange}
              disabled={isLoading}
            />
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
