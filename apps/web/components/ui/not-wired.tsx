import { cn } from '@/lib/utils';

interface NotWiredProps {
  title: string;
  /** What is missing, in the user's terms — not "TODO". */
  detail: string;
  className?: string;
}

/**
 * Stands in for a panel whose feature flag is off.
 *
 * Deliberately visible rather than rendered as nothing: an empty dashboard
 * reads as broken, and a placeholder that names what is missing reads as
 * scaffolding. It also keeps the flag's effect obvious while wiring.
 */
export function NotWired({ title, detail, className }: NotWiredProps) {
  return (
    <div
      className={cn(
        'bg-surface border border-dashed border-border/30 dark:border-border rounded-xl p-6 text-center',
        className
      )}
    >
      <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-gold-ink">
        {title}
      </p>
      <p className="text-text-tertiary text-sm mt-1.5">{detail}</p>
    </div>
  );
}
