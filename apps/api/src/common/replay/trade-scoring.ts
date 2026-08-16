/**
 * Replays one trade plan against the price bars that came after it, and says
 * what happened: did price reach the entry, then what did it hit first.
 *
 * Every part of the project that reports a number calls this — the backtest,
 * the holdout report, the live badge on a saved analysis. One copy on purpose,
 * so a change to how a trade is judged moves every number at once.
 *
 * Results are in "R": one R is what the trade risks, so +2R means it made
 * twice what it stood to lose.
 */
import { Candle } from '../types/candle.types';
import { LadderResult } from './plan-replay';

export interface ScoringConfig {
  /** Bars the entry must be reached within, or the plan is treated as missed. */
  fillBars: number;
  /** Bars the trade gets to finish in. Still open after that = unresolved. */
  maxBars: number;
  /** Move the stop to break-even after this many targets. 0 turns it off. */
  breakevenAfterTarget: number;
  /** Fees plus slippage for opening and closing, as a % of position value. */
  roundTripPct: number;
  /**
   * Distance for a trailing stop, in price. Undefined means no trailing, which
   * is everything except the exit-rule experiments.
   *
   * Only ever tightens, and is applied after the bar's stop check so a bar
   * cannot move its own stop out of the way and then miss it.
   */
  trailDistance?: number;
  /**
   * Optional: close the trade because a fresh analysis no longer supports it.
   *
   * Called with the bar number, after the stop and target checks, so a bar that
   * already finished the trade cannot also trigger this. The caller decides
   * what "no longer supports it" means and how often to check.
   */
  exitSignal?: (barIndex: number) => boolean;
}

/** The parts of a trade plan that scoring reads. */
export interface ScorablePlan {
  direction: 'long' | 'short';
  /**
   * The entry is split into steps at different prices, so the position is
   * built up as price moves into the zone rather than bought all at once.
   * Each step fills on its own; an empty list means one step for the whole
   * position at `averageEntry`.
   */
  entries?: Array<{ price: number; weightPercent: number }>;
  /** The planned average entry. Used to measure R, never as a fill price. */
  averageEntry: number;
  stop: number;
  /** Planned risk per unit: the gap from average entry to stop. This is 1R. */
  riskPerUnit: number;
  riskPercent: number;
  targets: Array<{ price: number; weightPercent: number }>;
}

export type TradeStatus = LadderResult['status'] | 'NO_FILL' | 'SIGNAL_EXIT';

export interface TradeScore {
  filled: boolean;
  /** Which bar the first entry step filled on, or null if none did. */
  fillIndex: number | null;
  barsToFill: number | null;
  /** Average price actually paid, across the steps that filled. */
  entryPrice: number | null;
  legsFilled: number;
  /** How much of the planned position was actually bought: 0.2, 0.6 or 1.0. */
  filledFraction: number;
  status: TradeStatus;
  targetsHit: number;
  /** Result in R before costs, already scaled to the size actually held. */
  grossR: number;
  costR: number;
  netR: number;
  barsHeld: number;
}

const UNFILLED: TradeScore = {
  filled: false,
  fillIndex: null,
  barsToFill: null,
  entryPrice: null,
  legsFilled: 0,
  filledFraction: 0,
  status: 'NO_FILL',
  targetsHit: 0,
  grossR: NaN,
  costR: NaN,
  netR: NaN,
  barsHeld: 0,
};

/**
 * What the round trip costs, measured in R.
 *
 * A plan with a tight stop pays more in R than one with a wide stop, because
 * the same fee is a bigger share of a smaller risk.
 */
export function costOf(riskPercent: number, roundTripPct: number): number {
  return riskPercent === 0 ? 0 : roundTripPct / riskPercent;
}

/**
 * Score one plan against the bars that followed it.
 *
 * `forward[0]` must be the FIRST bar after the one that produced the plan — the
 * bar the plan was built from cannot also be the bar that fills it. Trimming
 * that bar is the caller's job.
 *
 * `forward` should hold at least `fillBars + maxBars` bars. A shorter list is
 * not an error, but the trade is then judged on fewer bars than intended, so
 * callers stop their walk early enough that it never happens.
 */
