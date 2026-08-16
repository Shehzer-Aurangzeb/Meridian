/**
 * One plan, from decision bar to closed trade.
 *
 * Every measurement in this project — the plan backtest, the holdout report,
 * the golden set — used to carry its own copy of these four decisions:
 *
 *   1. how long a plan gets to fill        (`fillBars`)
 *   2. where resolution starts after it    (the `post` slice offset)
 *   3. how the exit ladder is scored       (`scoreLadder`)
 *   4. what the round trip costs in R      (`roundTripPct / riskPercent`)
 *
 * Three copies of four decisions is twelve chances to disagree, and they DID:
 * `backtest-plans.ts` averaged raw `netR` while `holdout.ts` averaged the same
 * rows with unresolved trades zeroed, producing −0.011R and −0.248R from
 * identical data with nothing in either output admitting the other existed.
 *
 * So: one function, three callers, no mirrors. A change here moves every
 * reported number at once, which is the point — the alternative is a fix that
 * lands in the harness and silently misses the report built on it.
 *
 * Nothing here is deliberately bug-compatible any more. `scoreTrade` decides
 * what one trade did; `aggregate` at the bottom decides how a set of them adds
 * up, including what an unresolved position is worth. Both are single copies.
 */
import { Candle } from '../types/candle.types';
import { LadderResult } from './plan-replay';

export interface ScoringConfig {
  /** Bars after the decision bar in which the entry must be reached. */
  fillBars: number;
  /** Bars after the fill in which the trade must resolve, else it is unresolved. */
  maxBars: number;
  /** Targets that must fill before the stop moves to breakeven. 0 disables. */
  breakevenAfterTarget: number;
  /** Round-trip fee + slippage, as a percentage of notional. */
  roundTripPct: number;
  /**
   * Trailing stop distance, in PRICE units. Undefined disables it, which is
   * the default everywhere except the exit-arm sweep.
   *
   * A parameter rather than a second scorer: `exits.ts` used to carry its own
   * `scoreTrailing`, which meant the trailing arm was measured with a different
   * entry model, a different fill rule and a different resolution offset from
   * the trades it was being compared against. One function, one set of
   * assumptions, or the comparison is not a comparison.
   *
   * Ratchets only, and is applied AFTER the bar's stop check, so a bar cannot
   * first lift its own stop out of the way and then fail to hit it.
   */
  trailDistance?: number;
  /**
   * Close the position at this bar's close because the analysis no longer
   * supports it.
   *
   * The one exit rule the tool could actually act on and has never measured.
   * Every other early exit here is a function of PRICE — a tighter stop, a
   * trail — and all of them measured worse: cutting on distance turns winners
   * into losers faster than it saves losers. This is a different question:
   * the coin is re-analysed on a schedule, and the reason for the trade can
   * stop being true while price has done nothing much.
   *
   * Called with the index into `forward`, after the stop and target checks so
   * a bar that resolved cannot also signal. The caller decides what "no longer
   * supports it" means and how often to look — the scorer only knows when it
   * was told to leave.
   */
  exitSignal?: (barIndex: number) => boolean;
}

/** The parts of a `TradePlan` that scoring actually reads. */
export interface ScorablePlan {
  direction: 'long' | 'short';
  /**
   * The entry ladder, in the order price REACHES the legs — which is the order
   * `TradePlanService` already emits: near edge, centre, far edge. For a long
   * that is descending price, for a short ascending. Each leg is checked
   * independently, so a reordered array still fills correctly; the ordering
   * only matters for reading the code.
   *
   * Empty is tolerated and means "one leg at `averageEntry` for the whole
   * position" — the degenerate plan the journal and the older specs describe.
   */
  entries?: Array<{ price: number; weightPercent: number }>;
  /** Planned blended entry. Used ONLY as the R denominator anchor, never as a fill price. */
  averageEntry: number;
  stop: number;
  /** Planned risk per unit: |averageEntry − stop|. The R denominator, always. */
  riskPerUnit: number;
  riskPercent: number;
  targets: Array<{ price: number; weightPercent: number }>;
}

export type TradeStatus = LadderResult['status'] | 'NO_FILL' | 'SIGNAL_EXIT';

