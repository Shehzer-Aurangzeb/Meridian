'use client';

import { cn } from '@/lib/utils';

export const TIMEFRAMES = ['1H', '4H', '1D', '1W'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

interface TimeframeSelectorProps {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  disabled?: boolean;
}

export function TimeframeSelector({ value, onChange, disabled }: TimeframeSelectorProps) {
  return (
    <div className="inline-flex border border-border-hover/18 dark:border-border-hover rounded-full p-[3px] bg-background gap-0">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          disabled={disabled}
          className={cn(
            'border-0 bg-transparent px-3.5 py-[7px]',
            'font-mono text-xs cursor-pointer rounded-full',
            'transition-all duration-[160ms] whitespace-nowrap',
            value === tf
              ? 'bg-primary text-primary-foreground'
              : 'text-text-secondary hover:text-text-primary',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
