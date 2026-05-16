import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface BadgeTextProps {
  children: ReactNode;
  className?: string;
}

export function BadgeText({ children, className }: BadgeTextProps) {
  return (
    <span
      className={cn(
        'font-inter text-xs font-semibold uppercase tracking-wide',
        className
      )}
    >
      {children}
    </span>
  );
}