export interface TradeScore {
  filled: boolean;
  /** Index into `forward` of the bar the FIRST leg filled on, or null. */
  fillIndex: number | null;
  /** Bars from the decision bar to that first leg — `fillIndex + 1`. */
  barsToFill: number | null;
  /** Weighted mean of the legs that ACTUALLY filled. Not `averageEntry`. */
  entryPrice: number | null;
  /** How many entry legs filled: 1, 2 or 3. */
  legsFilled: number;
  /** Fraction of planned size acquired: 0.2, 0.6 or 1.0 for the standard ladder. */
  filledFraction: number;
  status: TradeStatus;
  targetsHit: number;
  /** Realised R before costs, already scaled by filled size. NaN when unfilled. */
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
 * Cost of the round trip, in R.
 *
 * A plan with a 0.5% stop pays four times what a 2% stop pays, because R is
 * denominated in the stop distance. Fees are proportional to size, so a
 * laddered exit pays the same total as a single one.
 */
export function costOf(riskPercent: number, roundTripPct: number): number {
  return riskPercent === 0 ? 0 : roundTripPct / riskPercent;
}

/**
 * Score one plan against the candles that followed its decision bar.
 *
 * `forward[0]` MUST be the first bar after the decision bar — the bar whose
 * close built the plan cannot also be the bar that fills it, and excluding it
 * is the caller's job so this function never needs the decision index.
 *
 * `forward` should be at least `fillBars + maxBars` long. A shorter array is
 * not an error: it means the series ran out, and the trade is marked to market
 * against whatever was available. That truncation is a real bias at the recent
 * edge of a backtest, and it is fixed where it is caused: `backtest-plans.ts`
 * stops its decision walk `fillBars + maxBars` before the end of the series, so
 * a short `forward` never reaches here. Papering over it here would only hide
 * which trades were affected.
 */
export function scoreTrade(
  forward: Candle[],
  plan: ScorablePlan,
  config: ScoringConfig,
): TradeScore {
  const long = plan.direction === 'long';

  // A leg with no ladder is one leg for the whole position at the blended
  // price — which is what the older single-fill model did for every trade.
  const legs =
    plan.entries && plan.entries.length > 0
      ? plan.entries
      : [{ price: plan.averageEntry, weightPercent: 100 }];
  const plannedWeight = legs.reduce((a, l) => a + l.weightPercent, 0);

  /** A resting limit order fills on a touch, so the wick counts, not the close. */
  const reached = (price: number, c: Candle): boolean =>
    long ? c.low <= price : c.high >= price;

  const legFilled = legs.map(() => false);
  let filledWeight = 0;
  let weightedPrice = 0;
  /** Unfilled legs are live until the stop, the first target, or the hold end. */
  let legsLive = true;

  /**
   * The live stop. Declared here rather than beside the other loop state
   * because `fillLegsOn` has to read it — a resting leg is only reachable while
   * the stop is still beyond it.
   */
  let stop = plan.stop;

  const fillLegsOn = (c: Candle): void => {
    if (!legsLive) return;
    for (let j = 0; j < legs.length; j += 1) {
      if (legFilled[j] || !reached(legs[j].price, c)) continue;
      // A leg the stop has already passed cannot fill. On the base plan this is
      // never true — the stop sits an ATR BEYOND the far leg, so every leg is
      // on the live side of it for the whole trade, and this guard is inert.
      //
      // It is not inert on a TRAILING arm. Once the trail ratchets, the stop
      // climbs past the deeper legs; and a trailing arm has no targets, so
      // `legsLive` is never cleared by a first-target hit and the legs stay
      // resting for the entire hold. Without this, a bar that dips through the
      // trailed stop AND through a deeper leg filled that leg first — at a
      // price the position could no longer be opened at — dragging the realised
      // entry down and making the exit read better than it was.
      //
      // Strict comparison: a leg exactly AT the stop still fills, which is the
      // pre-existing behaviour when ATR is zero and leg 3 coincides with the
      // stop. Filling and stopping on the same tick is defensible; filling
      // beyond it is not.
      if (long ? legs[j].price < stop : legs[j].price > stop) continue;
      legFilled[j] = true;
      filledWeight += legs[j].weightPercent;
      weightedPrice += legs[j].price * legs[j].weightPercent;
    }
  };

  // ── the trade opens when the FIRST leg fills, inside the fill window ──────
  const fillLimit = Math.min(forward.length, config.fillBars);
  let fillIndex = -1;
  for (let i = 0; i < fillLimit; i += 1) {
    if (legs.some((l, j) => !legFilled[j] && reached(l.price, forward[i]))) {
      fillIndex = i;
      break;
    }
  }
  if (fillIndex < 0) return { ...UNFILLED };

  // Legs are filled BEFORE the stop and targets are checked, on every bar
  // including this one. For the stop that is the pessimistic branch and also
  // the only physical one: the stop sits beyond the far edge, so a bar that
  // reaches it necessarily traded through every leg on the way. Against a
  // target it is mildly optimistic — a bar that spans both books the extra
  // size at the better price first. Stated rather than hidden; OHLC carries no
  // intra-bar ordering and something has to be assumed.
  //
  // The hold loop below re-runs this on the same bar and it is idempotent. It
  // stays because the position exists from the touch onward, whether or not the
  // loop ever runs — a `maxBars` of 0 must still report what was bought.
  fillLegsOn(forward[fillIndex]);

  /** Realised entry — the weighted mean of the legs that actually filled. */
  const entryOf = (): number => weightedPrice / filledWeight;
  /** Fraction of PLANNED size held. */
  const sizeOf = (): number => filledWeight / plannedWeight;
  /**
   * R at a price, per unit of planned size.
   *
   * Numerator uses the REALISED entry — that is what was paid. Denominator
   * stays the PLANNED risk, so R means the same thing on a 20%-filled trade as
   * on a full one and as it did before this change. A consequence worth
   * expecting: a 20% fill sits at the near edge, further from the stop than
   * `averageEntry` is, so its per-unit loss exceeds 1.0R. Scaled by size the
   * total is still well under a full stop.
   */
  const rAt = (price: number, entry: number): number =>
    plan.riskPerUnit === 0
      ? 0
      : (long ? price - entry : entry - price) / plan.riskPerUnit;

  let realizedR = 0;
  /** Percent of FILLED size still open. C1 leaves target weights summing to <100. */
  let remaining = 100;
  let targetsHit = 0;
  let stopped = false;
  let signalled = false;
  let barsHeld = 0;
  let lastBar: Candle | null = null;
  /** Best price seen since the fill. Only used when a trail is configured. */
  let extreme: number | null = null;

  // Resolution starts ON the opening bar, not after it. A bar wide enough to
  // reach the entry and then the stop did both — starting at `fillIndex + 1`
  // made that breach invisible and let the trade survive to reach a target it
  // was never alive for. The opening bar resolves the STOP only; see the target
  // block below for why it is held back a bar.
  //
  // `maxBars` is therefore a hold length INCLUSIVE of the fill bar: a trade
  // filling at forward[k] can be open on bars k .. k + maxBars − 1, so 72 means
  // 72 hours of exposure counting the hour you entered, not 73. The other
  // consequence is that a trade filling on the last available bar is marked to
  // market there rather than scoring a flat 0R against no bar at all.
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

    // Targets are live from the bar AFTER the fill, never on the fill bar.
    //
    // Entry-then-stop on one bar is forced: the stop sits an ATR beyond the far
    // leg, so a bar reaching it traded through every entry price first, and
    // there is no other possible order. Entry-then-TARGET on one bar is not
    // forced — if price reached TP1 first and only then came back to the near
    // edge, the trade did not exist yet and the target was not ours to take.
    // OHLC cannot distinguish the two, so this takes the worse reading, exactly
    // as the stop-before-target ordering below already does.
    //
    // Blocking only the breakeven arming would not be enough: registering the
    // hit at all is the unverifiable step, and it also cancels the unfilled
    // legs, shrinking the position on the strength of the same assumption.
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
      // Breakeven is the REALISED entry, not the planned one — the point of
      // the rule is that the trade can no longer hurt, and what it can lose is
      // measured from what was actually paid.
      if (config.breakevenAfterTarget > 0 && targetsHit === config.breakevenAfterTarget) {
        stop = entry;
      }
    }

