import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface TypographyProps {
  children: ReactNode;
  className?: string;
}

export function Headline({ children, className }: TypographyProps) {
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

export function SectionHeader({ children, className }: TypographyProps) {
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

export function CardTitle({ children, className }: TypographyProps) {
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

export function Eyebrow({ children, className }: TypographyProps) {
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

export function Body({ children, className }: TypographyProps) {
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

export function Caption({ children, className }: TypographyProps) {
  return (
    <span className={cn('font-inter text-sm text-text-secondary', className)}>
      {children}
    </span>
  );
}

export function Price({
  children,
  className,
  highlight = false,
}: TypographyProps & { highlight?: boolean }) {
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

export function BadgeText({ children, className }: TypographyProps) {
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
