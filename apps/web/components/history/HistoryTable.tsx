'use client';

import { cn } from '@/lib/utils';

/**
 * Analysis history entry
 */
export interface HistoryEntry {
  id: string;
  date: string;
  coin: string;
  signal: 'long' | 'short' | 'skip';
  strategy: string;
  timeframe: string;
  confidence: number;
  outcome: 'win' | 'loss' | 'open' | 'no-trade';
  rValue?: number;
  hasNotes: boolean;
}

/**
 * Badge for signal type
 */
function SignalBadge({ signal }: { signal: HistoryEntry['signal'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center text-[10px] font-bold tracking-[0.16em] uppercase px-2.5 py-1 rounded whitespace-nowrap',
        signal === 'long' && 'bg-sage/20 text-deep-green dark:bg-green/20 dark:text-green',
        signal === 'short' && 'bg-rust/15 text-rust',
        signal === 'skip' && 'bg-primary/[0.08] text-text-secondary'
      )}
    >
      {signal === 'skip' ? 'Skip' : signal}
    </span>
  );
}

/**
 * Badge for outcome
 */
function OutcomeBadge({ outcome, rValue }: { outcome: HistoryEntry['outcome']; rValue?: number }) {
  let label = '';
  if (outcome === 'win' && rValue !== undefined) {
    label = `+ ${rValue.toFixed(1)}R`;
  } else if (outcome === 'loss' && rValue !== undefined) {
    label = `− ${Math.abs(rValue).toFixed(1)}R`;
  } else if (outcome === 'open') {
    label = 'Open';
  } else {
    label = 'No trade';
  }

  return (
    <span
      className={cn(
        'inline-flex items-center text-[10px] font-bold tracking-[0.16em] uppercase px-2.5 py-1 rounded whitespace-nowrap',
        outcome === 'win' && 'bg-sage/20 text-deep-green dark:bg-green/20 dark:text-green',
        outcome === 'loss' && 'bg-rust/15 text-rust',
        outcome === 'open' && 'bg-gold/20 text-gold-ink',
        outcome === 'no-trade' && 'bg-primary/[0.08] text-text-secondary'
      )}
    >
      {label}
    </span>
  );
}

/**
 * Note indicator dot
 */
function NoteDot() {
  return (
    <span
      className="inline-block w-[7px] h-[7px] rounded-full bg-gold"
      title="Notes added"
    />
  );
}

/**
 * Mock history data
 */
export const MOCK_HISTORY: HistoryEntry[] = [
  { id: '1', date: '13 May', coin: 'BTC', signal: 'long', strategy: 'Mean-reversion', timeframe: '1D', confidence: 82, outcome: 'open', hasNotes: true },
  { id: '2', date: '12 May', coin: 'ETH', signal: 'long', strategy: 'Trend continuation', timeframe: '4H', confidence: 74, outcome: 'win', rValue: 2.8, hasNotes: false },
  { id: '3', date: '11 May', coin: 'SOL', signal: 'long', strategy: 'Breakout', timeframe: '1D', confidence: 69, outcome: 'loss', rValue: -1.0, hasNotes: true },
  { id: '4', date: '10 May', coin: 'LINK', signal: 'long', strategy: 'Mean-reversion', timeframe: '1D', confidence: 77, outcome: 'win', rValue: 1.6, hasNotes: false },
  { id: '5', date: '09 May', coin: 'AVAX', signal: 'skip', strategy: 'Range fade', timeframe: '4H', confidence: 61, outcome: 'no-trade', hasNotes: false },
  { id: '6', date: '08 May', coin: 'MATIC', signal: 'long', strategy: 'Trend continuation', timeframe: '1D', confidence: 71, outcome: 'open', hasNotes: false },
  { id: '7', date: '07 May', coin: 'BTC', signal: 'short', strategy: 'Range fade', timeframe: '4H', confidence: 66, outcome: 'win', rValue: 0.8, hasNotes: true },
  { id: '8', date: '06 May', coin: 'DOT', signal: 'long', strategy: 'Breakout', timeframe: '1D', confidence: 73, outcome: 'loss', rValue: -1.0, hasNotes: false },
  { id: '9', date: '05 May', coin: 'ETH', signal: 'long', strategy: 'Mean-reversion', timeframe: '1D', confidence: 79, outcome: 'win', rValue: 2.1, hasNotes: false },
  { id: '10', date: '04 May', coin: 'ARB', signal: 'long', strategy: 'Breakout', timeframe: '4H', confidence: 64, outcome: 'loss', rValue: -1.0, hasNotes: false },
  { id: '11', date: '03 May', coin: 'SOL', signal: 'short', strategy: 'Mean-reversion', timeframe: '1D', confidence: 70, outcome: 'win', rValue: 1.4, hasNotes: true },
  { id: '12', date: '02 May', coin: 'BTC', signal: 'long', strategy: 'Trend continuation', timeframe: '1D', confidence: 81, outcome: 'win', rValue: 3.2, hasNotes: false },
];

