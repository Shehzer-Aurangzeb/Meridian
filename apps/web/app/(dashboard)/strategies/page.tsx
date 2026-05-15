'use client';

import { useState, useMemo } from 'react';
import {
  StrategiesPageHeader,
  TaxonomyFilter,
  StrategyGrid,
  TAXONOMY_OPTIONS,
  MOCK_STRATEGIES,
} from '@/components/features/strategies';

/**
 * Disclaimer footer
 */
function Disclaimer() {
  return (
    <footer className="flex items-center justify-between text-xs text-text-tertiary mt-10 pt-6 border-t border-border/10 dark:border-border">
      <div>
        Strategies and their weights are reviewed monthly. Statistics are out-of-sample, computed on 90-day rolling windows.
      </div>
      <div className="font-display text-sm font-medium tracking-[0.04em]">
        Meridian · Strategy library v4.2
      </div>
    </footer>
  );
}

export default function StrategiesPage() {
  const [activeFilter, setActiveFilter] = useState('all');

  // Filter strategies based on active filter
  const filteredStrategies = useMemo(() => {
    if (activeFilter === 'all') {
      return MOCK_STRATEGIES;
    }
    return MOCK_STRATEGIES.filter((s) => s.category === activeFilter);
  }, [activeFilter]);

  return (
    <div className="p-5 md:p-8 lg:p-10">
      <StrategiesPageHeader />

      <section>
        <TaxonomyFilter
          options={TAXONOMY_OPTIONS}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
        />

        <StrategyGrid strategies={filteredStrategies} />
      </section>

      <Disclaimer />
    </div>
  );
}
