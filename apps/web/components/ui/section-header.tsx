import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface SectionHeaderProps {
  children: ReactNode;
  className?: string;
}

export function SectionHeader({ children, className }: SectionHeaderProps) {
  return (
    <h2
      className={cn(
        'font-antonio text-3xl md:text-4xl lg:text-5xl font-semibold uppercase tracking-headline text-text-primary',
        className
      )}
    >
      {children}
    </h2>
  );
}
