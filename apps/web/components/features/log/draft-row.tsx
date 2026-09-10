'use client';

import { cn } from '@/lib/utils';
import { promptFor } from '@/lib/sim-prompt';
import type { Draft, DraftTarget } from '@/lib/hooks/use-batch';
import type { MarketMap } from '@/types/map';
import { CopyButton } from './copy-button';

const STATE_WORD: Record<string, string> = {
  COMPRESSION: 'Quiet',
  TRENDING: 'Moving one way',
  MEAN_REVERSION: 'Drifting sideways',
};

const asMoney = (x: number): string =>
  x.toLocaleString('en-US', { maximumFractionDigits: x > 100 ? 0 : 4 });

/** How far a typed price sits from the price on screen, so a typo is visible. */
function distance(value: string, spot: number): string | null {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n) || n <= 0) return null;
  const pct = ((n - spot) / spot) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function Field({
  label,
  value,
  onChange,
  hint,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string | null;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'mt-1 w-full rounded-sm border bg-background px-2.5 py-1.5 font-mono text-[13px] text-text-primary outline-none',
          invalid ? 'border-amber' : 'border-border/60 focus:border-gold/60',
        )}
      />
      {hint ? (
        <span className="mt-0.5 block font-mono text-[11px] text-text-tertiary">{hint}</span>
      ) : null}
    </label>
  );
}

interface DraftRowProps {
  draft: Draft;
  map: MarketMap | undefined;
  onChange: (patch: Partial<Draft>) => void;
}

export function DraftRow({ draft, map, onChange }: DraftRowProps) {
  const spot = map?.spot ?? 0;

  const setTarget = (i: number, patch: Partial<DraftTarget>) => {
    onChange({ targets: draft.targets.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  };

  const weightTotal = draft.targets.reduce((a, t) => a + (Number(t.weightPercent) || 0), 0);
  const weightsWrong = draft.targets.length > 0 && Math.abs(weightTotal - 100) > 0.01;

  const entry = Number(draft.entry);
  const stop = Number(draft.stop);
  const stopWrongSide =
    Number.isFinite(entry) &&
    Number.isFinite(stop) &&
    entry > 0 &&
    stop > 0 &&
    (draft.direction === 'long' ? stop > entry : stop < entry);

  return (
    <section className="rounded border border-border/40 bg-surface p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-antonio text-[20px] font-semibold uppercase tracking-headline text-text-primary">
            {draft.symbol}
          </h2>
          {map ? (
            <span className="font-mono text-[13px] text-text-secondary">{asMoney(map.spot)}</span>
          ) : null}
          {map?.regime ? (
            <span className="text-[13px] text-text-tertiary">
              {STATE_WORD[map.regime.state] ?? map.regime.state} · {map.regime.ageHours}h
            </span>
          ) : null}
        </div>
        {map ? (
          <CopyButton text={() => promptFor(map)} label={`Copy ${draft.symbol}`} />
        ) : null}
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        {(['TAKE', 'SKIP'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange({ verdict: v })}
            aria-current={draft.verdict === v ? 'true' : undefined}
            className={cn(
              'rounded-sm px-3 py-1.5 font-mono text-[13px]',
              draft.verdict === v
                ? 'bg-gold text-gold-contrast'
                : 'border border-border/60 text-text-secondary hover:text-text-primary',
            )}
          >
            {v === 'TAKE' ? 'Would take' : 'Would pass'}
          </button>
        ))}
        <span className="w-4" />
        {(['long', 'short'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onChange({ direction: d })}
            aria-current={draft.direction === d ? 'true' : undefined}
            className={cn(
              'rounded-sm px-3 py-1.5 font-mono text-[13px]',
              draft.direction === d
                ? 'bg-gold text-gold-contrast'
                : 'border border-border/60 text-text-secondary hover:text-text-primary',
            )}
          >
            {d}
          </button>
        ))}
      </div>

      {draft.planDespiteSkip ? (
        <p className="mt-3 text-[12px] leading-relaxed text-text-tertiary">
          The analyst marked this one a pass and still wrote out the plan. Both are kept:
          the plan below is what it would have placed, and the verdict stays as it was
          given, because the record compares the calls taken against the calls passed on.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Field
          label="Entry"
          value={draft.entry}
          onChange={(entry) => onChange({ entry })}
          hint={distance(draft.entry, spot)}
        />
        <Field
          label="Stop"
          value={draft.stop}
          onChange={(stop) => onChange({ stop })}
          hint={stopWrongSide ? 'wrong side of the entry' : distance(draft.stop, spot)}
          invalid={stopWrongSide}
        />
        {draft.targets.map((t, i) => (
          <Field
            key={i}
            label={draft.targets.length > 1 ? `Target ${i + 1}` : 'Target'}
            value={t.price}
            onChange={(price) => setTarget(i, { price })}
            hint={distance(t.price, spot)}
          />
        ))}
        {draft.targets.length > 1 ? (
          <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
            {draft.targets.map((t, i) => (
              <Field
                key={i}
                label={`Weight ${i + 1} %`}
                value={t.weightPercent}
                onChange={(weightPercent) => setTarget(i, { weightPercent })}
                invalid={weightsWrong}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() =>
            onChange({ targets: [...draft.targets, { price: '', weightPercent: '' }] })
          }
          className="font-mono text-[12px] text-text-tertiary hover:text-text-primary"
        >
          + another target
        </button>
        {draft.targets.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => onChange({ targets: draft.targets.slice(0, -1) })}
              className="font-mono text-[12px] text-text-tertiary hover:text-text-primary"
            >
              − remove last
            </button>
            <span
              className={cn(
                'font-mono text-[12px]',
                weightsWrong ? 'text-amber' : 'text-text-tertiary',
              )}
            >
              weights {weightTotal}% {weightsWrong ? '(must total 100)' : ''}
            </span>
          </>
        ) : null}
        <label className="flex items-center gap-2 text-[12px] text-text-tertiary">
          <input
            type="checkbox"
            checked={draft.usedOutsideData}
            onChange={(e) => onChange({ usedOutsideData: e.target.checked })}
          />
          looked things up beyond this map
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
          What the analyst said
        </span>
        <textarea
          rows={2}
          value={draft.rationale}
          onChange={(e) => onChange({ rationale: e.target.value })}
          className="mt-1 w-full rounded-sm border border-border/60 bg-background px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-gold/60"
        />
      </label>
    </section>
  );
}
