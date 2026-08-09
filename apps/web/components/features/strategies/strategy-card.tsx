'use client';

import { cn } from '@/lib/utils';

export interface StrategyCondition {
  text: string;
  weight: string;
}

export interface StrategyStats {
  hitRate: number;
  avgR: number;
  trades90d: number;
}

export interface StrategyData {
  id: string;
  number: string;
  name: string;
  category: 'contrarian' | 'directional' | 'volatility';
  description: string;
  conditions: StrategyCondition[];
  stats: StrategyStats;
}

function CategoryTag({ category }: { category: StrategyData['category'] }) {
  return (
    <span
      className={cn(
        'text-[10px] font-semibold tracking-[0.16em] uppercase',
        'px-2.5 py-1 rounded whitespace-nowrap',
        category === 'contrarian' && 'bg-sage/20 text-deep-green dark:bg-green/20 dark:text-green',
        category === 'directional' && 'bg-gold/20 text-gold-ink',
        category === 'volatility' && 'bg-rust/15 text-rust'
      )}
    >
      {category}
    </span>
  );
}

interface StrategyCardProps {
  strategy: StrategyData;
}

export function StrategyCard({ strategy }: StrategyCardProps) {
  return (
    <article className="bg-surface border border-border/10 dark:border-border rounded-lg p-6 md:p-8 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-xs text-gold-ink tracking-[0.16em] mb-2">
            {strategy.number}
          </div>
          <h3 className="font-display text-[24px] md:text-[30px] font-semibold tracking-[0.04em] uppercase leading-[1.02] text-text-primary text-balance">
            {strategy.name}
          </h3>
        </div>
        <CategoryTag category={strategy.category} />
      </div>

      {/* Description */}
      <p className="text-[15px] leading-relaxed text-text-secondary">
        {strategy.description}
      </p>

      {/* Conditions */}
      <div className="mt-2">
        <h4 className="text-[11px] font-semibold tracking-[0.16em] uppercase text-text-tertiary mb-3">
          Activates when
        </h4>
        <ul className="flex flex-col gap-2">
          {strategy.conditions.map((condition, idx) => (
            <li key={idx} className="grid grid-cols-[16px_1fr] gap-3 items-baseline text-sm text-text-primary">
              <span className="w-[5px] h-[5px] bg-gold rounded-full mx-auto -translate-y-0.5" />
              <span>
                {condition.text}{' '}
                <code className="font-mono text-xs text-text-secondary">{condition.weight}</code>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 border-y border-border/10 dark:border-border mt-2">
        <div className="py-4 pr-4 border-r border-border/10 dark:border-border">
          <div className="text-[10px] font-medium tracking-[0.16em] uppercase text-text-tertiary">
            Hit rate
          </div>
          <div className="font-display text-[22px] font-semibold tracking-[0.02em] leading-none mt-1.5">
            {strategy.stats.hitRate}
            <span className="text-[13px] text-text-secondary ml-0.5">%</span>
          </div>
        </div>
        <div className="py-4 px-4 border-r border-border/10 dark:border-border">
          <div className="text-[10px] font-medium tracking-[0.16em] uppercase text-text-tertiary">
            Avg R
          </div>
          <div className="font-display text-[22px] font-semibold tracking-[0.02em] leading-none mt-1.5">
            {strategy.stats.avgR.toFixed(1)}
            <span className="text-[13px] text-text-secondary ml-0.5">×</span>
          </div>
        </div>
        <div className="py-4 pl-4">
          <div className="text-[10px] font-medium tracking-[0.16em] uppercase text-text-tertiary">
            Trades · 90d
          </div>
          <div className="font-display text-[22px] font-semibold tracking-[0.02em] leading-none mt-1.5">
            {strategy.stats.trades90d}
          </div>
        </div>
      </div>
    </article>
  );
}

interface StrategyGridProps {
  strategies: StrategyData[];
}

export function StrategyGrid({ strategies }: StrategyGridProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {strategies.map((strategy) => (
        <StrategyCard key={strategy.id} strategy={strategy} />
      ))}
    </div>
  );
}

/**
 * Mock strategies data
 */
export const MOCK_STRATEGIES: StrategyData[] = [
  {
    id: '1',
    number: 'No. 01',
    name: 'Mean-Reversion at Support',
    category: 'contrarian',
    description: 'When price is statistically stretched into a known structural support, the most probable next move is a measured return toward the mean. Patience is the active ingredient.',
    conditions: [
      { text: 'RSI prints below 30 on the analysis timeframe', weight: '· w 0.25' },
      { text: 'Price touches lower Bollinger band', weight: '· w 0.20' },
      { text: 'Higher-timeframe trend remains intact', weight: '· w 0.20' },
      { text: 'Volume tapering on the descent', weight: '· w 0.15' },
    ],
    stats: { hitRate: 71, avgR: 1.9, trades90d: 14 },
  },
  {
    id: '2',
    number: 'No. 02',
    name: 'Trend Continuation Pullback',
    category: 'directional',
    description: 'In a confirmed trend, a shallow pullback to the 20-period EMA is not a reversal — it is the market resting. Re-entry on that exhale is among the highest-quality setups in the book.',
    conditions: [
      { text: 'Higher highs and higher lows on weekly', weight: '· w 0.30' },
      { text: 'Price pulls back to 20-period EMA', weight: '· w 0.22' },
      { text: 'RSI between 40 – 50 (not oversold)', weight: '· w 0.18' },
      { text: 'Pullback duration < 5 sessions', weight: '· w 0.10' },
    ],
    stats: { hitRate: 74, avgR: 2.4, trades90d: 11 },
  },
  {
    id: '3',
    number: 'No. 03',
    name: 'Range Breakout',
    category: 'directional',
    description: 'Compression precedes expansion. When volatility has contracted for long enough, the direction of the eventual release is often confirmed by the first close beyond the range with conviction.',
    conditions: [
      { text: 'Bollinger bandwidth at 30d low', weight: '· w 0.28' },
      { text: 'Range duration ≥ 12 sessions', weight: '· w 0.20' },
      { text: 'Close beyond range with volume > 1.5× mean', weight: '· w 0.22' },
      { text: 'No major event window in next 24h', weight: '· w 0.10' },
    ],
    stats: { hitRate: 62, avgR: 2.7, trades90d: 8 },
  },
  {
    id: '4',
    number: 'No. 04',
    name: 'Range Fade at Extreme',
    category: 'contrarian',
    description: 'In an established range with no breakout catalysts, the edges are statistical magnets in reverse. Fade them with tight invalidation and modest targets — this is a high-frequency, low-conviction trade.',
    conditions: [
      { text: 'Established range ≥ 15 sessions', weight: '· w 0.25' },
      { text: 'Touch of range high/low', weight: '· w 0.22' },
      { text: 'RSI extreme reading at the touch', weight: '· w 0.18' },
      { text: 'No higher-timeframe trend in either direction', weight: '· w 0.15' },
    ],
    stats: { hitRate: 63, avgR: 1.2, trades90d: 19 },
  },
  {
    id: '5',
    number: 'No. 05',
    name: 'Momentum Continuation',
    category: 'directional',
    description: 'A coin breaking out with rare momentum — RSI > 70 and accelerating — tends to extend further than mean-reversion intuition permits. Trail behind structure rather than predicting the top.',
    conditions: [
      { text: 'RSI > 70 with rising slope', weight: '· w 0.24' },
      { text: 'Daily close above 20d high', weight: '· w 0.22' },
      { text: 'Volume > 2× 20d average', weight: '· w 0.18' },
      { text: 'Broader market in risk-on regime', weight: '· w 0.12' },
    ],
    stats: { hitRate: 58, avgR: 3.1, trades90d: 6 },
  },
  {
    id: '6',
    number: 'No. 06',
    name: 'Volatility Expansion',
    category: 'volatility',
    description: 'ATR collapsing to a quarterly low is a regime signal. The expansion that follows is rarely modest — the trade is the regime change itself, sized small while volatility is honest.',
    conditions: [
      { text: 'ATR at 90d low', weight: '· w 0.30' },
      { text: 'Realized volatility 1 standard deviation below mean', weight: '· w 0.22' },
      { text: 'Compression visible on multiple timeframes', weight: '· w 0.18' },
    ],
    stats: { hitRate: 66, avgR: 2.6, trades90d: 5 },
  },
];
