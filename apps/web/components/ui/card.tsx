import { cn } from '@/lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  tight?: boolean;
}

export function Card({ children, className, tight }: CardProps) {
  return (
    <div
      className={cn(
        'bg-surface border border-border/10 dark:border-border rounded-xl',
        tight ? 'p-6' : 'p-8',
        className
      )}
    >
      {children}
    </div>
  );
}
