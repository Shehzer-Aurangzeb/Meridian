'use client';

import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div className={cn('bg-surface border border-primary/[0.08] rounded-xl p-6', className)}>
      <Skeleton className="h-3 w-20 mb-4" />
      <Skeleton className="h-10 w-28 mb-2" />
      <Skeleton className="h-4 w-36" />
    </div>
  );
}
