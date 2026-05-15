import { cn } from '@/lib/utils';

/**
 * Get greeting based on time of day
 */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Format current date for display
 */
function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Eyebrow text with decorative rule
 */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2.5 whitespace-nowrap mb-4">
      <span className="text-[13px] tracking-[0.18em] uppercase text-gold-ink font-semibold">
        {children}
      </span>
      <span className="w-7 h-px bg-gold" />
    </div>
  );
}

/**
 * PageHeader props
 */
interface PageHeaderProps {
  userName?: string;
  subhead?: string;
  className?: string;
}

/**
 * Dashboard page header with greeting and summary
 */
export function PageHeader({
  userName = 'Elena',
  subhead = 'You have one open position and three indicator alerts since yesterday\'s close. Markets opened calm; BTC is consolidating at support.',
  className,
}: PageHeaderProps) {
  const greeting = getGreeting();
  const dateStr = formatDate();

  return (
    <header className={cn('mb-2', className)}>
      <Eyebrow>{dateStr}</Eyebrow>
      <h1 className="font-antonio font-bold text-display-sm md:text-display leading-[0.98] tracking-headline uppercase text-text-primary m-0 mb-[18px]">
        {greeting},<br />
        {userName}
      </h1>
      <p className="text-[17px] text-text-secondary max-w-[620px] leading-relaxed m-0">
        {subhead}
      </p>
    </header>
  );
}
