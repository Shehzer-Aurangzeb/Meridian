'use client';

import { SearchIcon } from '@/components/ui/Icons';

/**
 * Filter options for the history table
 */
export interface HistoryFilters {
  search: string;
  signal: 'all' | 'long' | 'short' | 'skipped';
  outcome: 'all' | 'win' | 'loss' | 'open';
  dateRange: '30d' | '90d' | '1y' | 'all';
  sort: 'newest' | 'oldest' | 'conf-desc' | 'conf-asc';
}

const DEFAULT_FILTERS: HistoryFilters = {
  search: '',
  signal: 'all',
  outcome: 'all',
  dateRange: '30d',
  sort: 'newest',
};

/**
 * Section header for the filter area
 */
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

/**
 * Custom select dropdown with chevron
 */
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

/**
 * Filter bar with search and dropdowns
 */
interface FilterBarProps {
  filters?: HistoryFilters;
  onFiltersChange?: (filters: HistoryFilters) => void;
  totalCount: number;
  showingCount: number;
}

export function FilterBar({
  filters = DEFAULT_FILTERS,
  onFiltersChange,
  totalCount,
  showingCount,
}: FilterBarProps) {
  const updateFilter = <K extends keyof HistoryFilters>(
    key: K,
    value: HistoryFilters[K]
  ) => {
    onFiltersChange?.({ ...filters, [key]: value });
  };

  return (
    <section className="mb-4">
      <SectionHead
        eyebrow="Browse"
        title="All analyses"
        meta={`Showing ${showingCount} of ${totalCount}`}
      />

      <div className="bg-surface border border-border/10 dark:border-border rounded-lg p-3 md:p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center">
        {/* Search */}
        <div className="flex items-center gap-2.5 px-3.5 py-2 border-b md:border-b-0 md:border-r border-border/10 dark:border-border md:col-span-2 lg:col-span-1">
          <SearchIcon className="w-4 h-4 text-text-tertiary flex-shrink-0" />
          <input
            type="text"
            placeholder="Search coin or strategy…"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="bg-transparent border-0 outline-none w-full text-sm text-text-primary placeholder:text-text-tertiary"
          />
        </div>

        {/* Signal filter */}
        <FilterSelect
          label="Signal"
          value={filters.signal}
          onChange={(v) => updateFilter('signal', v as HistoryFilters['signal'])}
          options={[
            { value: 'all', label: 'All signals' },
            { value: 'long', label: 'Long' },
            { value: 'short', label: 'Short' },
            { value: 'skipped', label: 'Skipped' },
          ]}
        />

        {/* Outcome filter */}
        <FilterSelect
          label="Outcome"
          value={filters.outcome}
          onChange={(v) => updateFilter('outcome', v as HistoryFilters['outcome'])}
          options={[
            { value: 'all', label: 'All outcomes' },
            { value: 'win', label: 'Win' },
            { value: 'loss', label: 'Loss' },
            { value: 'open', label: 'Open' },
          ]}
        />

        {/* Date range filter */}
        <FilterSelect
          label="Date"
          value={filters.dateRange}
          onChange={(v) => updateFilter('dateRange', v as HistoryFilters['dateRange'])}
          options={[
            { value: '30d', label: 'Last 30 days' },
            { value: '90d', label: 'Last 90 days' },
            { value: '1y', label: 'Last year' },
            { value: 'all', label: 'All time' },
          ]}
        />

        {/* Sort */}
        <FilterSelect
          label="Sort"
          value={filters.sort}
          onChange={(v) => updateFilter('sort', v as HistoryFilters['sort'])}
          options={[
            { value: 'newest', label: 'Newest first' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'conf-desc', label: 'Confidence ▼' },
            { value: 'conf-asc', label: 'Confidence ▲' },
          ]}
        />
      </div>
    </section>
  );
}
