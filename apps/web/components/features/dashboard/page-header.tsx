import { cn } from '@/lib/utils';
import { USER } from '@/lib/constants';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

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

interface PageHeaderProps {
  userName?: string;
  subhead?: string;
  className?: string;
}

export function PageHeader({
  userName = USER.firstName,
  // Was a fabricated summary — open positions, alert counts, a claim about
  // where BTC was trading. Nothing on this page can know any of that yet.
  subhead = 'Ten coins are analysed automatically every eight hours. Open one to see its levels, the plan, and what price has done since.',
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
