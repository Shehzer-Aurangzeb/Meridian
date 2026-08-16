import { cn } from '@/lib/utils';
import type { Freshness, PlanOutcome, ZoneState } from '@/types/analyses';

const BADGE =
  'inline-flex items-center text-[10px] font-bold tracking-[0.16em] uppercase px-2.5 py-1 rounded whitespace-nowrap';

const GOOD = 'bg-sage/20 text-deep-green dark:bg-green/20 dark:text-green';
const BAD = 'bg-rust/15 text-rust';
const WARN = 'bg-gold/20 text-gold-ink';
const MUTED = 'bg-primary/[0.08] text-text-secondary';

/** What each verdict means, on the badge itself — these are not obvious words. */
const FRESHNESS: Record<Freshness, { style: string; label: string; title: string }> = {
  LIVE: { style: GOOD, label: 'Live', title: 'The plans can still be taken' },
  INVALIDATED: {
    style: BAD,
    label: 'Invalidated',
    title: 'Price went through the level every plan said it would not',
  },
  SUPERSEDED: {
    style: MUTED,
    label: 'Superseded',
    title: 'A newer analysis found different structure — these zones are gone',
  },
};

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const { style, label, title } = FRESHNESS[freshness];
  return (
    <span className={cn(BADGE, style)} title={title}>
      {label}
    </span>
  );
}

const OUTCOME: Record<PlanOutcome, { style: string; label: string; title: string }> = {
  PENDING: { style: MUTED, label: 'Pending', title: 'Price has not reached the entry yet' },
  MISSED: { style: MUTED, label: 'Missed', title: 'Never filled within 24h of the analysis' },
  OPEN: { style: WARN, label: 'Open', title: 'Filled and still running, marked to market' },
  STOPPED: { style: BAD, label: 'Stopped', title: 'Price hit the stop' },
  PARTIAL: { style: GOOD, label: 'Partial', title: 'Some targets hit, the rest still open' },
  ALL_TARGETS: { style: GOOD, label: 'All targets', title: 'Every target was reached' },
  EXPIRED: {
    style: MUTED,
    label: 'Expired',
    title: 'Filled but never resolved — closed at the mark after 72h',
  },
  UNSCOREABLE: {
    style: MUTED,
    label: 'Not scored',
    title: 'The price history needed to score this could not be loaded',
  },
};

export function OutcomeBadge({ outcome, r }: { outcome: PlanOutcome; r: number | null }) {
  // Fall back rather than throw: a badge the API adds before the web knows it
  // should read as unknown, not take the page down.
  const { style, label, title } = OUTCOME[outcome] ?? {
    style: MUTED,
    label: outcome,
    title: '',
  };
  return (
    <span className={cn(BADGE, style)} title={title}>
      {label}
      {r !== null && (
        <span className="ml-1.5 font-mono tracking-normal">
          {r >= 0 ? '+' : '−'}
          {Math.abs(r).toFixed(2)}R
        </span>
      )}
    </span>
  );
}

const STATE: Record<ZoneState, { style: string; title: string }> = {
  ACTIONABLE: { style: GOOD, title: 'Price is at the zone now' },
  APPROACHING: { style: WARN, title: 'Price is near the zone' },
  FAR: { style: MUTED, title: 'Price is nowhere near this zone' },
};

export function StateBadge({ state }: { state: ZoneState }) {
  return (
    <span className={cn(BADGE, STATE[state].style)} title={STATE[state].title}>
      {state.toLowerCase()}
    </span>
  );
}

export function DirectionBadge({ direction }: { direction: 'long' | 'short' }) {
  return (
    <span className={cn(BADGE, direction === 'long' ? GOOD : BAD)}>{direction}</span>
  );
}
