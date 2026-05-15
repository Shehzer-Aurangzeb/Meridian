import { cn } from '@/lib/utils';

interface BadgeProps {
  type: 'long' | 'short' | 'open' | 'win' | 'loss' | 'neutral';
  children: React.ReactNode;
}

export function Badge({ type, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        'text-[10px] font-bold tracking-[0.16em] uppercase',
        'px-2.5 py-1 rounded whitespace-nowrap',
        type === 'long' && 'bg-sage/20 text-deep-green dark:bg-green/20 dark:text-green',
        type === 'short' && 'bg-rust/15 text-rust',
        type === 'open' && 'bg-gold/20 text-gold-ink',
        type === 'win' && 'bg-sage/20 text-deep-green dark:bg-green/20 dark:text-green',
        type === 'loss' && 'bg-rust/15 text-rust',
        type === 'neutral' && 'bg-primary/[0.08] text-text-secondary'
      )}
    >
      {children}
    </span>
  );
}
