import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface PriceProps {
  children: ReactNode;
  className?: string;
  highlight?: boolean;
}

export function Price({ children, className, highlight = false }: PriceProps) {
  return (
    <span
      className={cn(
        'font-inter font-semibold tabular-nums',
        highlight ? 'text-gold' : 'text-text-primary',
        className
      )}
    >
      {children}
    </span>
  );
}
