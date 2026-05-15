import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Panel, PanelHead } from './Panel';
import { Badge } from './LatestAnalysis';

/**
 * Alert item type
 */
interface AlertItem {
  id: string;
  coin: string;
  condition: string;
  status: 'triggered' | 'watching';
}

/**
 * Alert row component
 */
function AlertRow({ item }: { item: AlertItem }) {
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto] gap-3.5 items-center',
        'px-6 py-3.5 border-b border-border/10 dark:border-border',
        'last:border-b-0'
      )}
    >
      <div>
        <span className="font-antonio text-[17px] font-semibold tracking-[0.04em] uppercase">
          {item.coin}
          <span className="block font-inter text-[11px] font-normal text-text-tertiary normal-case tracking-normal mt-0.5">
            {item.condition}
          </span>
        </span>
      </div>
      
      <Badge type={item.status === 'triggered' ? 'long' : 'neutral'}>
        {item.status === 'triggered' ? 'Triggered' : 'Watching'}
      </Badge>
    </div>
  );
}

/**
 * Mock alerts data
 */
const MOCK_ALERTS: AlertItem[] = [
  {
    id: '1',
    coin: 'BTC',
    condition: 'RSI < 30 on 1D',
    status: 'triggered',
  },
  {
    id: '2',
    coin: 'ETH',
    condition: 'Price above $2,500',
    status: 'watching',
  },
  {
    id: '3',
    coin: 'SOL',
    condition: 'Long signal on 1D',
    status: 'watching',
  },
];

/**
 * Active alerts panel
 */
export function ActiveAlerts() {
  return (
    <Panel>
      <PanelHead title="Active alerts" linkText="VIEW ALL →" linkHref="/alerts" />
      
      <div>
        {MOCK_ALERTS.map((item) => (
          <AlertRow key={item.id} item={item} />
        ))}
      </div>
    </Panel>
  );
}