export function scoreTrade(
  forward: Candle[],
  plan: ScorablePlan,
  config: ScoringConfig,
): TradeScore {
  const long = plan.direction === 'long';

  const legs =
    plan.entries && plan.entries.length > 0
      ? plan.entries
      : [{ price: plan.averageEntry, weightPercent: 100 }];
  const plannedWeight = legs.reduce((a, l) => a + l.weightPercent, 0);

  /** A resting order fills the moment price touches it, wick included. */
  const reached = (price: number, c: Candle): boolean =>
    long ? c.low <= price : c.high >= price;

  const legFilled = legs.map(() => false);
  let filledWeight = 0;
  let weightedPrice = 0;
  /** Steps not yet filled stay live until the stop, first target, or the end. */
  let legsLive = true;

  /** Declared up here because filling a step has to check it. */
  let stop = plan.stop;

  const fillLegsOn = (c: Candle): void => {
    if (!legsLive) return;
    for (let j = 0; j < legs.length; j += 1) {
      if (legFilled[j] || !reached(legs[j].price, c)) continue;
      // A step the stop has already passed can no longer be bought. Never
      // happens on a normal plan, where the stop sits beyond every step. It
      // does happen once a trailing stop has climbed past them.
      if (long ? legs[j].price < stop : legs[j].price > stop) continue;
      legFilled[j] = true;
      filledWeight += legs[j].weightPercent;
      weightedPrice += legs[j].price * legs[j].weightPercent;
    }
  };

  // The trade opens when the first step fills, inside the fill window.
  const fillLimit = Math.min(forward.length, config.fillBars);
  let fillIndex = -1;
  for (let i = 0; i < fillLimit; i += 1) {
    if (legs.some((l, j) => !legFilled[j] && reached(l.price, forward[i]))) {
      fillIndex = i;
      break;
    }
  }
  if (fillIndex < 0) return { ...UNFILLED };

  // Steps fill before the stop and targets are checked. A bar only reaches the
  // stop by trading through every entry step on the way, so for losses this is
  // the only possible order. A bar is never split into moments — the highs and
  // lows of one bar carry no order — so wherever there is a choice this takes
  // the worse reading.
  fillLegsOn(forward[fillIndex]);

  /** Average price actually paid. */
  const entryOf = (): number => weightedPrice / filledWeight;
  /** Share of the planned position actually held. */
  const sizeOf = (): number => filledWeight / plannedWeight;
  /**
   * Result at a given price, per unit of planned size.
   *
   * Measured against the price actually paid, but divided by the PLANNED risk,
   * so 1R means the same thing on a part-filled trade as on a full one.
   */
  const rAt = (price: number, entry: number): number =>
    plan.riskPerUnit === 0
      ? 0
      : (long ? price - entry : entry - price) / plan.riskPerUnit;

  let realizedR = 0;
  /** Share of the position still open. */
  let remaining = 100;
  let targetsHit = 0;
  let stopped = false;
  let signalled = false;
  let barsHeld = 0;
  let lastBar: Candle | null = null;
  /** Best price since the fill. Only used when trailing. */
  let extreme: number | null = null;

  // The clock starts on the bar the trade opened, not the one after: a bar wide
  // enough to reach the entry and then the stop did both. So `maxBars` counts
  // the opening bar — 72 means 72 hours including the hour of entry.
  for (let i = fillIndex; i < forward.length && barsHeld < config.maxBars; i += 1) {
    const c = forward[i];
    barsHeld += 1;
    lastBar = c;

    fillLegsOn(c);
    const entry = entryOf();
    const size = sizeOf();

    if (long ? c.low <= stop : c.high >= stop) {
      realizedR += (remaining / 100) * size * rAt(stop, entry);
      remaining = 0;
      stopped = true;
      legsLive = false;
      break;
    }

    // Targets count from the bar AFTER the opening one, never on it. If price
    // touched the target and the entry in the same bar, there is no way to know
    // it did not hit the target first, before the trade existed. Assume it did.
    while (
      i > fillIndex &&
      targetsHit < plan.targets.length &&
      (long
        ? c.high >= plan.targets[targetsHit].price
        : c.low <= plan.targets[targetsHit].price)
    ) {
      // Never add to a position after taking profit off it.
      legsLive = false;
      const t = plan.targets[targetsHit];
      realizedR += (t.weightPercent / 100) * size * rAt(t.price, entry);
      remaining -= t.weightPercent;
      targetsHit += 1;
      // Break-even means the price actually paid, so the trade can no longer
      // lose money from here.
      if (config.breakevenAfterTarget > 0 && targetsHit === config.breakevenAfterTarget) {
        stop = entry;
      }
    }

    // Trail last, so the stop tested at the top of this bar is the one that
    // stood when the bar opened. Only ever tightens.
    if (config.trailDistance !== undefined) {
      extreme =
        extreme === null
          ? long
            ? Math.max(entry, c.high)
            : Math.min(entry, c.low)
          : long
            ? Math.max(extreme, c.high)
            : Math.min(extreme, c.low);
      const trailed = long
        ? extreme - config.trailDistance
        : extreme + config.trailDistance;
      stop = long ? Math.max(stop, trailed) : Math.min(stop, trailed);
    }

    if (remaining <= 0) break;

    // A fresh analysis no longer supports the trade, so close what is left at
    // this bar's close — that is the only price the decision could have been
    // acted on. Checked last, so a bar that already stopped out or hit a target
    // has finished on its own terms.
    if (config.exitSignal?.(i)) {
      realizedR += (remaining / 100) * size * rAt(c.close, entry);
      remaining = 0;
      signalled = true;
      legsLive = false;
      break;
    }
  }

  // Anything still open at the end is valued at the last close, never assumed
  // to have reached its target.
  if (remaining > 0 && lastBar) {
    realizedR += (remaining / 100) * sizeOf() * rAt(lastBar.close, entryOf());
  }

  const filledFraction = sizeOf();
  // Fees are paid on what was actually bought, not on what was planned.
  const costR = costOf(plan.riskPercent, config.roundTripPct) * filledFraction;

  return {
    filled: true,
    fillIndex,
    barsToFill: fillIndex + 1,
    entryPrice: entryOf(),
    legsFilled: legFilled.filter(Boolean).length,
    filledFraction,
    // SIGNAL_EXIT counts as finished: it was closed deliberately at a price.
    // TIMEOUT did not finish — it ran out of time and was valued where it sat.
    status: stopped
      ? targetsHit > 0
        ? 'PARTIAL'
        : 'STOPPED'
      : signalled
        ? 'SIGNAL_EXIT'
        : remaining <= 0
          ? 'ALL_TARGETS'
          : 'TIMEOUT',
    targetsHit,
    grossR: realizedR,
    costR,
    netR: realizedR - costR,
    barsHeld,
  };
}

