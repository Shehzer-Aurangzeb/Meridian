'use client';

import { cn } from '@/lib/utils';

/**
 * Panel component - card with internal sectioning
 * Matches the design system's panel styling
 */
interface PanelProps {
  children: React.ReactNode;
  className?: string;
}

export function Panel({ children, className }: PanelProps) {
  return (
    <article
      className={cn(
        'bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden',
        className
      )}
    >
      {children}
    </article>
  );
}

interface PanelHeadProps {
  title: string;
  meta?: string;
  linkText?: string;
  linkHref?: string;
}

export function PanelHead({ title, meta, linkText, linkHref }: PanelHeadProps) {
  return (
    <div className="flex items-center justify-between px-6 py-[22px] border-b border-border/10 dark:border-border">
      <h3 className="m-0 font-antonio uppercase tracking-[0.06em] font-semibold text-base">
        {title}
      </h3>
      {meta && (
        <span className="font-mono text-[11px] text-text-tertiary tracking-[0.06em]">
          {meta}
        </span>
      )}
      {linkText && linkHref && (
        <a
          href={linkHref}
          className="text-xs text-text-secondary no-underline tracking-[0.06em] hover:text-text-primary transition-colors"
        >
          {linkText}
        </a>
      )}
    </div>
  );
}
