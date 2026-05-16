import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface CaptionProps {
  children: ReactNode;
  className?: string;
}

export function Caption({ children, className }: CaptionProps) {
  return (
    <span className={cn('font-inter text-sm text-text-secondary', className)}>
      {children}
    </span>
  );
}
