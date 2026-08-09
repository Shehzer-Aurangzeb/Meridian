'use client';

import { cn } from '@/lib/utils';

export interface AlertTab {
  id: string;
  label: string;
  count: number;
}

export const ALERTS_TABS: AlertTab[] = [
  { id: 'active', label: 'Active', count: 8 },
  { id: 'triggered', label: 'Triggered', count: 12 },
  { id: 'paused', label: 'Paused', count: 2 },
];

interface AlertTabsProps {
  tabs: AlertTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function AlertTabs({ tabs, activeTab, onTabChange }: AlertTabsProps) {
  return (
    <div className="flex gap-0 border-b border-border/10 dark:border-border mb-6" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          role="tab"
          aria-selected={activeTab === tab.id}
          className={cn(
            'px-5 py-3 text-[13px] font-medium tracking-[0.1em] uppercase',
            'border-b-2 -mb-px transition-colors cursor-pointer',
            activeTab === tab.id
              ? 'text-text-primary border-gold'
              : 'text-text-tertiary border-transparent hover:text-primary'
          )}
        >
          {tab.label}
          <span className="font-mono text-[11px] text-text-tertiary ml-2 tracking-[0.04em]">
            {tab.count}
          </span>
        </button>
      ))}
    </div>
  );
}
