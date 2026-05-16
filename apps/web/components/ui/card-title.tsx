import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface CardTitleProps {
  children: ReactNode;
  className?: string;
}

export function CardTitle({ children, className }: CardTitleProps) {
  return (
    <h3
      className={cn(
        'font-inter text-xl md:text-2xl font-semibold text-text-primary',
        className
      )}
    >
      {children}
    </h3>
  );
}