/**
 * History table with responsive layout
 */
interface HistoryTableProps {
  entries?: HistoryEntry[];
  onRowClick?: (entry: HistoryEntry) => void;
}

export function HistoryTable({ entries = MOCK_HISTORY, onRowClick }: HistoryTableProps) {
  return (
    <div className="bg-surface border border-border/10 dark:border-border rounded-lg overflow-hidden">
      {/* Desktop table */}
      <table className="w-full border-collapse hidden md:table">
        <thead>
          <tr>
            <th className="text-left text-[11px] font-semibold tracking-[0.16em] uppercase text-text-tertiary p-4 pl-5 border-b border-border/10 dark:border-border w-[100px]">
              Date
            </th>
            <th className="text-left text-[11px] font-semibold tracking-[0.16em] uppercase text-text-tertiary p-4 border-b border-border/10 dark:border-border w-[70px]">
              Coin
            </th>
            <th className="text-left text-[11px] font-semibold tracking-[0.16em] uppercase text-text-tertiary p-4 border-b border-border/10 dark:border-border w-[100px]">
              Signal
            </th>
            <th className="text-left text-[11px] font-semibold tracking-[0.16em] uppercase text-text-tertiary p-4 border-b border-border/10 dark:border-border">
              Strategy
            </th>
            <th className="text-right text-[11px] font-semibold tracking-[0.16em] uppercase text-text-tertiary p-4 border-b border-border/10 dark:border-border w-[70px]">
              Conf.
            </th>
            <th className="text-right text-[11px] font-semibold tracking-[0.16em] uppercase text-text-tertiary p-4 border-b border-border/10 dark:border-border w-[110px]">
              Outcome
            </th>
            <th className="text-center text-[11px] font-semibold tracking-[0.16em] uppercase text-text-tertiary p-4 pr-5 border-b border-border/10 dark:border-border w-6">
              &nbsp;
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => (
            <tr
              key={entry.id}
              onClick={() => onRowClick?.(entry)}
              className={cn(
                'cursor-pointer transition-colors hover:bg-primary/[0.025]',
                idx < entries.length - 1 && '[&>td]:border-b [&>td]:border-border/10 dark:[&>td]:border-border'
              )}
            >
              <td className="p-4 pl-5 font-mono text-xs tracking-[0.04em] text-text-tertiary">
                {entry.date}
              </td>
              <td className="p-4">
                <span className="font-display text-[17px] font-semibold tracking-[0.04em] uppercase text-text-primary">
                  {entry.coin}
                </span>
              </td>
              <td className="p-4">
                <SignalBadge signal={entry.signal} />
              </td>
              <td className="p-4 text-sm text-text-secondary">
                {entry.strategy}
                <span className="font-mono text-[11px] text-text-tertiary ml-1.5 tracking-[0.04em]">
                  {entry.timeframe}
                </span>
              </td>
              <td className="p-4 text-right font-mono text-[13px] text-text-primary">
                {entry.confidence}%
              </td>
              <td className="p-4 text-right">
                <OutcomeBadge outcome={entry.outcome} rValue={entry.rValue} />
              </td>
              <td className="p-4 pr-5 text-center">
                {entry.hasNotes && <NoteDot />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile grid layout */}
      <div className="md:hidden">
        {entries.map((entry, idx) => (
          <div
            key={entry.id}
            onClick={() => onRowClick?.(entry)}
            className={cn(
              'grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-2 p-4 cursor-pointer transition-colors hover:bg-primary/[0.025]',
              idx < entries.length - 1 && 'border-b border-border/10 dark:border-border'
            )}
          >
            {/* Row 1: Date | Coin | Signal */}
            <div className="font-mono text-xs tracking-[0.04em] text-text-tertiary">
              {entry.date}
            </div>
            <div className="font-display text-[17px] font-semibold tracking-[0.04em] uppercase text-text-primary">
              {entry.coin}
            </div>
            <div className="text-right">
              <SignalBadge signal={entry.signal} />
            </div>

            {/* Row 2: Strategy spanning full width */}
            <div className="col-span-3 text-sm text-text-secondary">
              {entry.strategy}
              <span className="font-mono text-[11px] text-text-tertiary ml-1.5 tracking-[0.04em]">
                {entry.timeframe}
              </span>
            </div>

            {/* Row 3: Confidence | Outcome */}
            <div className="font-mono text-[13px] text-text-primary">
              {entry.confidence}%
            </div>
            <div className="col-span-2 text-right">
              <OutcomeBadge outcome={entry.outcome} rValue={entry.rValue} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
