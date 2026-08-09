'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface TriggeredAlert {
  id: string;
  coin: string;
  rule: string;
  ruleHighlight: string;
  alertType: 'price' | 'signal' | 'indicator';
  deliveryMethod: string;
  triggeredAt: string;
  isRecent: boolean;
  actionLabel: string;
  actionHref: string;
}

interface TriggeredSectionHeaderProps {
  onClearAll?: () => void;
}

export function TriggeredSectionHeader({ onClearAll }: TriggeredSectionHeaderProps) {
  return (
    <div className="flex items-end justify-between mt-12 mb-4">
      <div>
        <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-text-tertiary">
          Recent
        </div>
        <h2 className="font-display text-xl font-semibold tracking-[0.02em] text-text-primary mt-1">
          Triggered alerts
        </h2>
      </div>
      <button
        onClick={onClearAll}
        className="font-mono text-xs text-text-secondary tracking-[0.06em] uppercase hover:text-primary transition-colors"
      >
        Clear all
      </button>
    </div>
  );
}

interface TriggeredAlertRowProps {
  alert: TriggeredAlert;
  isLast?: boolean;
}

function TriggeredAlertRow({ alert, isLast }: TriggeredAlertRowProps) {
  const alertTypeLabel =
    alert.alertType === 'price'
      ? 'Price alert'
      : alert.alertType === 'signal'
      ? 'Signal alert'
      : 'Indicator alert';

  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-[auto_64px_1fr_auto] gap-3 md:gap-5 items-center',
        'p-4 md:px-6 md:py-4',
        !isLast && 'border-b border-border/10 dark:border-border'
      )}
    >
      {/* Marker */}
      <div
        className={cn(
          'w-2 h-2 rounded-full hidden md:block',
          alert.isRecent ? 'bg-gold' : 'bg-text-tertiary/40'
        )}
      />

      {/* Coin */}
      <div className="font-display text-xl font-semibold tracking-[0.04em] uppercase text-text-primary">
        {alert.coin}
      </div>

      {/* Rule & metadata */}
      <div>
        <div className="text-sm text-text-primary">
          {alert.rule && `${alert.rule} `}
          <code className="font-mono text-xs text-gold-ink bg-gold/20 px-2 py-0.5 rounded">
            {alert.ruleHighlight}
          </code>
        </div>
        <div className="text-xs text-text-tertiary mt-1 font-mono tracking-[0.04em]">
          {alertTypeLabel} · {alert.deliveryMethod}
        </div>
      </div>

      {/* Time & action */}
      <div className="flex items-center gap-3 font-mono text-xs tracking-[0.04em] text-text-tertiary whitespace-nowrap">
        <span>{alert.triggeredAt}</span>
        <Link
          href={alert.actionHref}
          className="text-text-secondary underline hover:text-primary transition-colors"
        >
          {alert.actionLabel}
        </Link>
      </div>
    </div>
  );
}

interface TriggeredAlertsListProps {
  alerts: TriggeredAlert[];
}

export function TriggeredAlertsList({ alerts }: TriggeredAlertsListProps) {
  return (
    <div className="bg-surface border border-border/10 dark:border-border rounded-lg overflow-hidden">
      {alerts.map((alert, idx) => (
        <TriggeredAlertRow
          key={alert.id}
          alert={alert}
          isLast={idx === alerts.length - 1}
        />
      ))}
    </div>
  );
}

/**
 * Mock triggered alerts data
 */
export const MOCK_TRIGGERED_ALERTS: TriggeredAlert[] = [
  {
    id: 't1',
    coin: 'BTC',
    rule: '',
    ruleHighlight: 'RSI < 30',
    alertType: 'indicator',
    deliveryMethod: 'email + push delivered',
    triggeredAt: '13 May · 09:14',
    isRecent: true,
    actionLabel: 'Run analysis',
    actionHref: '/analysis?coin=BTC',
  },
  {
    id: 't2',
    coin: 'BTC',
    rule: 'New',
    ruleHighlight: 'Long',
    alertType: 'signal',
    deliveryMethod: 'push delivered',
    triggeredAt: '13 May · 09:42',
    isRecent: true,
    actionLabel: 'View signal',
    actionHref: '/analysis?coin=BTC',
  },
  {
    id: 't3',
    coin: 'ETH',
    rule: 'Price crosses above',
    ruleHighlight: '$2,500',
    alertType: 'price',
    deliveryMethod: 'email delivered',
    triggeredAt: '12 May · 14:08',
    isRecent: false,
    actionLabel: 'Run analysis',
    actionHref: '/analysis?coin=ETH',
  },
  {
    id: 't4',
    coin: 'SOL',
    rule: 'Confidence on any signal exceeds',
    ruleHighlight: '75%',
    alertType: 'signal',
    deliveryMethod: 'email delivered',
    triggeredAt: '11 May · 19:32',
    isRecent: false,
    actionLabel: 'View signal',
    actionHref: '/analysis?coin=SOL',
  },
  {
    id: 't5',
    coin: 'LINK',
    rule: '',
    ruleHighlight: 'RSI > 70',
    alertType: 'indicator',
    deliveryMethod: 'email delivered',
    triggeredAt: '10 May · 03:21',
    isRecent: false,
    actionLabel: 'Run analysis',
    actionHref: '/analysis?coin=LINK',
  },
];
