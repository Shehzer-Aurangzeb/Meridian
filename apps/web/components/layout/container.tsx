import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface ContainerProps {
  children: ReactNode;
  className?: string;
  narrow?: boolean;
  noPadding?: boolean;
}

export function Container({
  children,
  className,
  narrow = false,
  noPadding = false,
}: ContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-6 md:px-12',
        narrow ? 'max-w-4xl' : 'max-w-7xl',
        !noPadding && 'py-12 md:py-20',
        className
      )}
    >
      {children}
    </div>
  );
}

interface SectionProps {
  children: ReactNode;
  className?: string;
  alternate?: boolean;
  dark?: boolean;
}

export function Section({
  children,
  className,
  alternate = false,
  dark = false,
}: SectionProps) {
  return (
    <section
      className={cn(
        'w-full',
        dark && 'bg-primary text-background',
        alternate && !dark && 'bg-surface',
        className
      )}
    >
      {children}
    </section>
  );
}
