'use client';

import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block font-inter text-sm font-medium text-text-primary mb-2"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full bg-background border border-primary/20 px-4 py-3 rounded-lg',
              'font-inter text-base text-text-primary',
              'placeholder:text-text-secondary',
              'outline-none transition-all duration-200 ease-out',
              'focus:border-gold focus:ring-2 focus:ring-gold/15',
              'hover:border-primary/30',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-primary/20',
              error && 'border-rust focus:border-rust focus:ring-rust/15',
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p className="mt-1.5 font-inter text-sm text-rust">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
