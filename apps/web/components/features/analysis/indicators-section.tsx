import { cn } from '@/lib/utils';
import { SectionHead } from '@/components/ui/section-head';

/**
 * Indicator flag type
 */
export type IndicatorFlag = 'bullish' | 'neutral' | 'bearish';

/**
 * Base indicator data
 */
interface BaseIndicator {
  name: string;
  period: string;
  flag: IndicatorFlag;
  flagLabel: string;
  value: string;
  note: string;
}

/**
 * RSI specific data
 */
export interface RSIIndicator extends BaseIndicator {
  type: 'rsi';
  rsiValue: number;
}

/**
 * Bollinger specific data
 */
export interface BollingerIndicator extends BaseIndicator {
  type: 'bollinger';
  lower: string;
  mid: string;
  upper: string;
  position: number; // 0-100% position within bands
}

/**
 * ATR specific data
 */
export interface ATRIndicator extends BaseIndicator {
  type: 'atr';
  sparkData: number[];
}

export type IndicatorData = RSIIndicator | BollingerIndicator | ATRIndicator;

/**
 * Indicator flag badge
 */
function FlagBadge({ flag, label }: { flag: IndicatorFlag; label: string }) {
  return (
    <span
      className={cn(
        'text-[10px] tracking-[0.16em] uppercase font-semibold px-2 py-1 rounded',
        flag === 'bullish' && 'text-deep-green bg-sage/20 dark:text-green dark:bg-green/20',
        flag === 'neutral' && 'text-text-secondary bg-primary/[0.08]',
        flag === 'bearish' && 'text-rust bg-rust/15'
      )}
    >
      {label}
    </span>
  );
}

/**
 * RSI visualization component
 */
function RSIVisualization({ value }: { value: number }) {
  const position = Math.max(0, Math.min(100, value));

  return (
    <div className="mt-5">
      {/* Track */}
      <div className="relative h-1.5 bg-primary/[0.08] rounded-sm">
        {/* Zone markers */}
        <div className="absolute top-0 bottom-0 left-[30%] w-px bg-border-hover/18 dark:bg-border-hover" />
        <div className="absolute top-0 bottom-0 left-[70%] w-px bg-border-hover/18 dark:bg-border-hover" />
        {/* Dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-[3px] border-surface shadow-[0_0_0_1px_rgb(var(--primary))]"
          style={{ left: `calc(${position}% - 6px)` }}
        />
      </div>
      {/* Scale */}
      <div className="flex justify-between mt-2 font-mono text-[10px] text-text-tertiary">
        <span>0</span>
        <span>30</span>
        <span>70</span>
        <span>100</span>
      </div>
      {/* Zone labels */}
      <div className="flex justify-between text-[10px] tracking-[0.14em] uppercase text-text-tertiary mt-1">
        <span className="text-rust">Oversold</span>
        <span>Neutral</span>
        <span className="text-sage">Overbought</span>
      </div>
    </div>
  );
}

/**
 * Bollinger Bands visualization
 */
function BollingerVisualization({
  lower,
  mid,
  upper,
  position,
}: {
  lower: string;
  mid: string;
  upper: string;
  position: number;
}) {
  return (
    <div className="mt-5">
      {/* Band visualization */}
      <div className="relative h-14 border-t border-b border-dashed border-border-hover/18 dark:border-border-hover">
        {/* Middle line */}
        <div className="absolute left-0 right-0 top-1/2 border-t border-dotted border-border-hover/18 dark:border-border-hover" />
        {/* Price marker */}
        <div
          className="absolute bottom-[-4px] w-0.5 h-full bg-primary"
          style={{ left: `${position}%` }}
        >
          <div className="absolute bottom-[-4px] left-[-5px] w-3 h-3 bg-gold border-2 border-primary rounded-full" />
        </div>
      </div>
      {/* Labels */}
      <div className="flex justify-between font-mono text-[10px] text-text-tertiary mt-2">
        <span>Lower · {lower}</span>
        <span>Mid · {mid}</span>
        <span>Upper · {upper}</span>
      </div>
    </div>
  );
}

/**
 * ATR Sparkline visualization
 */
function ATRSparkline({ data }: { data: number[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const height = 60;
  const width = 200;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' L');

  const areaPath = `M0,${height - ((data[0] - min) / range) * height} L${points} L${width},${height} L0,${height} Z`;
  const linePath = `M${points}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-4 w-full h-[60px]"
      preserveAspectRatio="none"
    >
      <path d={areaPath} fill="rgb(var(--gold) / 0.18)" />
      <path d={linePath} fill="none" stroke="rgb(var(--primary))" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * Individual indicator card
 */
function IndicatorCard({ indicator }: { indicator: IndicatorData }) {
  return (
    <article className="bg-surface border border-border/10 dark:border-border rounded-xl p-7">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <span className="font-antonio text-lg font-semibold tracking-[0.06em] uppercase">
          {indicator.name} · {indicator.period}
        </span>
        <FlagBadge flag={indicator.flag} label={indicator.flagLabel} />
      </div>

      {/* Value */}
      <div className="font-antonio text-[44px] font-semibold tracking-[0.02em] mt-4 leading-none">
        {indicator.value}
      </div>

      {/* Note */}
      <div className="text-[13px] text-text-secondary mt-2">{indicator.note}</div>

      {/* Type-specific visualization */}
      {indicator.type === 'rsi' && (
        <RSIVisualization value={indicator.rsiValue} />
      )}
      {indicator.type === 'bollinger' && (
        <BollingerVisualization
          lower={indicator.lower}
          mid={indicator.mid}
          upper={indicator.upper}
          position={indicator.position}
        />
      )}
      {indicator.type === 'atr' && <ATRSparkline data={indicator.sparkData} />}
    </article>
  );
}

/**
 * Indicators section props
 */
interface IndicatorsSectionProps {
  indicators: IndicatorData[];
  className?: string;
}

/**
 * Technical indicators section
 */
export function IndicatorsSection({
  indicators,
  className,
}: IndicatorsSectionProps) {
  const bullishCount = indicators.filter((i) => i.flag === 'bullish').length;

  return (
    <section className={cn('mt-14', className)}>
      <SectionHead
        eyebrow="Technical Indicators"
        title="What the instruments say"
        linkText={`${indicators.length} of 7 shown · ${bullishCount} confirm long bias`}
        linkHref="#"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {indicators.map((indicator) => (
          <IndicatorCard key={indicator.name} indicator={indicator} />
        ))}
      </div>
    </section>
  );
}

/**
 * Mock indicators data for development
 */
export const MOCK_INDICATORS: IndicatorData[] = [
  {
    type: 'rsi',
    name: 'RSI',
    period: '14',
    flag: 'bullish',
    flagLabel: 'Oversold',
    value: '28.5',
    note: 'Below the 30-line for the first time since February — a strong mean-reversion cue.',
    rsiValue: 28.5,
  },
  {
    type: 'bollinger',
    name: 'Bollinger',
    period: '20,2',
    flag: 'bullish',
    flagLabel: 'At lower band',
    value: '$43,310',
    note: 'Price sits on the lower band; bandwidth tightening into a likely expansion.',
    lower: '43,180',
    mid: '44,920',
    upper: '46,660',
    position: 12,
  },
  {
    type: 'atr',
    name: 'ATR',
    period: '14',
    flag: 'neutral',
    flagLabel: 'Elevated',
    value: '$1,184',
    note: 'Volatility 18% above the 30-day mean — size positions accordingly.',
    sparkData: [46, 42, 44, 38, 40, 34, 36, 30, 32, 26, 28, 22, 20, 24, 18, 16, 12, 14],
  },
];
