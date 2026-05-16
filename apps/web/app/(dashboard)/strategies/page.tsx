'use client';

import { useState, useMemo } from 'react';
import { StrategiesPageHeader } from '@/components/features/strategies/strategies-page-header';
import { TaxonomyFilter, TAXONOMY_OPTIONS } from '@/components/features/strategies/taxonomy-filter';
import { StrategyGrid, MOCK_STRATEGIES } from '@/components/features/strategies/strategy-card';
import { Disclaimer } from '@/components/ui/disclaimer';

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

      <Disclaimer
        text="Strategies and their weights are reviewed monthly. Statistics are out-of-sample, computed on 90-day rolling windows."
        suffix="· Strategy library v4.2"
      />
    </div>
  );
}
