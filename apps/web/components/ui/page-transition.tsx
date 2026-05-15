'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
  delay?: 'none' | 'short' | 'medium';
}

export function PageTransition({ children, className, delay = 'none' }: PageTransitionProps) {
  const delayClass = {
    none: '',
    short: 'animation-delay-100',
    medium: 'animation-delay-200',
  };

  return (
    <div
      className={cn(
        'animate-fade-in-up opacity-0',
        '[animation-fill-mode:forwards]',
        delayClass[delay],
        className
      )}
      style={{
        animationDelay: delay === 'short' ? '100ms' : delay === 'medium' ? '200ms' : '0ms',
      }}
    >
      {children}
    </div>
  );
}

interface StaggerContainerProps {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
}

export function StaggerContainer({ children, className, staggerDelay = 50 }: StaggerContainerProps) {
  return (
    <div className={className}>
      {Array.isArray(children)
        ? children.map((child, index) => (
            <div
              key={index}
              className="animate-fade-in-up opacity-0 [animation-fill-mode:forwards]"
              style={{ animationDelay: `${index * staggerDelay}ms` }}
            >
              {child}
            </div>
          ))
        : children}
    </div>
  );
}
