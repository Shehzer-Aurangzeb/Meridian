'use client';

import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/ui/typography';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { Skeleton } from '@/components/ui/skeleton';

interface StatsCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  variant?: 'default' | 'success' | 'error';
  animate?: boolean;
}

export function StatsCard({ label, value, subtext, variant = 'default', animate = true }: StatsCardProps) {
  const valueColorClass = {
    default: 'text-text-primary',
    success: 'text-sage',
    error: 'text-text-primary/70',
  };

  // Parse numeric value for animation
  const isNumeric = typeof value === 'number' || /^[\d.]+%?$/.test(String(value));
  const numericValue = typeof value === 'number' ? value : parseFloat(String(value));
  const hasPercent = String(value).includes('%');
  const decimals = hasPercent ? 1 : 0;

  return (
    <div
      className={cn(
        'bg-surface border border-primary/[0.08] rounded-xl p-6 md:p-8',
        'transition-all duration-300 ease-out',
        'hover:shadow-md hover:shadow-primary/5 hover:border-primary/15'
      )}
    >
      <Eyebrow className="mb-3">{label}</Eyebrow>
      <span
        className={cn(
          'block font-inter font-bold text-4xl md:text-5xl lg:text-6xl tabular-nums',
          valueColorClass[variant]
        )}
      >
        {animate && isNumeric && !isNaN(numericValue) ? (
          <AnimatedNumber
            value={numericValue}
            decimals={decimals}
            suffix={hasPercent ? '%' : ''}
            duration={800}
          />
        ) : (
          value
        )}
      </span>
      {subtext && (
        <span className="block mt-2 font-inter text-sm text-text-secondary">
          {subtext}
        </span>
      )}
    </div>
  );
}

export function StatsCardSkeleton() {
  return (
    <div className="bg-surface border border-primary/[0.08] rounded-xl p-6 md:p-8">
      <Skeleton className="h-3 w-20 mb-4" />
      <Skeleton className="h-12 w-24 mb-2" />
      <Skeleton className="h-4 w-32" />
    </div>
  );
}
