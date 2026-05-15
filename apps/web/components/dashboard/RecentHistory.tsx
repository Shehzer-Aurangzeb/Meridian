import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Panel, PanelHead } from './Panel';
import { Badge } from './LatestAnalysis';

/**
 * History item type
 */
interface HistoryItem {
  id: string;
  coin: string;
  strategy: string;
  timeframe: string;
  date: string;
  confidence: number;
  status: 'open' | 'win' | 'loss' | 'neutral';
  result?: string;
}

/**
 * History row component
 */
function HistoryRow({ item }: { item: HistoryItem }) {
  const getBadgeContent = () => {
    if (item.status === 'open') return 'Open';
    if (item.status === 'neutral') return 'Skipped';
    return item.result || '';
  };

  return (
    <Link
      href={`/history?id=${item.id}`}
      className={cn(
        'grid grid-cols-[56px_1fr_auto] md:grid-cols-[56px_1fr_auto_auto_auto] items-center gap-4',
        'px-6 py-4 border-b border-border/10 dark:border-border',
        'no-underline text-inherit',
        'transition-colors duration-[160ms]',
        'hover:bg-primary/[0.025]',
        'last:border-b-0'
      )}
    >
      <span className="font-antonio text-lg font-semibold tracking-[0.04em] uppercase">
        {item.coin}
      </span>
      
      <span className="text-text-secondary text-[13px] truncate">
        {item.strategy} · {item.timeframe}
      </span>
      
      <span className="font-mono text-xs text-text-tertiary tracking-[0.04em] hidden md:block">
        {item.date}
      </span>
      
      <span className="font-mono text-[13px] text-text-primary hidden md:block">
        {item.confidence}%
      </span>
      
      <Badge type={item.status}>{getBadgeContent()}</Badge>
    </Link>
  );
}

/**
 * Mock history data
 */
const MOCK_HISTORY: HistoryItem[] = [
  {
    id: '1',
    coin: 'BTC',
    strategy: 'Mean-reversion',
    timeframe: '1D',
    date: '13 May',
    confidence: 82,
    status: 'open',
  },
  {
    id: '2',
    coin: 'ETH',
    strategy: 'Trend continuation',
    timeframe: '4H',
    date: '12 May',
    confidence: 74,
    status: 'win',
    result: '+ 2.8R',
  },
  {
    id: '3',
    coin: 'SOL',
    strategy: 'Breakout',
    timeframe: '1D',
    date: '11 May',
    confidence: 69,
    status: 'loss',
    result: '− 1.0R',
  },
  {
    id: '4',
    coin: 'LINK',
    strategy: 'Mean-reversion',
    timeframe: '1D',
    date: '10 May',
    confidence: 77,
    status: 'win',
    result: '+ 1.6R',
  },
  {
    id: '5',
    coin: 'AVAX',
    strategy: 'Range fade',
    timeframe: '4H',
    date: '09 May',
    confidence: 61,
    status: 'neutral',
  },
];

/**
 * Recent history panel
 */
export function RecentHistory() {
  return (
    <Panel>
      <PanelHead title="Recent history" linkText="VIEW ALL →" linkHref="/history" />
      
      <div className="flex flex-col">
        {MOCK_HISTORY.map((item) => (
          <HistoryRow key={item.id} item={item} />
        ))}
      </div>
    </Panel>
  );
}
