'use client';

import { useState, FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

interface AnalysisFormProps {
  onAnalyze: (coin: string) => void;
  isLoading: boolean;
}

export function AnalysisForm({ onAnalyze, isLoading }: AnalysisFormProps) {
  const [coin, setCoin] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (coin.trim() && !isLoading) {
      onAnalyze(coin.trim().toUpperCase());
    }
  };

  return (
    <div
      className={cn(
        'bg-surface border border-primary/[0.08] rounded-xl p-8 max-w-xl mx-auto',
        'transition-all duration-300 ease-out',
        'hover:shadow-md hover:shadow-primary/5'
      )}
    >
      <form onSubmit={handleSubmit}>
        <Input
          label="Select Asset"
          value={coin}
          onChange={(e) => setCoin(e.target.value.toUpperCase())}
          placeholder="Enter coin symbol (e.g., BTC, ETH)"
          disabled={isLoading}
          className="uppercase"
        />
        <button
          type="submit"
          disabled={!coin.trim() || isLoading}
          className={cn(
            'w-full mt-6 bg-primary text-primary-foreground font-inter font-medium',
            'py-4 px-8 rounded-lg uppercase tracking-wide text-sm',
            'transition-all duration-200 ease-out',
            'hover:bg-primary/90 hover:shadow-md hover:shadow-primary/15',
            'active:bg-primary active:shadow-sm',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none',
            'flex items-center justify-center gap-3'
          )}
        >
          {isLoading ? (
            <>
              <Spinner size="sm" />
              <span>Analyzing...</span>
            </>
          ) : (
            'Analyze'
          )}
        </button>
      </form>
    </div>
  );
}
