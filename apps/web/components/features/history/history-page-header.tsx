'use client';

import Link from 'next/link';
import { PlusIcon } from '@/assets/icons/plus-icon';

/**
 * Header section for the History page
 * Includes eyebrow, title, description, and "New analysis" action button
 */
export function HistoryPageHeader() {
  return (
    <header className="mb-8 flex flex-col md:flex-row md:items-start md:justify-between gap-6">
      <div>
        <div className="eyebrow relative pl-4 before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-3 before:bg-gold before:rounded-full">
          The record
        </div>
        <h1 className="font-display text-[44px] md:text-[52px] font-semibold tracking-[0.02em] leading-[1.05] text-text-primary mt-3">
          History
        </h1>
        <p className="text-base text-text-secondary leading-relaxed max-w-xl mt-3">
          Every analysis you've run, with the outcome tracked once price has resolved against entry, target or stop.
        </p>
      </div>
      
      <Link
        href="/analysis"
        className="inline-flex items-center gap-2 px-5 py-2.5 border border-border/10 dark:border-border rounded-full text-[13px] font-medium text-text-primary hover:border-border-hover/18 dark:hover:border-border-hover transition-colors whitespace-nowrap"
      >
        <PlusIcon className="w-3.5 h-3.5" />
        New analysis
      </Link>
    </header>
  );
}
