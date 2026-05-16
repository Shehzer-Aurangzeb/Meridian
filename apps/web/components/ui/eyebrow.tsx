import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

export function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <span
      className={cn(
        'font-inter text-xs font-medium uppercase tracking-eyebrow text-gold',
        className
      )}
    >
      {children}
    </span>
  );
}
