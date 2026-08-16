/**
 * Re-score the golden set with whatever is in `src/` right now, and diff it
 * against the values frozen at CP0.
 *
 *   pnpm golden                       # table + aggregate
 *   pnpm golden -- --verbose          # per-trade geometry too
 *
 * Hermetic: no Binance, no database, no clock. Every input is read from
 * `results/golden-set.json`, so any movement between runs is caused by a code
 * change and nothing else. Run it after every checkpoint.
 *
 * There is no mirror of the harness here. Both this file and
 * `backtest-plans.ts` call `scoreTrade` from
 * `src/common/replay/trade-scoring.ts`, so a checkpoint that changes how a
 * plan fills or resolves changes both at once and cannot report "no change"
 * for a fix that did change something.
 */
import * as fs from 'fs';
import * as path from 'path';

import { TradePlanService, TradePlan } from '../src/analysis/services/trade-plan.service';
import { Candle } from '../src/common/types/candle.types';
import { scoreTrade } from '../src/common/replay/trade-scoring';
import { ConfluenceZone } from '../src/analysis/interfaces/support-resistance.types';

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const SET =
  args.find((a) => a.endsWith('.json')) ?? 'test/manual/results/golden-set.json';

interface Frozen {
  state: string;
  zone: { low: number; high: number; center: number; sources: number };
  entries: Array<{ price: number; weightPercent: number }>;
  averageEntry: number;
  stop: number;
  riskPercent: number;
  riskPerUnit: number;
  targets: Array<{ price: number; weightPercent: number; rMultiple: number }>;
  targetWeightSum: number;
  plannedR: number;
  legsFilled: number;
  filledFraction: number;
  fillPrice: number | null;
  fillTime: string | null;
  barsToFill: number | null;
  status: string;
  targetsHit: number;
  grossR: number;
  costR: number;
  netR: number;
  barsHeld: number;
}

interface GoldenTrade {
  id: string;
  coin: string;
  decisionTime: string;
  direction: 'long' | 'short';
  category: string[];
  input: { spot: number; atr: number; zones: ConfluenceZone[] };
  forward: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  config: { fillBars: number; maxBars: number; breakevenAfterTarget: number; roundTripPct: number };
  frozen: Frozen;
}

interface Scored {
  plan: TradePlan | null;
  fillPrice: number | null;
  fillTime: string | null;
  barsToFill: number | null;
  status: string;
  targetsHit: number;
  grossR: number;
  costR: number;
  netR: number;
  barsHeld: number;
  legsFilled: number;
  /** Fraction of planned size actually acquired: 0.2, 0.6 or 1.0. */
  filledFraction: number;
}

function scoreOne(t: GoldenTrade): Scored {
  const planner = new TradePlanService();
  const candles: Candle[] = t.forward.map((c) => ({ ...c, time: new Date(c.time) }));

  const plans = planner.buildPlans(t.input.zones, t.input.spot, t.input.atr);
  const plan = plans.find((p) => p.direction === t.direction) ?? null;
  if (!plan) {
    return {
      plan: null,
      fillPrice: null,
      fillTime: null,
      barsToFill: null,
      status: 'NO_PLAN',
      targetsHit: 0,
      grossR: NaN,
      costR: NaN,
      netR: NaN,
      barsHeld: 0,
      legsFilled: 0,
      filledFraction: 0,
    };
  }

  const s = scoreTrade(candles, plan, t.config);

  return {
    plan,
    fillPrice: s.entryPrice,
    fillTime: s.fillIndex === null ? null : candles[s.fillIndex].time.toISOString(),
    barsToFill: s.barsToFill,
    status: s.status,
    targetsHit: s.targetsHit,
    grossR: s.grossR,
    costR: s.costR,
    netR: s.netR,
    barsHeld: s.barsHeld,
    legsFilled: s.legsFilled,
    filledFraction: s.filledFraction,
  };
}

const n3 = (x: number | null): string =>
  x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(3);
const delta = (now: number, was: number): string => {
  if (Number.isNaN(now) || Number.isNaN(was)) return '—';
  const d = now - was;
  return Math.abs(d) < 1e-9 ? '·' : `${d >= 0 ? '+' : ''}${d.toFixed(3)}`;
};

function main(): void {
  const file = path.resolve(SET);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    builtAt: string;
    candidatePopulation: number;
    trades: GoldenTrade[];
  };

  console.log(`\nGOLDEN SET — ${doc.trades.length} trades, frozen ${doc.builtAt.slice(0, 16)}`);
  console.log(`source ${SET}\n`);

  const rows: Array<Record<string, string | number>> = [];
  let movedStatus = 0;
  let movedR = 0;
  let sumWas = 0;
  let sumNow = 0;
  const statusNow: Record<string, number> = {};
  const statusWas: Record<string, number> = {};

  for (const t of doc.trades) {
    const now = scoreOne(t);
    const was = t.frozen;

    statusWas[was.status] = (statusWas[was.status] ?? 0) + 1;
    statusNow[now.status] = (statusNow[now.status] ?? 0) + 1;

    const nowNet = Number.isNaN(now.netR) ? 0 : now.netR;
    sumWas += was.netR;
    sumNow += nowNet;
    if (now.status !== was.status) movedStatus += 1;
    if (Math.abs(nowNet - was.netR) > 1e-9) movedR += 1;

    rows.push({
      trade: `${t.coin} ${t.decisionTime.slice(5, 16)} ${t.direction.slice(0, 1)}`,
      'wt%': was.targetWeightSum,
      'status was': was.status,
      'status now': now.status,
      'netR was': n3(was.netR),
      'netR now': n3(now.netR),
      Δ: delta(nowNet, was.netR),
      tgts: was.targets.length,
      'hit was': was.targetsHit,
      'hit now': now.targetsHit,
      legs: now.legsFilled,
      'size%': (now.filledFraction * 100).toFixed(0),
    });

    if (VERBOSE && now.plan) {
      console.log(
        `  ${t.id}\n` +
          `    legs      ${now.plan.entries.map((e) => `${e.weightPercent}%@${e.price.toFixed(6)}`).join('  ')}\n` +
          `    avgEntry  ${now.plan.averageEntry.toFixed(6)}  stop ${now.plan.stop.toFixed(6)}  risk/unit ${now.plan.riskPerUnit.toFixed(6)}\n` +
          `    targets   ${now.plan.targets.map((x) => `${x.weightPercent}%@${x.price.toFixed(6)}`).join('  ') || '(none)'}\n` +
          `    plannedR  was ${was.plannedR.toFixed(3)}  now ${now.plan.blendedR.toFixed(3)}\n`,
      );
    }
  }

  console.table(rows);

  console.log(`status distribution`);
  const keys = [...new Set([...Object.keys(statusWas), ...Object.keys(statusNow)])].sort();
  console.table(
    keys.map((k) => ({ status: k, was: statusWas[k] ?? 0, now: statusNow[k] ?? 0 })),
  );

  console.log(
    `\nmean netR   was ${(sumWas / doc.trades.length).toFixed(4)}   now ${(sumNow / doc.trades.length).toFixed(4)}   ` +
      `Δ ${delta(sumNow / doc.trades.length, sumWas / doc.trades.length)}`,
  );
  console.log(
    `total netR  was ${sumWas.toFixed(3)}   now ${sumNow.toFixed(3)}   Δ ${delta(sumNow, sumWas)}`,
  );
  console.log(`trades with a changed status: ${movedStatus}/${doc.trades.length}`);
  console.log(`trades with a changed netR:   ${movedR}/${doc.trades.length}\n`);
}

main();
