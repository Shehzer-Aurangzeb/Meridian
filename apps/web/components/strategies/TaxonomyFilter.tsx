'use client';

import { cn } from '@/lib/utils';

/**
 * Taxonomy filter option
 */
export interface TaxonomyOption {
  id: string;
  label: string;
  count: number;
}

/**
 * Taxonomy filter chips for filtering strategies
 */
interface TaxonomyFilterProps {
  options: TaxonomyOption[];
  activeFilter: string;
  onFilterChange: (filterId: string) => void;
}

export function TaxonomyFilter({ options, activeFilter, onFilterChange }: TaxonomyFilterProps) {
  return (
    <div className="flex gap-2 flex-wrap mb-6">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onFilterChange(option.id)}
          className={cn(
            'px-4 py-2 rounded-full text-[13px] transition-all cursor-pointer',
            'border',
            activeFilter === option.id
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-transparent text-text-secondary border-border/10 dark:border-border hover:text-text-primary hover:border-border-hover'
          )}
        >
          {option.label}
          <span className="font-mono text-[11px] ml-2 opacity-55">{option.count}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Default taxonomy options
 */
export const TAXONOMY_OPTIONS: TaxonomyOption[] = [
  { id: 'all', label: 'All', count: 6 },
  { id: 'contrarian', label: 'Contrarian', count: 2 },
  { id: 'directional', label: 'Directional', count: 3 },
  { id: 'volatility', label: 'Volatility', count: 1 },
];
