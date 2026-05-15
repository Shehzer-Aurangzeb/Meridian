'use client';

import { cn } from '@/lib/utils';

/**
 * Alert data type
 */
export interface AlertData {
  id: string;
  coin: string;
  rule: string;
  ruleHighlight: string;
  createdDate: string;
  notificationMethod: string;
  status: 'armed' | 'fired';
  statusLabel: string;
  enabled: boolean;
}

/**
 * Toggle switch component
 */
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'w-[38px] h-[22px] rounded-full relative cursor-pointer flex-shrink-0',
        'transition-colors duration-200',
        checked
          ? 'bg-primary border-primary'
          : 'bg-primary/[0.08] border-primary/20',
        'border'
      )}
    >
      <span
        className={cn(
          'absolute top-[2px] w-4 h-4 rounded-full bg-background transition-[left] duration-200',
          checked ? 'left-[18px]' : 'left-[2px]'
        )}
      />
    </button>
  );
}

/**
 * Section header for alert groups
 */
interface AlertSectionHeaderProps {
  title: string;
  count: number;
  className?: string;
}

export function AlertSectionHeader({ title, count, className }: AlertSectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between mb-4', className)}>
      <h2 className="font-display text-xl font-semibold tracking-[0.02em] text-text-primary">
        {title}
      </h2>
      <div className="font-mono text-[12px] tracking-[0.04em] text-text-tertiary">
        {count} active
      </div>
    </div>
  );
}

/**
 * Individual alert row
 */
interface AlertRowProps {
  alert: AlertData;
  onToggle?: (id: string, enabled: boolean) => void;
  isFirst?: boolean;
  isLast?: boolean;
  isOnly?: boolean;
}

export function AlertRow({ alert, onToggle, isFirst, isLast, isOnly }: AlertRowProps) {
  const handleToggle = (enabled: boolean) => {
    onToggle?.(alert.id, enabled);
  };

  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-[64px_1fr_auto_auto] gap-3 md:gap-5 items-center',
        'p-4 md:p-5 md:px-6 bg-surface border border-border/10 dark:border-border -mt-px',
        isOnly && 'rounded-lg mt-0',
        isFirst && !isOnly && 'rounded-t-lg mt-0',
        isLast && !isOnly && 'rounded-b-lg'
      )}
    >
      {/* Coin */}
      <div className="font-display text-xl font-semibold tracking-[0.04em] uppercase text-text-primary">
        {alert.coin}
      </div>

      {/* Rule & metadata */}
      <div className="md:col-span-1 col-span-full">
        <div className="text-sm text-text-primary">
          {alert.rule}{' '}
          <code className="font-mono text-xs text-gold-ink bg-gold/20 px-2 py-0.5 rounded ml-1">
            {alert.ruleHighlight}
          </code>
        </div>
        <div className="text-xs text-text-tertiary mt-1 font-mono tracking-[0.04em]">
          Created {alert.createdDate} · {alert.notificationMethod}
        </div>
      </div>

      {/* Status */}
      <div
        className={cn(
          'font-mono text-xs tracking-[0.04em] whitespace-nowrap',
          'md:text-right',
          alert.status === 'fired' ? 'text-text-primary' : 'text-text-tertiary'
        )}
      >
        {alert.statusLabel}
      </div>

      {/* Toggle */}
      <Toggle checked={alert.enabled} onChange={handleToggle} />
    </div>
  );
}

/**
 * Alert list wrapper
 */
interface AlertListProps {
  alerts: AlertData[];
  onToggle?: (id: string, enabled: boolean) => void;
}

export function AlertList({ alerts, onToggle }: AlertListProps) {
  return (
    <div className="flex flex-col">
      {alerts.map((alert, idx) => (
        <AlertRow
          key={alert.id}
          alert={alert}
          onToggle={onToggle}
          isFirst={idx === 0}
          isLast={idx === alerts.length - 1}
          isOnly={alerts.length === 1}
        />
      ))}
    </div>
  );
}

/**
 * Mock price alerts
 */
export const MOCK_PRICE_ALERTS: AlertData[] = [
  {
    id: 'p1',
    coin: 'BTC',
    rule: 'Price crosses above',
    ruleHighlight: '$45,000',
    createdDate: '11 May',
    notificationMethod: 'email + push',
    status: 'armed',
    statusLabel: 'Last check 09:42 · armed',
    enabled: true,
  },
  {
    id: 'p2',
    coin: 'ETH',
    rule: 'Price crosses below',
    ruleHighlight: '$2,300',
    createdDate: '09 May',
    notificationMethod: 'email',
    status: 'armed',
    statusLabel: 'Last check 09:42 · armed',
    enabled: true,
  },
  {
    id: 'p3',
    coin: 'SOL',
    rule: 'Price crosses above',
    ruleHighlight: '$160.00',
    createdDate: '08 May',
    notificationMethod: 'push',
    status: 'armed',
    statusLabel: 'Last check 09:42 · armed',
    enabled: true,
  },
];

/**
 * Mock signal alerts
 */
export const MOCK_SIGNAL_ALERTS: AlertData[] = [
  {
    id: 's1',
    coin: 'BTC',
    rule: 'Any new',
    ruleHighlight: 'Long',
    createdDate: '12 May',
    notificationMethod: 'email + push',
    status: 'fired',
    statusLabel: 'Last fired 13 May',
    enabled: true,
  },
  {
    id: 's2',
    coin: 'ETH',
    rule: 'Confidence on any signal exceeds',
    ruleHighlight: '80%',
    createdDate: '04 May',
    notificationMethod: 'email',
    status: 'armed',
    statusLabel: 'Last check 09:42 · armed',
    enabled: true,
  },
  {
    id: 's3',
    coin: 'Any',
    rule: 'New',
    ruleHighlight: 'Short',
    createdDate: '02 May',
    notificationMethod: 'push',
    status: 'armed',
    statusLabel: 'Last check 09:42 · armed',
    enabled: true,
  },
];

/**
 * Mock indicator alerts
 */
export const MOCK_INDICATOR_ALERTS: AlertData[] = [
  {
    id: 'i1',
    coin: 'BTC',
    rule: '',
    ruleHighlight: 'RSI < 30',
    createdDate: '28 Apr',
    notificationMethod: 'email + push',
    status: 'fired',
    statusLabel: 'Fired 13 May · 09:14',
    enabled: true,
  },
  {
    id: 'i2',
    coin: 'SOL',
    rule: '',
    ruleHighlight: 'Price at lower Bollinger band',
    createdDate: '30 Apr',
    notificationMethod: 'email',
    status: 'armed',
    statusLabel: 'Last check 09:42 · armed',
    enabled: true,
  },
];
