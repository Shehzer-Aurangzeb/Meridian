'use client';

import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';
import type { PlanResult, TradePlan } from '@/types/analyses';
import { DirectionBadge, OutcomeBadge, StateBadge } from './badges';

function Row({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'good' | 'bad';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-border/10 dark:border-border last:border-0">
      <span className="text-[13px] text-text-secondary shrink-0">{label}</span>
      <span className="text-right min-w-0">
        <span
          className={cn(
            'font-mono text-[13px]',
            accent === 'good' && 'text-sage dark:text-green',
            accent === 'bad' && 'text-rust',
            !accent && 'text-text-primary'
          )}
        >
          {value}
        </span>
        {sub && (
          <span className="block text-[11px] text-text-tertiary mt-0.5 break-words">{sub}</span>
        )}
      </span>
    </div>
  );
}

interface PlanCardProps {
  plan: TradePlan;
  /** Index-aligned with plans — scorePlans maps over them in order. */
  outcome?: PlanResult;
}

export function PlanCard({ plan, outcome }: PlanCardProps) {
  return (
    <article className="bg-surface border border-border/10 dark:border-border rounded-xl overflow-hidden">
      <header className="px-6 py-4 border-b border-border/10 dark:border-border flex flex-wrap items-center gap-2.5">
        <DirectionBadge direction={plan.direction} />
        <StateBadge state={plan.state} />
        {outcome && <OutcomeBadge outcome={outcome.outcome} r={outcome.r} />}
        <span className="ml-auto font-mono text-[11px] text-text-tertiary tracking-[0.04em]">
          {plan.distanceToZonePercent >= 0 ? '+' : ''}
          {plan.distanceToZonePercent.toFixed(2)}% away
        </span>
      </header>

      <div className="px-6 py-4">
        <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-gold-ink mb-1">
          Entries
        </div>
        {plan.entries.map((entry) => (
          <Row
            key={entry.price}
            label={`${entry.weightPercent}% of position`}
            value={formatCurrency(entry.price)}
          />
        ))}
        <Row label="Average entry" value={formatCurrency(plan.averageEntry)} />
      </div>

      <div className="px-6 py-4 border-t border-border/10 dark:border-border">
        <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-gold-ink mb-1">
          Risk
        </div>
        <Row
          label="Stop"
          value={formatCurrency(plan.stop)}
          sub={`${plan.riskPercent.toFixed(2)}% of entry · 1R = ${formatCurrency(plan.riskPerUnit)}`}
          accent="bad"
        />
      </div>

      <div className="px-6 py-4 border-t border-border/10 dark:border-border">
        <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-gold-ink mb-1">
          Targets
        </div>
        {plan.targets.map((target) => (
          <Row
            key={target.price}
            label={`${target.weightPercent}% out · ${target.rMultiple.toFixed(2)}R`}
            value={formatCurrency(target.price)}
            sub={target.source}
            accent="good"
          />
        ))}
      </div>

      <footer className="px-6 py-4 border-t border-border/10 dark:border-border bg-primary/[0.02]">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-[13px] text-text-secondary">
            Blended R
            {/* Two-target plans leave 34% of the ladder unallocated, so this
                number is not comparable between plans. */}
            <span className="block text-[11px] text-text-tertiary">
              Weighted across {plan.targets.length} target
              {plan.targets.length === 1 ? '' : 's'} — not comparable between plans
            </span>
          </span>
          <span className="font-display text-2xl font-semibold text-text-primary">
            {plan.blendedR.toFixed(2)}
            <span className="text-base text-text-secondary">R</span>
          </span>
        </div>
        <p className="text-[13px] text-text-secondary mt-3 pt-3 border-t border-border/10 dark:border-border">
          <span className="text-gold-ink font-medium">Come back when: </span>
          {plan.comeBackWhen}
        </p>
      </footer>
    </article>
  );
}
