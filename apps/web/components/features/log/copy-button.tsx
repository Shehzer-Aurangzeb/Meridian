'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  text: () => string;
  label: string;
  copiedLabel?: string;
  variant?: 'primary' | 'quiet';
}

export function CopyButton({
  text,
  label,
  copiedLabel = 'Copied',
  variant = 'quiet',
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setState('copied');
    } catch {
      // Clipboard access is denied over plain HTTP and in some browsers. Saying
      // so beats a button that silently does nothing.
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'rounded-sm px-3 py-1.5 font-mono text-[13px] transition-colors',
        variant === 'primary'
          ? 'bg-gold text-gold-contrast hover:opacity-90'
          : 'border border-border/60 text-text-secondary hover:border-gold/60 hover:text-text-primary',
      )}
    >
      {state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
