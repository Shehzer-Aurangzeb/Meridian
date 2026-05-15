'use client';

import { PlusIcon } from '@/components/ui/icons';

/**
 * Header section for the Alerts page
 * Includes eyebrow, title, description, and "New alert" action button
 */
interface AlertsPageHeaderProps {
  onNewAlert?: () => void;
}

export function AlertsPageHeader({ onNewAlert }: AlertsPageHeaderProps) {
  return (
    <header className="mb-8 flex flex-col md:flex-row md:items-start md:justify-between gap-6">
      <div>
        <div className="eyebrow relative pl-4 before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-3 before:bg-gold before:rounded-full">
          Stay informed
        </div>
        <h1 className="font-display text-[44px] md:text-[52px] font-semibold tracking-[0.02em] leading-[1.05] text-text-primary mt-3">
          Alerts
        </h1>
        <p className="text-base text-text-secondary leading-relaxed max-w-xl mt-3">
          Tell Meridian what's worth interrupting your day for — a price level, a fresh signal, or a technical condition reaching an extreme.
        </p>
      </div>
      
      <button
        onClick={onNewAlert}
        className="inline-flex items-center gap-2 px-5 py-2.5 border border-border/10 dark:border-border rounded-full text-[13px] font-medium text-text-primary hover:border-primary/30 transition-colors whitespace-nowrap"
      >
        <PlusIcon className="w-3.5 h-3.5" />
        New alert
      </button>
    </header>
  );
}
