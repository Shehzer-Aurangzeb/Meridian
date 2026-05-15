'use client';

import { cn } from '@/lib/utils';

interface FilterTabsProps {
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function FilterTabs({ tabs, activeTab, onTabChange }: FilterTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          className={cn(
            'px-4 py-2 font-inter font-medium text-sm rounded-lg',
            'transition-all duration-200 ease-out',
            activeTab === tab
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'bg-surface text-text-primary hover:bg-background border border-primary/[0.08] hover:border-primary/15'
          )}
        >
          {tab === 'all' ? 'All Coins' : tab}
        </button>
      ))}
    </div>
  );
}
