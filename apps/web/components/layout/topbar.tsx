'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PAGE_TITLES } from '@/lib/navigation';
import { SearchIcon, MenuIcon } from '@/components/ui/icons';

/**
 * Market status indicator pill
 */
function MarketPill() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });

  return (
    <div className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 pl-2.5 border border-border/10 dark:border-border rounded-full font-mono text-xs text-text-primary bg-surface whitespace-nowrap shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-sage shadow-[0_0_0_3px] shadow-sage/20" />
      Markets open
      <span className="text-muted-2 ml-1.5 hidden lg:inline">·  {dateStr} · {timeStr} UTC</span>
    </div>
  );
}

/**
 * Icon button component
 */
function IconButton({
  children,
  onClick,
  ariaLabel,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        'w-[34px] h-[34px] rounded-full',
        'border border-border/10 dark:border-border bg-transparent',
        'grid place-items-center',
        'text-text-primary cursor-pointer',
        'transition-all duration-[160ms]',
        'hover:bg-surface-hover hover:border-border-hover/18 dark:hover:border-border-hover',
        className
      )}
    >
      {children}
    </button>
  );
}

/**
 * Breadcrumb / page title component
 */
function Breadcrumbs() {
  const pathname = usePathname();
  const pageTitle = PAGE_TITLES[pathname] || 'Dashboard';

  return (
    <div className="text-xs tracking-[0.14em] uppercase font-medium">
      <span className="text-text-primary">{pageTitle}</span>
    </div>
  );
}

/**
 * Topbar props
 */
interface TopbarProps {
  onMenuClick?: () => void;
  className?: string;
}

/**
 * Top navigation bar component
 * Displays breadcrumbs, market status, and action buttons
 */
export function Topbar({ onMenuClick, className }: TopbarProps) {
  return (
    <header
      className={cn(
        'h-16 border-b border-border/10 dark:border-border',
        'flex items-center justify-between',
        'px-5 md:px-10',
        'bg-background',
        'sticky top-0 z-30',
        className
      )}
    >
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className={cn(
            'md:hidden inline-flex',
            'w-[38px] h-[38px] rounded-lg',
            'border border-border/10 dark:border-border bg-surface',
            'items-center justify-center',
            'cursor-pointer',
            'transition-colors duration-[160ms]',
            'hover:border-border-hover/18 dark:hover:border-border-hover'
          )}
        >
          <MenuIcon className="w-[18px] h-[18px]" />
        </button>

        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-2">
        <MarketPill />
        <IconButton ariaLabel="Search">
          <SearchIcon className="w-4 h-4" />
        </IconButton>
      </div>
    </header>
  );
}