    // Trail last, so the stop tested at the top of THIS bar was the one that
    // stood when the bar opened. Ratchet only — a trailing stop never loosens.
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

    // The analysis stopped supporting the trade. Exit the rest at this bar's
    // close — the decision is made ON the close that produced the new
    // analysis, so the close is the only price it could have been acted at.
    // Last in the bar, so a bar that stopped out or hit a target has already
    // resolved on its own terms.
    if (config.exitSignal?.(i)) {
      realizedR += (remaining / 100) * size * rAt(c.close, entry);
      remaining = 0;
      signalled = true;
      legsLive = false;
      break;
    }
  }

  // Whatever is still open at the end is marked to market, never assumed to
  // reach its target.
  if (remaining > 0 && lastBar) {
    realizedR += (remaining / 100) * sizeOf() * rAt(lastBar.close, entryOf());
  }

  const filledFraction = sizeOf();
  // Fees are paid on what was actually traded, not on what was planned.
  const costR = costOf(plan.riskPercent, config.roundTripPct) * filledFraction;

  return {
    filled: true,
    fillIndex,
    barsToFill: fillIndex + 1,
    entryPrice: entryOf(),
    legsFilled: legFilled.filter(Boolean).length,
    filledFraction,
    // SIGNAL_EXIT is a RESOLVED outcome, unlike TIMEOUT: the position was
    // closed on purpose at a price, not marked to market because the clock ran
    // out. It is checked before ALL_TARGETS because a signal exit also drives
    // `remaining` to zero.
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

/**
 * A trade that never reached its stop or its last target inside the hold
 * window. It is an OPEN position, not a finished one.
 */
export const isUnresolved = (row: ScoredRow): boolean => row.status === 'TIMEOUT';

/**
 * How one finished trade counts toward an aggregate: at its netR, always.
 *
 * ─── What this used to be ────────────────────────────────────────────────
 * `return row.status === 'TIMEOUT' ? 0 : row.netR`
 *
 * That threw away the unresolved trade's mark-to-market AND the round-trip
 * cost it had actually paid, and then `profile()` binned the resulting zeros
 * into `x <= 0` — counting every unresolved position as a LOSING trade.
 * Meanwhile `backtest-plans.ts` averaged the raw `netR` on the same rows. Two
 * headline expectancies from identical data, −0.0178R and −0.1455R, with
 * neither output admitting the other existed.
 *
 * Marking to market is not a neutral choice either — an open position is worth
 * what it is worth today and no more — so `aggregate` reports the number BOTH
 * ways and states the gap. What is not defensible is booking a position at 0R
 * and then calling it a loss.
 */
export function scoreRow(row: ScoredRow): number {
  return row.netR;
}

/**
 * Every headline statistic this project quotes, computed once.
 *
 * `backtest-plans.ts`, `holdout.ts` and `exits.ts` all build their tables from
 * this. None of them may filter, re-bin or re-score first — that is exactly the
 * divergence this replaces.
 */
export interface Aggregate {
  n: number;
  /** Unresolved positions, and what they are marked at. Never hidden. */
  unresolved: number;
  unresolvedMeanR: number;
  wins: number;
  winRate: number;
  avgWin: number;
  avgLose: number;
  payoff: number;
  /** Every trade, unresolved ones at their mark. The headline. */
  expectancy: number;
  totalR: number;
  nResolved: number;
  /** Resolved trades only. Unresolved are dropped, not zeroed. */
  expectancyResolved: number;
  /**
   * How much of the headline rests on the marking convention. Reported
   * permanently rather than checked once: it is the one number that says
   * whether "we are flat" is a measurement or an accounting choice.
   */
  markingGap: number;
}

export function aggregate(rows: ScoredRow[]): Aggregate {
  const mean = (xs: number[]): number =>
    xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;

  const v = rows.map(scoreRow);
  // Sign of the SCORED R decides win or loss. An unresolved trade marked at
  // +1.1R is not a loss, which is what zeroing made it.
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
