'use client';


/**
 * Coin, window, sort. Every one of them is applied by the SERVER — a filter
 * applied here would only ever see the pages already scrolled past.
 *
 * The free-text search went with that change: it matched coin symbols, which
 * the dropdown already does across every page, over a list of ten.
 */
export interface HistoryFilters {
  coin: string;
  dateRange: '24h' | '7d' | '30d' | 'all';
  sort: 'newest' | 'oldest' | 'best' | 'worst';
}

export const DEFAULT_FILTERS: HistoryFilters = {
  coin: 'all',
  dateRange: '30d',
  sort: 'newest',
};

/** The server takes a window in days. */
export const RANGE_DAYS: Record<HistoryFilters['dateRange'], number | undefined> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  // 'all' must mean MORE, not less. The API defaults to the planner epoch when
  // no window is asked for, so 'all' has to ask explicitly or it would show
  // the least history of any option.
  all: 3650,
};

interface SectionHeadProps {
  eyebrow: string;
  title: string;
  meta: string;
}

function SectionHead({ eyebrow, title, meta }: SectionHeadProps) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-text-tertiary">
          {eyebrow}
        </div>
        <h2 className="font-display text-xl font-semibold tracking-[0.02em] text-text-primary mt-1">
          {title}
        </h2>
      </div>
      <div className="font-mono text-[12px] tracking-[0.04em] text-text-tertiary">{meta}</div>
    </div>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="
        appearance-none bg-transparent
        border border-border/10 dark:border-border hover:border-primary/30
        text-text-primary text-[13px]
        px-4 py-2 pr-8
        rounded-full cursor-pointer
        transition-colors
        bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27currentColor%27%20stroke-width=%271.6%27><polyline%20points=%276%209%2012%2015%2018%209%27/></svg>')]
        bg-no-repeat bg-[right_10px_center] bg-[length:14px]
      "
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface FilterBarProps {
  filters: HistoryFilters;
  onFiltersChange: (filters: HistoryFilters) => void;
  coins: string[];
  /** Every analysis these filters match, not the rows scrolled to so far. */
  totalCount: number;
  loadedCount: number;
}

export function FilterBar({
  filters,
  onFiltersChange,
  coins,
  totalCount,
  loadedCount,
}: FilterBarProps) {
  const updateFilter = <K extends keyof HistoryFilters>(
    key: K,
    value: HistoryFilters[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <section className="mb-4">
      <SectionHead
        eyebrow="Browse"
        title="All analyses"
        meta={`Loaded ${loadedCount} of ${totalCount}`}
      />

      <div className="bg-surface border border-border/10 dark:border-border rounded-lg p-3 md:p-4">
        <div className="flex flex-wrap gap-2.5">
          <FilterSelect
            label="Coin"
            value={filters.coin}
            onChange={(v) => updateFilter('coin', v)}
            options={[
              { value: 'all', label: 'All coins' },
              ...coins.map((c) => ({ value: c, label: c })),
            ]}
          />

          <FilterSelect
            label="Window"
            value={filters.dateRange}
            onChange={(v) => updateFilter('dateRange', v as HistoryFilters['dateRange'])}
            options={[
              { value: '24h', label: 'Last 24 hours' },
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
              { value: 'all', label: 'All time' },
            ]}
          />

          <FilterSelect
            label="Sort"
            value={filters.sort}
            onChange={(v) => updateFilter('sort', v as HistoryFilters['sort'])}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'best', label: 'Best R first' },
              { value: 'worst', label: 'Worst R first' },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
