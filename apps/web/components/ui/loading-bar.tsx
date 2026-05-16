'use client';

import { cn } from '@/lib/utils';

interface LoadingBarProps {
  className?: string;
}

export function LoadingBar({ className }: LoadingBarProps) {
  return (
    <div className={cn('w-full h-1 bg-primary/10 rounded-full overflow-hidden', className)}>
      <div className="h-full bg-gold rounded-full animate-loading-bar" />
    </div>
  );
}
