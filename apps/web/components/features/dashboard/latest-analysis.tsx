import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Panel, PanelHead } from './panel';

/**
 * Meta row for analysis details
 */
interface MetaItem {
  label: string;
  value: string;
  variant?: 'entry' | 'stop' | 'default';
}

function MetaRow({ items }: { items: MetaItem[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-4 pt-5 border-t border-border/10 dark:border-border">
      {items.map((item) => (
        <div key={item.label}>
          <div className="text-[11px] tracking-[0.16em] uppercase text-text-tertiary font-medium">
            {item.label}
          </div>
          <div
            className={cn(
              'font-antonio text-[22px] font-semibold tracking-[0.02em] mt-2',
              item.variant === 'entry' && 'text-gold-ink',
              item.variant === 'stop' && 'text-rust',
              (!item.variant || item.variant === 'default') && 'text-text-primary'
            )}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Mock latest analysis data
 */
const MOCK_ANALYSIS = {
  asset: 'BTC',
  timeframe: '1D',
  strategy: 'Mean-reversion',
  time: '09:42 UTC',
  direction: 'Long' as const,
  confidence: 82,
  meta: [
    { label: 'Entry', value: '$43,250', variant: 'entry' as const },
    { label: 'TP1', value: '$44,820', variant: 'default' as const },
    { label: 'TP2', value: '$46,400', variant: 'default' as const },
    { label: 'Stop', value: '$42,360', variant: 'stop' as const },
  ],
};

/**
 * Latest analysis panel
 */
export function LatestAnalysis() {
  const analysis = MOCK_ANALYSIS;

  return (
    <Panel>
      <PanelHead title="Latest analysis" linkText="VIEW FULL →" linkHref="/analysis" />
      
      <div className="p-6 md:p-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-antonio text-[44px] font-bold tracking-[0.04em] uppercase leading-none">
              {analysis.asset} · {analysis.timeframe}
            </div>
            <div className="font-mono text-xs text-text-tertiary mt-1.5 tracking-[0.04em]">
              {analysis.strategy} · {analysis.time}
            </div>
          </div>
          <Badge type="long">
            {analysis.direction} · {analysis.confidence}%
          </Badge>
        </div>

        {/* Meta values */}
        <MetaRow items={analysis.meta} />
      </div>
    </Panel>
  );
}
