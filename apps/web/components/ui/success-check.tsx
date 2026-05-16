'use client';

import { cn } from '@/lib/utils';

interface SuccessCheckProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function SuccessCheck({ size = 'md', className }: SuccessCheckProps) {
  const sizeStyles = {
    sm: 'w-5 h-5',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <svg
      className={cn(sizeStyles[size], className)}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        className="animate-circle-draw"
        style={{ strokeDasharray: 63, strokeDashoffset: 63 }}
      />
      <path
        d="M8 12l3 3 5-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-check-draw"
        style={{ strokeDasharray: 24, strokeDashoffset: 24 }}
      />
    </svg>
  );
}
