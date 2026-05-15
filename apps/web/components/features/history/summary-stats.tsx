'use client';

/**
 * Summary statistics data type
 */
export interface SummaryStatsData {
  totalAnalyses: number;
  sinceDateLabel: string;
  hitRatePercent: number;
  wins: number;
  losses: number;
  averageR: number;
  currentlyOpenCount: number;
  openCoins: string[];
}

/**
 * Individual summary cell
 */
interface SumCellProps {
  eyebrow: string;
  value: string | number;
  unit?: string;
  subtext: string;
  isLast?: boolean;
}

function SumCell({ eyebrow, value, unit, subtext, isLast }: SumCellProps) {
  return (
    <div
      className={`px-5 py-5 md:px-6 md:py-[22px] border-b md:border-b-0 md:border-r border-border/10 dark:border-border last:border-0 ${
        isLast ? 'border-b-0' : ''
      }`}
    >
      <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-text-tertiary">
        {eyebrow}
      </div>
      <div className="font-display text-[28px] md:text-[32px] font-semibold tracking-[0.02em] leading-none text-text-primary mt-2.5">
        {value}
        {unit && (
          <span className="text-[16px] md:text-[18px] text-text-secondary ml-0.5">{unit}</span>
        )}
      </div>
      <div className="font-mono text-[11px] tracking-[0.04em] text-text-tertiary mt-1.5">
        {subtext}
      </div>
    </div>
  );
}

/**
 * Mock data for development
 */
export const MOCK_SUMMARY_STATS: SummaryStatsData = {
  totalAnalyses: 128,
  sinceDateLabel: 'Since 12 Feb 2026',
  hitRatePercent: 68,
  wins: 87,
  losses: 41,
  averageR: 1.84,
  currentlyOpenCount: 3,
  openCoins: ['BTC', 'ETH', 'MATIC'],
};

/**
 * Summary statistics strip showing key performance metrics
 * 4-column grid: Total analyses, Hit rate, Average R, Currently open
 */
interface SummaryStatsProps {
  data?: SummaryStatsData;
}

export function SummaryStats({ data = MOCK_SUMMARY_STATS }: SummaryStatsProps) {
  return (
    <section className="mb-8">
      <div className="bg-surface border border-border/10 dark:border-border rounded-lg overflow-hidden grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        <SumCell
          eyebrow="Total analyses"
          value={data.totalAnalyses}
          subtext={data.sinceDateLabel}
        />
        <SumCell
          eyebrow="Hit rate"
          value={data.hitRatePercent}
          unit="%"
          subtext={`${data.wins} win · ${data.losses} loss`}
        />
        <SumCell
          eyebrow="Average R"
          value={data.averageR.toFixed(2)}
          unit="×"
          subtext="Per closed trade"
        />
        <SumCell
          eyebrow="Currently open"
          value={data.currentlyOpenCount}
          subtext={data.openCoins.join(', ')}
          isLast
        />
      </div>
    </section>
  );
}
