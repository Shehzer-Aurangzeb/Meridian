import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface HeadlineProps {
  children: ReactNode;
  className?: string;
}

export function Headline({ children, className }: HeadlineProps) {
  return (
    <h1
      className={cn(
        'font-antonio text-5xl md:text-6xl lg:text-7xl font-bold uppercase tracking-headline text-text-primary',
        className
      )}
    >
      {children}
    </h1>
  );
}
