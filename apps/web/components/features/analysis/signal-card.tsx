import { cn } from '@/lib/utils';
import { SectionHead } from '@/components/ui/section-head';

/**
 * Signal direction type
 */
export type SignalDirection = 'long' | 'short' | 'wait';

/**
 * Price level type
 */
export interface PriceLevel {
  label: string;
  value: string;
  cents?: string;
  subtext: string;
  variant?: 'entry' | 'stop' | 'default';
  trend?: 'up' | 'down' | 'neutral';
}

/**
 * Signal data type
 */
export interface SignalData {
  direction: SignalDirection;
  strategy: string;
  riskReward: string;
  horizon: string;
  confidence: number;
  prices: PriceLevel[];
  coin: string;
  timeframe: string;
  dateRange: string;
}

/**
 * Action badge component
 */
function ActionBadge({ direction }: { direction: SignalDirection }) {
  const labels: Record<SignalDirection, string> = {
    long: 'Long',
    short: 'Short',
    wait: 'Wait',
  };

  return (
    <div
      className={cn(
        'px-5 py-3 rounded-md',
        'font-antonio text-[22px] font-bold tracking-[0.14em] uppercase',
        direction === 'long' && 'bg-sage text-deep-green dark:bg-green/30 dark:text-green',
        direction === 'short' && 'bg-rust/20 text-rust',
        direction === 'wait' && 'bg-primary/[0.08] text-text-secondary'
      )}
    >
      {labels[direction]}
    </div>
  );
}

/**
 * Meta item component
 */
function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] tracking-[0.16em] uppercase text-text-tertiary font-medium whitespace-nowrap">
        {label}
      </div>
      <div className="font-mono text-[15px] text-text-primary mt-1 whitespace-nowrap">
        {value}
      </div>
    </div>
  );
}

/**
 * Confidence display component
 */
function ConfidenceDisplay({ value }: { value: number }) {
  return (
    <div>
      <div className="text-[11px] tracking-[0.16em] uppercase text-text-tertiary font-medium">
        Confidence
      </div>
      <div className="font-antonio text-[34px] font-semibold tracking-[0.04em] text-text-primary leading-none mt-1">
        {value}
        <sup className="text-sm text-text-secondary ml-0.5">%</sup>
      </div>
    </div>
  );
}

/**
 * Price card component
 */
function PriceCard({ price, isLast }: { price: PriceLevel; isLast: boolean }) {
  return (
    <div
      className={cn(
        'p-6 relative',
        !isLast && 'border-b md:border-b-0 md:border-r border-border/10 dark:border-border'
      )}
    >
      <div
        className={cn(
          'text-[11px] tracking-[0.18em] uppercase font-semibold',
          price.variant === 'entry' && 'text-gold-ink',
          price.variant === 'stop' && 'text-rust',
          (!price.variant || price.variant === 'default') && 'text-gold-ink'
        )}
      >
        {price.label}
      </div>
      <div className="font-antonio text-[36px] font-semibold tracking-[0.02em] mt-3.5 leading-none text-text-primary">
        {price.value}
        {price.cents && (
          <span className="text-[22px] text-text-secondary">{price.cents}</span>
        )}
      </div>
      <div
        className={cn(
          'font-mono text-[11px] tracking-[0.06em] mt-2.5',
          price.trend === 'up' && 'text-sage',
          price.trend === 'down' && 'text-rust',
          (!price.trend || price.trend === 'neutral') && 'text-text-tertiary'
        )}
      >
        {price.subtext}
      </div>
    </div>
  );
}

/**
 * SignalCard props
 */
interface SignalCardProps {
  signal: SignalData;
  className?: string;
}

/**
 * Signal card showing the analysis verdict
 */
export function SignalCard({ signal, className }: SignalCardProps) {
  return (
    <section className={cn('mt-14', className)}>
      <SectionHead
        eyebrow="Verdict"
        title="The position"
        linkText={`${signal.coin}/USD · ${signal.timeframe} · ${signal.dateRange}`}
        linkHref="#"
      />

      <article className="mt-6 p-6 md:p-10 bg-surface border border-border/10 dark:border-border rounded-xl">
        {/* Top section */}
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] items-center gap-5 lg:gap-8">
          <ActionBadge direction={signal.direction} />

          <div className="flex flex-wrap gap-5 lg:gap-9">
            <MetaItem label="Strategy" value={signal.strategy} />
            <MetaItem label="Risk · Reward" value={signal.riskReward} />
            <MetaItem label="Horizon" value={signal.horizon} />
          </div>

          <ConfidenceDisplay value={signal.confidence} />
        </div>

        {/* Gold divider */}
        <div className="h-px bg-gold opacity-90 my-8" />

        {/* Price levels */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 border-t border-b border-border/10 dark:border-border">
          {signal.prices.map((price, idx) => (
            <PriceCard
              key={price.label}
              price={price}
              isLast={idx === signal.prices.length - 1}
            />
          ))}
        </div>
      </article>
    </section>
  );
}

/**
 * Mock signal data for development
 */
export const MOCK_SIGNAL: SignalData = {
  direction: 'long',
  strategy: 'Mean-reversion',
  riskReward: '1 : 3.4',
  horizon: '3 – 7 days',
  confidence: 82,
  coin: 'BTC',
  timeframe: 'Daily',
  dateRange: '12 May → 13 May',
  prices: [
    {
      label: 'Entry',
      value: '$43,250',
      cents: '.00',
      subtext: 'Limit · zone 43,180 – 43,310',
      variant: 'entry',
    },
    {
      label: 'Target · TP1',
      value: '$44,820',
      subtext: '+ 3.63 %',
      trend: 'up',
    },
    {
      label: 'Target · TP2',
      value: '$46,400',
      subtext: '+ 7.28 %',
      trend: 'up',
    },
    {
      label: 'Stop loss',
      value: '$42,360',
      subtext: '– 2.06 %',
      variant: 'stop',
      trend: 'down',
    },
  ],
};