/** The only two fields an aggregate reads off a finished trade. */
export interface ScoredRow {
  status: string;
  netR: number;
}

/** Ran out of time with the trade still open, rather than finishing. */
export const isUnresolved = (row: ScoredRow): boolean => row.status === 'TIMEOUT';

/** What one trade contributes to a total: its result after costs, always. */
export function scoreRow(row: ScoredRow): number {
  return row.netR;
}

/**
 * Every headline number the project quotes, computed in one place. Callers
 * build their tables from this and must not re-filter or re-score first.
 */
export interface Aggregate {
  n: number;
  /** Trades still open when time ran out, and what they are valued at. */
  unresolved: number;
  unresolvedMeanR: number;
  wins: number;
  winRate: number;
  avgWin: number;
  avgLose: number;
  payoff: number;
  /** Average result per trade, open ones valued where they sat. */
  expectancy: number;
  totalR: number;
  nResolved: number;
  /** Finished trades only. Open ones are left out, not counted as zero. */
  expectancyResolved: number;
  /**
   * The gap between those two averages: how much of the headline depends on
   * valuing open trades rather than on trades that actually finished. Always
   * reported, because it is what separates a real result from a bookkeeping
   * choice.
   */
  markingGap: number;
}

export function aggregate(rows: ScoredRow[]): Aggregate {
  const mean = (xs: number[]): number =>
    xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

  const v = rows.map(scoreRow);
  // Win or loss is decided by the sign of the result after costs.
  const w = v.filter((x) => x > 0);
  const l = v.filter((x) => x <= 0);

  const open = rows.filter(isUnresolved);
  const resolved = rows.filter((r) => !isUnresolved(r));

  const expectancy = mean(v);
  const expectancyResolved = mean(resolved.map(scoreRow));
  const avgWin = mean(w);
  const avgLose = mean(l);

  return {
    n: rows.length,
    unresolved: open.length,
    unresolvedMeanR: mean(open.map(scoreRow)),
    wins: w.length,
    winRate: rows.length === 0 ? NaN : w.length / rows.length,
    avgWin,
    avgLose,
    payoff: l.length === 0 || avgLose === 0 ? NaN : avgWin / Math.abs(avgLose),
    expectancy,
    totalR: v.reduce((a, b) => a + b, 0),
    nResolved: resolved.length,
    expectancyResolved,
    markingGap:
      Number.isNaN(expectancy) || Number.isNaN(expectancyResolved)
        ? NaN
        : expectancy - expectancyResolved,
  };
}
