import { cn } from '@/lib/utils';

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

interface AnalysisPageHeaderProps {
  coin?: string;
  className?: string;
}

export function AnalysisPageHeader({ coin, className }: AnalysisPageHeaderProps) {
  return (
    <header className={cn('mb-2', className)}>
      <Eyebrow>Analysis</Eyebrow>
      <h1 className="font-antonio font-bold text-display-sm md:text-display leading-[0.98] tracking-headline uppercase text-text-primary m-0 mb-[18px]">
        A Considered
        <br />
        View on <span className="text-gold">{coin || '…'}</span>
      </h1>
      <p className="text-[17px] text-text-secondary max-w-[620px] leading-relaxed m-0">
        Where four timeframes agree on a level, what regime the market is in,
        and the plan that follows — entries, stop, targets, and what would prove
        it wrong.
      </p>
    </header>
  );
}
