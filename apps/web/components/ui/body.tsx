import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface BodyProps {
  children: ReactNode;
  className?: string;
}

export function Body({ children, className }: BodyProps) {
  return (
    <p
      className={cn(
        'font-inter text-base text-text-primary leading-relaxed',
        className
      )}
    >
      {children}
    </p>
  );
}
