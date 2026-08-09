import { cn } from '@/lib/utils';

interface DisclaimerProps {
  text: string;
  suffix?: string;
  variant?: 'default' | 'hero';
}

export function Disclaimer({ text, suffix, variant = 'default' }: DisclaimerProps) {
  const isHero = variant === 'hero';

  return (
    <footer
      className={cn(
        'flex items-center justify-between text-xs text-text-tertiary border-t border-border/10 dark:border-border',
        isHero ? 'mt-16 pt-6 tracking-[0.04em] gap-6 flex-wrap' : 'mt-10 pt-6'
      )}
    >
      <div>{text}</div>
      <div
        className={cn(
          isHero
            ? 'font-antonio uppercase tracking-[0.18em] text-text-secondary'
            : 'font-display text-sm font-medium tracking-[0.04em]'
        )}
      >
        Meridian{suffix ? ` ${suffix}` : ''}
      </div>
    </footer>
  );
}
