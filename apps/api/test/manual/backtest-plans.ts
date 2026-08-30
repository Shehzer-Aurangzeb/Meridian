/**
 * Plan backtest — replays what `pnpm analyze` ACTUALLY PRINTS.
 *
 *   pnpm backtest:plans BTC
 *   pnpm backtest:plans --coins BTC,ETH,SOL --bars 1200
 *   pnpm backtest:plans BTC --states ACTIONABLE,APPROACHING --random
 *
 * ─── Why this exists next to backtest.ts rather than inside it ────────────
 * backtest.ts scores the 5-condition CHECKLIST with an ATR-derived stop and a
 * fixed R target. The analysis path no longer emits that: `analyze` prints a
 * confluence zone, a three-step entry ladder, a stop one ATR beyond the zone,
 * and targets at the next zones. Those are different trades with different
 * geometry, so a number from backtest.ts says nothing about the tool as it
 * stands. This harness rebuilds the level map as of each historical bar and
 * scores the plan the tool would have printed then.
 *
 * ─── What is measured ────────────────────────────────────────────────────
 * For every 1h bar, the map is rebuilt from ONLY completed candles as of that
 * bar (12h/4h/1h at their live CANDLE_LIMITS), plans are built for both
 * directions, and any plan in an eligible distance state is taken if price
 * subsequently reaches its average entry. Exits follow the printed ladder.
 *
 * ─── Modelling choices, all conservative, all load-bearing ───────────────
 *  1. No look-ahead: `completedAsOf` requires open + duration <= the decision
 *     bar's close. A forming 12h candle already contains the future. Asserted
 *     in plan-replay.spec.ts and again at runtime on EVERY decision bar.
 *  1b. No right-edge truncation: the walk stops --fill-bars + --max-bars before
 *     the end of the series, so every trade in the output had a full window to
 *     resolve. Without it, trades near the recent edge were cut short, marked
 *     to market early, and then counted at full weight beside trades that ran
 *     their course.
 *  2. Fill is LEG BY LEG. The plan is a 20/40/40 ladder, and each leg fills
 *     when price touches its own price. The trade opens when the FIRST leg
 *     fills (within --fill-bars); remaining legs rest until the stop, the
 *     first target, or the hold end cancels them. R and cost scale by the
 *     size actually acquired, against the PLANNED risk denominator, so R
 *     means the same thing on a 20%-filled trade as on a full one.
 *
 *     This replaced a single fill of 100% of size at the blended average —
 *     which required price 60% of the way into the zone before it counted as
 *     a trade, then booked the whole position at a price only part of it
 *     could have got. Worth ~0.077R per trade, in our favour.
 *  3. Stop before target inside a bar; breakeven after TP1; open weight marked
 *     to market at the window end (see scoreTrade). Resolution starts ON the
 *     opening bar: a bar that reaches the entry and then the stop is a loss,
 *     not a survival.
 *  4. Cost = round-trip % / risk % — charged in R per closed trade, so a plan
 *     with a 0.5% stop pays four times what a 2% stop pays. Fees are
 *     proportional to size, so a laddered exit pays the same total as one.
 *  5. One position at a time PER DIRECTION, plus --cooldown bars after a close.
 *     A zone stays eligible for many consecutive bars; without this, one zone
 *     becomes twenty near-identical trades and n is fiction.
 *  6. --random replaces the distance-state trigger with entries at random
 *     bars, matched in count, same geometry, same costs. Crypto trended hard
 *     over any window; only the delta against this is edge.
 *
 * Every result must be quoted with the config line this prints. A number whose
 * configuration is lost is not a result (docs/STATE_OF_PLAY.md §14c).
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { BinanceService } from '../../src/market-data/market-data.service';
import { CacheTelemetryService } from '../../src/market-data/cache-telemetry.service';
import { IndicatorsService } from '../../src/indicators/indicators.service';
import { SupportResistanceService } from '../../src/analysis/services/support-resistance.service';
import {
  ATR_TIMEFRAME,
  LevelMap,
  LevelMapService,
  LEVEL_TIMEFRAMES,
} from '../../src/analysis/services/level-map.service';
import { TradePlanService, TradePlan, ZoneState } from '../../src/analysis/services/trade-plan.service';
import { MarketRegimeService } from '../../src/market-regime/market-regime.service';
import { SqueezeBreakoutService } from '../../src/squeeze-breakout/squeeze-breakout.service';
import { ChecklistService } from '../../src/analysis/services/checklist.service';
import {
  AnalysisCoordinatorService,
  ANALYSIS_CANDLE_LIMIT,
} from '../../src/analysis-coordinator/analysis-coordinator.service';
import { EntryChecklistResult } from '../../src/analysis/interfaces/checklist.types';
import { ANALYSIS_TIMEFRAME, CANDLE_LIMITS, Timeframe } from '../../src/common/constants/timeframes';
import { Candle, TimeInterval } from '../../src/common/types/candle.types';
import { completedAsOf, TIMEFRAME_MS } from '../../src/common/replay/plan-replay';
import { aggregate, ScoringConfig, scoreTrade } from '../../src/common/replay/trade-scoring';
import { ARMS, MAX_ARM_BARS, scoreArm } from './exits';
import { makeRng } from './rng';

// Per-bar map builds log three lines each at debug level. 1000 bars of that
// buries the result.
Logger.overrideLogger(false);

const store = new Map<string, unknown>();
const cache = {
  get: (k: string) => Promise.resolve(store.get(k)),
  set: (k: string, v: unknown) => Promise.resolve(store.set(k, v)),
  del: (k: string) => Promise.resolve(store.delete(k)),
} as unknown as Cache;

// ── args ────────────────────────────────────────────────────────────────
// Flags are searched across the WHOLE argument list, and the leading symbol is
// only a symbol if it is not a flag. Splitting positional from flags first and
// then searching the tail is how `--coins BTC,ETH` becomes a request for the
// symbol "--COINS".
const args = process.argv.slice(2);
const coinArg = args[0]?.startsWith('--') ? undefined : args[0];
const num = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const str = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const COINS = str('coins', coinArg ?? 'BTC')
  .split(',')
  .map((c) => c.trim().toUpperCase());
const BARS = num('bars', 600); // 1h decision bars to walk
const STEP = num('step', 1); // walk every Nth bar
const FILL_BARS = num('fill-bars', 24); // give up if the zone is not reached
const MAX_BARS = num('max-bars', 72); // give up on an open position
/**
 * How often an open position is re-analysed by the E_ arms.
 *
 * 8, because production runs the coordinator three times a day. Checking every
 * bar would measure a rule the deployed tool cannot run, and would make the arm
 * look better or worse for a reason that has nothing to do with the idea.
 */
const RESIGNAL_BARS = num('resignal-bars', 8);
const COOLDOWN = num('cooldown', 24); // bars after a close before re-entering
// Measured at the venue, not a fee plus a guess. --round-trip cost-stresses it.
const ROUND_TRIP_PCT = num('round-trip', 0.25);
// 1 = playbook (stop to breakeven after TP1), 0 = never move the stop.
const BREAKEVEN = num('breakeven', 1);
const STATES = str('states', 'ACTIONABLE')
  .split(',')
  .map((s) => s.trim().toUpperCase()) as ZoneState[];
const RANDOM = args.includes('--random');
const SEED = num('seed', 12345);
const CSV = str('csv', '');
// Score every exit arm against the same filled trade. Adds columns, changes
// nothing about entries or about the default run.
const EXIT_ARMS = args.includes('--exit-arms');
// Per-BAR log of level proximity and the next hour's move. Read-only extra
// output for the touch-volatility study; does not affect any trade.
const TOUCH_LOG = str('touch-log', '');
/**
 * Which charts the level map is built from. Defaults to whatever production
 * uses; `--charts 12h,4h,1h` runs the old three so the two can be compared with
 * every other setting identical.
 *
 * Order is preserved and must stay slowest-first: `buildFrom` reads spot off
 * the last entry.
 */
const CHARTS: Timeframe[] = LEVEL_TIMEFRAMES.filter((tf) =>
  str('charts', LEVEL_TIMEFRAMES.join(','))
    .split(',')
    .map((c) => c.trim())
    .includes(tf),
);
if (CHARTS.length === 0) throw new Error('--charts matched none of LEVEL_TIMEFRAMES');
// The walk steps on 1h bars and the stop is priced off ATR_TIMEFRAME. Drop
// either and the run does not fail — it produces an empty h1 or a NaN ATR and
// then believable-looking numbers. Fail loudly instead.
if (!CHARTS.includes('1h')) throw new Error('--charts must include 1h: the walk steps on 1h bars');
if (!CHARTS.includes(ATR_TIMEFRAME)) {
  throw new Error(`--charts must include ${ATR_TIMEFRAME}: the stop is priced off its ATR`);
}

/**
 * The longest hold in play. Without --exit-arms that is just --max-bars; with
 * them it is whichever arm holds longest, because the right-edge reserve has to
 * cover every scorer that reads forward from a decision bar.
 *
 * Enabling --exit-arms therefore SHORTENS the walk, and the base trade set with
 * it. Stated rather than hidden: a base number quoted from an --exit-arms run
 * is not the same measurement as one from a plain run.
 */
const ARM_HOLD_BARS = EXIT_ARMS ? Math.max(MAX_BARS, MAX_ARM_BARS) : MAX_BARS;

/** The scoring decisions, in one object, shared with holdout and the golden set. */
const SCORING: ScoringConfig = {
  fillBars: FILL_BARS,
  maxBars: MAX_BARS,
  breakevenAfterTarget: BREAKEVEN,
  roundTripPct: ROUND_TRIP_PCT,
};

const CONFIG =
  `coins=${COINS.join('/')} bars=${BARS} step=${STEP} states=${STATES.join('+')} ` +
  `fill-bars=${FILL_BARS} max-bars=${MAX_BARS} cooldown=${COOLDOWN} ` +
  `round-trip=${ROUND_TRIP_PCT}% breakeven-after=${BREAKEVEN} charts=${CHARTS.join('/')}` +
  `${RANDOM ? ` random-control seed=${SEED}` : ''}`;

/**
 * The higher-timeframe structure at the decision bar.
 *
 * Replicated from `AnalysisCoordinatorService.buildChecklistInputs` rather
 * than imported, because that method is private and this file must not reach
 * into `src/` to change it. The rule is copied verbatim — S/R midpoint plus a
 * 20-candle pivot comparison — and fed the SAME 12h series the live path uses
 * (`ANALYSIS_TIMEFRAME`), so the label means the same thing here as there.
 *
 * ponytail: a copy, and copies drift. It exists only to make the direction-
 * gating arms measurable; if gating ever ships, this moves into `src/` as one
 * exported pure function and both callers read it from there.
 */
function inferStructure(
  indicators: IndicatorsService,
  candles: Candle[],
): 'HH/HL' | 'LH/LL' | 'ranging' | 'unknown' {
  if (candles.length === 0) return 'unknown';
  const { support, resistance } = indicators.identifySupportResistance(candles);
  if (support === null || resistance === null) return 'unknown';

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const price = closes[closes.length - 1];
  const mid = (support + resistance) / 2;
  const last = highs.length - 1;
  const pivot = Math.max(0, last - 20);

  if (price > mid && highs[last] > highs[pivot]) return 'HH/HL';
  if (price < mid && lows[last] < lows[pivot]) return 'LH/LL';
  return 'ranging';
}

interface Trade {
  coin: string;
  tier: 'PLAN' | 'RANDOM';
  direction: 'long' | 'short';
  /** HTF structure when the plan was printed — the gating arms filter on this. */
  structure: 'HH/HL' | 'LH/LL' | 'ranging' | 'unknown';
  /** Regime and route, now that the harness runs the coordinator leg too. */
  regime: string;
  route: string;
  /**
   * The checklist for THIS leg's direction — null on the squeeze route, which
   * runs none. Scored per direction, which is the fix under test: a single
   * trend-derived verdict made `rsi` and `bollingerBand` unsatisfiable.
   */
  conditionsMet: number | null;
  cRsi: boolean | null;
  cQqe: boolean | null;
  cBollinger: boolean | null;
  cStructure: boolean | null;
  cSupportResistance: boolean | null;
  /**
   * The NUMBERS the conditions above were derived from, at the decision bar.
   *
   * Recorded because a boolean cannot distinguish "this indicator carries no
   * information" from "this threshold is in the wrong place" — and the
   * winner/loser split found four of the five conditions pointing backwards
   * without being able to say which of those two it was.
   *
   * Read from the same `context` the checklist reads, so these are the exact
   * inputs to the verdicts beside them. Nothing new is computed. Unlike the
   * booleans, they are populated on EVERY trade, including the squeeze route
   * that runs no checklist.
   */
  rsiValue: number | null;
  adxValue: number | null;
  pdiValue: number | null;
  mdiValue: number | null;
  percentBValue: number | null;
  /** QQE's discrete state (green/red/neutral)… */
  qqeState: string | null;
  /** …and the smoothed-RSI number under it, which the state alone discards. */
  qqeValue: number | null;
  /** Named `time` and `r` (gross) so bootstrap.ts reads this CSV unmodified. */
  time: Date;
  state: ZoneState;
  sources: number;
  entry: number;
  /** How many exit targets the zone map offered this plan (0-3). */
  targets: number;
  /** How many entry legs filled (1-3), and what fraction of planned size that is. */
  legsFilled: number;
  filledFraction: number;
  stop: number;
  riskPercent: number;
  plannedR: number;
  r: number;
  costR: number;
  netR: number;
  status: string;
  targetsHit: number;
  barsToFill: number;
  barsHeld: number;
}

/** Everything about one bar's decision, kept so the control can reuse it. */
interface Signal {
  index: number;
  plan: TradePlan;
  structure: Trade['structure'];
  context: BarContext;
}

/** Everything the coordinator leg produced at one decision bar. */
interface BarContext {
  regime: string;
  route: string;
  structure: Trade['structure'];
  checklist: Partial<Record<'long' | 'short', EntryChecklistResult>>;
  /** Raw indicator readings at this bar — see the Trade fields of the same name. */
  raw: Pick<
    Trade,
    | 'rsiValue'
    | 'adxValue'
    | 'pdiValue'
    | 'mdiValue'
    | 'percentBValue'
    | 'qqeState'
    | 'qqeValue'
  >;
}

function tryTrade(
  coin: string,
  tier: Trade['tier'],
  h1: Candle[],
  index: number,
  plan: TradePlan,
  ctx: BarContext,
  /** The re-analysis exit signals for this trade, one per reading. */
  resignals: Parameters<typeof scoreArm>[4],
): Trade | null {
  // This leg's OWN checklist, never the other side's.
  const cl = ctx.checklist[plan.direction];

  // Fill scan starts at index+1: the bar whose close built the plan cannot
  // also be the bar that fills it. Everything from there — the fill window,
  // the resolution window, the ladder and the cost — belongs to `scoreTrade`,
  // which the holdout report and the golden set call too.
  const forward = h1.slice(index + 1, index + 1 + FILL_BARS + MAX_BARS);
  const scored = scoreTrade(forward, plan, SCORING);
  if (!scored.filled) return null;

  // Every exit arm scored against THIS SAME decision bar. Running them as
  // separate backtests would give each its own barsHeld, hence its own
  // cooldown, hence a different set of later entries — and the comparison
  // would quietly be about entries again. The entry set stays the base arm's.
  //
  // The arms get the SAME slice the base trade got, only longer: `scoreArm`
  // calls `scoreTrade`, so it re-derives the fill leg by leg exactly as above
  // and lands on the same `fillIndex`. It used to be handed `h1` from
  // `fillIdx + 1` with a full-size entry at `averageEntry` assumed — its own
  // model, three checkpoints stale.
  const arms: Record<string, number | string> = {};
  if (EXIT_ARMS) {
    const armForward = h1.slice(index + 1, index + 1 + FILL_BARS + ARM_HOLD_BARS);
    for (const spec of ARMS) {
      const s = scoreArm(armForward, plan, spec, SCORING, resignals);
      arms[`${spec.name}_r`] = s.grossR;
      arms[`${spec.name}_costR`] = s.costR;
      arms[`${spec.name}_netR`] = s.netR;
      arms[`${spec.name}_status`] = s.status;
      arms[`${spec.name}_barsHeld`] = s.barsHeld;
    }
  }

  return {
    coin,
    tier,
    direction: plan.direction,
    structure: ctx.structure,
    regime: ctx.regime,
    route: ctx.route,
    conditionsMet: cl?.conditionsMet ?? null,
    cRsi: cl?.rsi.passed ?? null,
    cQqe: cl?.qqe.passed ?? null,
    cBollinger: cl?.bollingerBand.passed ?? null,
    cStructure: cl?.marketStructure.passed ?? null,
    cSupportResistance: cl?.supportResistance.passed ?? null,
    ...ctx.raw,
    time: h1[index].time,
    state: plan.state,
    sources: plan.zone.sources.length,
    entry: scored.entryPrice as number,
    targets: plan.targets.length,
    legsFilled: scored.legsFilled,
    filledFraction: scored.filledFraction,
    stop: plan.stop,
    riskPercent: plan.riskPercent,
    plannedR: plan.blendedR,
    r: scored.grossR,
    costR: scored.costR,
    netR: scored.netR,
    status: scored.status,
    targetsHit: scored.targetsHit,
    barsToFill: scored.barsToFill as number,
    barsHeld: scored.barsHeld,
    ...arms,
  };
}

async function runCoin(coin: string): Promise<{
  trades: Trade[];
  bars: number;
  eligible: number;
  noFill: number;
  window: [Date, Date];
  structureChecks: number;
  structureMismatches: number;
  touches: Array<Record<string, string | number>>;
  marksByChart: Map<Timeframe, number>;
}> {
  const binance = new BinanceService(cache, new CacheTelemetryService());
  const indicators = new IndicatorsService();
  const supportResistance = new SupportResistanceService();
  const levelMap = new LevelMapService(binance, supportResistance, indicators);
  const planner = new TradePlanService();

  // The coordinator leg, constructed by hand rather than through Nest — the
  // harness has no DI container and these are all plain classes.
  const marketRegime = new MarketRegimeService(binance, indicators);
  const coordinator = new AnalysisCoordinatorService(
    marketRegime,
    new SqueezeBreakoutService(binance),
    new ChecklistService(),
    binance,
    indicators,
    supportResistance,
  );

  // Each timeframe needs its live window PLUS the replay span, so the oldest
  // decision bar sees exactly as much history as a live call would.
  const series = await Promise.all(
    CHARTS.map(async (timeframe) => {
      const spanBars = Math.ceil(
        (BARS * TIMEFRAME_MS['1h']) / TIMEFRAME_MS[timeframe],
      );
      return {
        timeframe,
        candles: await binance.getCandlesPaged(
          coin,
          timeframe as TimeInterval,
          CANDLE_LIMITS[timeframe] + spanBars + 5,
        ),
      };
    }),
  );

  // The regime/checklist leg has its OWN 12h window at 250 candles: the
  // bandwidth percentile needs a 200-sample history and the level map only
  // fetches 120. Sharing them would silently degrade the percentile here in a
  // way it is not degraded live.
  const analysisSpanBars = Math.ceil(
    (BARS * TIMEFRAME_MS['1h']) / TIMEFRAME_MS[ANALYSIS_TIMEFRAME],
  );
  const analysisSeries = await binance.getCandlesPaged(
    coin,
    ANALYSIS_TIMEFRAME as TimeInterval,
    ANALYSIS_CANDLE_LIMIT + analysisSpanBars + 5,
  );

  const h1 = series.find((s) => s.timeframe === '1h')?.candles ?? [];
  // ── the right edge ──────────────────────────────────────────────────────
  // A decision bar needs FILL_BARS to reach the entry plus MAX_BARS to resolve.
  // Any bar closer to the end of the series than that got a SHORT window: it
  // was marked to market early and then counted at full weight in every
  // summary, alongside trades that had their whole window. That is a real bias
  // — truncated trades bunch as unresolved at the recent edge — so the walk
  // stops early rather than the scorer papering over it.
  //
  // Reserving the window also excludes the still-forming final candle from
  // every forward slice: the last bar any trade can see is h1.length - 2.
  //
  // The reserve covers the LONGEST hold anything asks for, not just the base
  // trade's. With --exit-arms the 960-bar arms ran 864 bars past a 96-bar
  // reserve and straight into the forming candle — a lookahead leak in the code
  // that measures the trailing stop, which is the only positive result this
  // project has produced.
  const RESERVE = FILL_BARS + ARM_HOLD_BARS;
  const lastDecision = h1.length - 2 - RESERVE;
  const firstDecision = Math.max(CANDLE_LIMITS['1h'], lastDecision - BARS + 1);
  if (lastDecision < firstDecision) {
    throw new Error(
      `${coin}: ${h1.length} 1h candles is too few — ${CANDLE_LIMITS['1h']} are ` +
        `needed for the level map and ${RESERVE} more must be reserved so the ` +
        `last decision bar can resolve. Raise --bars.`,
    );
  }

  const trades: Trade[] = [];
  const touches: Array<Record<string, string | number>> = [];
  const marksByChart = new Map<Timeframe, number>();
  const allSignals: Record<'long' | 'short', Signal[]> = { long: [], short: [] };
  const cooldownUntil: Record<'long' | 'short', number> = { long: -1, short: -1 };
  let bars = 0;
  // Tripwire on the replicated structure rule (see inferStructure).
  let structureChecks = 0;
  let structureMismatches = 0;
  let eligible = 0;
  let noFill = 0;

  /**
   * The level map as it stood at the close of bar `i`, or null if it could not
   * be built there.
   *
   * Memoised and callable for ANY bar, not just decision bars, because the
   * re-signal arm asks what the map looked like DURING a hold — bars the walk
   * has not reached, and for late trades bars past `lastDecision` entirely.
   * Computing it on demand and caching it means each bar is built once whether
   * it is asked for by the walk, by a hold, or by both.
   */
  const mapCache = new Map<number, LevelMap | null>();
  const mapAt = (i: number): LevelMap | null => {
    if (mapCache.has(i)) return mapCache.get(i) as LevelMap | null;
    // Never the still-forming candle: `h1.length - 1` has not closed.
    if (i < 0 || i > h1.length - 2) return null;

    const asOf = h1[i].time.getTime() + TIMEFRAME_MS['1h'];
    const truncated = series.map((s) => ({
      timeframe: s.timeframe,
      candles: completedAsOf(
        s.candles,
        TIMEFRAME_MS[s.timeframe],
        asOf,
        CANDLE_LIMITS[s.timeframe],
      ),
    }));

    if (truncated.some((t) => t.candles.length < 50)) {
      mapCache.set(i, null);
      return null;
    }

    // Runtime look-ahead guard, on real data rather than fixtures: no series
    // may contain a candle that had not closed, and the 1h series must end
    // exactly on the bar being asked about. Run on EVERY bar — it used to check
    // the first one and then set a flag, which proves the truncation was right
    // once and says nothing about the other 1,907. It now also covers the bars
    // only the re-signal arm looks at.
    for (const t of truncated) {
      const last = t.candles[t.candles.length - 1];
      const closesAt = last.time.getTime() + TIMEFRAME_MS[t.timeframe];
      if (closesAt > asOf) {
        throw new Error(
          `look-ahead: ${t.timeframe} candle closing ${new Date(closesAt).toISOString()} ` +
            `visible at ${new Date(asOf).toISOString()}`,
        );
      }
    }
    const lastH1 = truncated.find((t) => t.timeframe === '1h')?.candles.slice(-1)[0];
    if (lastH1?.time.getTime() !== h1[i].time.getTime()) {
      throw new Error('look-ahead: 1h series does not end on the decision bar');
    }

    const atrCandles =
      truncated.find((t) => t.timeframe === ATR_TIMEFRAME)?.candles ?? [];
    const built = levelMap.buildFrom(coin, truncated, atrCandles);
    mapCache.set(i, built);
    return built;
  };

  /**
   * Does the map at this bar still contain the zone the trade was taken at?
   *
   * The zone IS the reason for the trade — the entries, the stop and the first
   * target are all derived from it. If no zone in the fresh map overlaps it,
   * the structure the plan was built on is no longer being marked, and that is
   * the plainest reading of "the analysis no longer supports this".
   *
   * Deliberately not a checklist re-score: the checklist gates ENTRY, and a
   * setup that has moved into the trade is not expected to still read as an
   * entry. That is a separate arm, and a different claim.
   */
  const stillSupported = (zones: LevelMap['zones'], plan: TradePlan): boolean =>
    zones.some((z) => z.low <= plan.zone.high && z.high >= plan.zone.low);

  /**
   * The re-analysis exit, as `scoreTrade` consumes it: given a bar of the hold,
   * has support gone?
   *
   * Checked every `RESIGNAL_BARS` bars from the decision, because production
   * analyses each coin three times a day — an hourly check would measure a
   * rule the deployed tool could not run. A bar with no map (too little
   * history, or past the end of the series) reports NO signal: not knowing is
   * not the same as knowing the reason has gone.
   */
  const resignalsFor = (index: number, plan: TradePlan) => {
    const at = (barIndex: number): LevelMap | null => {
      // `forward` starts at index + 1, so bar n of the hold is bar index+1+n.
      const bar = index + 1 + barIndex;
      return (bar - index) % RESIGNAL_BARS !== 0 ? null : mapAt(bar);
    };
    return {
      'zone-gone': (barIndex: number): boolean => {
        const fresh = at(barIndex);
        return fresh === null ? false : !stillSupported(fresh.zones, plan);
      },
      // The tool would not print this trade now: no plan on this side at all.
      // Note what this also catches — price working INTO the zone stops that
      // zone being the nearest on its side, so this can fire on a trade that
      // is winning. That is a property of the rule, not a bug in it, and it is
      // why both readings are measured instead of one being argued for.
      'no-plan': (barIndex: number): boolean => {
        const fresh = at(barIndex);
        if (fresh === null) return false;
        const fresher = planner.buildPlans(fresh.zones, fresh.spot, fresh.atr);
        return !fresher.some((p) => p.direction === plan.direction);
      },
    };
  };

  for (let i = firstDecision; i <= lastDecision; i += STEP) {
    const asOf = h1[i].time.getTime() + TIMEFRAME_MS['1h'];
    const map = mapAt(i);
    if (!map) continue;
    const plans = planner.buildPlans(map.zones, map.spot, map.atr);
    bars += 1;

    for (const { timeframe, levels } of map.perTimeframe) {
      marksByChart.set(timeframe, (marksByChart.get(timeframe) ?? 0) + levels);
    }

    if (TOUCH_LOG) {
      // A touch is the bar's own range INTERSECTING a zone band, not a
      // proximity guess: the zones carry real low/high edges, so use them.
      const bar = h1[i];
      const touched = map.zones.some((z) => bar.low <= z.high && bar.high >= z.low);
      const nearest = map.zones.length
        ? Math.min(...map.zones.map((z) => Math.abs(z.distancePercent)))
        : NaN;
      touches.push({
        coin,
        time: bar.time.toISOString(),
        touched: touched ? 1 : 0,
        nearestPct: nearest,
        // Prior and next hour, both close-to-close, both in percent.
        priorMovePct: Math.abs((bar.close - h1[i - 1].close) / h1[i - 1].close) * 100,
        nextMovePct: Math.abs((h1[i + 1].close - bar.close) / bar.close) * 100,
        atrPct: map.spot === 0 ? NaN : (map.atr / map.spot) * 100,
      });
    }

    // ── coordinator leg, exactly as `analyze()` runs it ─────────────────
    const analysisCandles = completedAsOf(
      analysisSeries,
      TIMEFRAME_MS[ANALYSIS_TIMEFRAME],
      asOf,
      ANALYSIS_CANDLE_LIMIT,
    );
    const context = indicators.buildContext(coin, ANALYSIS_TIMEFRAME, analysisCandles);
    const regimeResult = marketRegime.classifyFromContext(context);
    const routed = coordinator.routeFromRegime(context, ANALYSIS_TIMEFRAME, regimeResult);

    // One checklist per direction — the fix under test. `routeFromRegime` has
    // always taken a direction; scoring both sides off one derived verdict is
    // what made `rsi` and `bollingerBand` unsatisfiable.
    const checklist: BarContext['checklist'] = {};
    if (routed.strategyRoute === 'CONFLUENCE_CHECKLIST') {
      for (const direction of ['long', 'short'] as const) {
        const r = coordinator.routeFromRegime(
          context,
          ANALYSIS_TIMEFRAME,
          regimeResult,
          direction,
        );
        if (r.checklistResult) checklist[direction] = r.checklistResult;
      }
    }

    // Structure comes from the coordinator's OWN condition value when it ran,
    // and falls back to the local copy only on the squeeze route. Mismatches
    // are counted rather than assumed away — a silent divergence between the
    // copy and the real rule is exactly what would invalidate the arms.
    // The structure copy reads the LEVEL MAP's window on this timeframe, which
    // is a different length from the coordinator's `analysisCandles` above —
    // that difference is part of what the mismatch counter is measuring.
    const localStructure = inferStructure(
      indicators,
      completedAsOf(
        series.find((s) => s.timeframe === ANALYSIS_TIMEFRAME)?.candles ?? [],
        TIMEFRAME_MS[ANALYSIS_TIMEFRAME],
        asOf,
        CANDLE_LIMITS[ANALYSIS_TIMEFRAME],
      ),
    );
    const coordStructure = checklist.long?.marketStructure.value as
      | Trade['structure']
      | undefined;
    if (coordStructure) {
      structureChecks += 1;
      if (coordStructure !== localStructure) structureMismatches += 1;
    }
    const structure = coordStructure ?? localStructure;

    // %B is the same formula as baserate.ts's `percentB`, inlined rather than
    // imported: one division does not justify pulling in that module. Null on
    // degenerate bands — a fabricated 0.5 would invent a mode.
    const bb = context.bollingerBands;
    const span = bb.upper - bb.lower;
    const lastClose = context.closes[context.closes.length - 1];

    const barContext: BarContext = {
      regime: regimeResult.regime,
      route: routed.strategyRoute,
      structure,
      checklist,
      raw: {
        rsiValue: context.rsi,
        adxValue: context.adx.adx,
        pdiValue: context.adx.pdi,
        mdiValue: context.adx.mdi,
        percentBValue: span === 0 ? null : (lastClose - bb.lower) / span,
        qqeState: context.qqe.color,
        qqeValue: context.qqe.value,
      },
    };

    for (const plan of plans) {
      if (!STATES.includes(plan.state)) continue;
      // The control pool is filled AFTER the state filter and BEFORE the
      // cooldown check, which is the only position that makes the control mean
      // what it claims: "the same plans, taken at random times".
      //
      // It used to be filled before the filter. That handed the control every
      // APPROACHING and FAR plan the strategy arm never saw, so the two arms
      // were drawn from different populations and the difference between them
      // was partly a difference of population. Cooldown stays on the strategy
      // side only — that IS the timing rule the control exists to vary.
      allSignals[plan.direction].push({ index: i, plan, structure, context: barContext });
      eligible += 1;
      if (i <= cooldownUntil[plan.direction]) continue;

      const trade = tryTrade(coin, 'PLAN', h1, i, plan, barContext, resignalsFor(i, plan));
      if (!trade) {
        noFill += 1;
        continue;
      }
      trades.push(trade);
      cooldownUntil[plan.direction] =
        i + trade.barsToFill + trade.barsHeld + COOLDOWN;
    }
  }

  // ── control: same geometry, random timing, matched count ───────────────
  if (RANDOM) {
    const rng = makeRng(SEED);
    for (const direction of ['long', 'short'] as const) {
      const taken = trades.filter(
        (t) => t.tier === 'PLAN' && t.direction === direction,
      ).length;
      const pool = allSignals[direction];
      // ponytail: sampled independently, without the one-at-a-time rule — this
      // is a distribution to compare against, not a portfolio to run.
      for (let n = 0; n < taken && pool.length > 0; n += 1) {
        const pick = pool[Math.floor(rng() * pool.length)];
        const trade = tryTrade(
          coin,
          'RANDOM',
          h1,
          pick.index,
          pick.plan,
          pick.context,
          resignalsFor(pick.index, pick.plan),
        );
        if (trade) trades.push(trade);
      }
    }
  }

  return {
    trades,
    bars,
    eligible,
    noFill,
    window: [h1[firstDecision].time, h1[lastDecision].time],
    structureChecks,
    structureMismatches,
    touches,
    marksByChart,
  };
}

const mean = (xs: number[]) =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * One row of the headline table.
 *
 * Every statistic comes from the shared `aggregate`; nothing is averaged here.
 * This file used to compute its own and `holdout.ts` computed a different one,
 * which is how the same 626 rows produced −0.0178R and −0.1455R.
 *
 * `open` / `exp resolved` / `gap` are permanent columns, not diagnostics: the
 * headline marks unresolved positions to market, and a reader who cannot see
 * how many there are cannot tell a result from an accounting choice.
 */
function summarise(label: string, trades: Trade[]): Record<string, string | number> {
  const a = aggregate(trades);
  const n3 = (x: number): string => (Number.isNaN(x) ? '—' : x.toFixed(3));
  return {
    group: label,
    n: a.n,
    'win%': Number.isNaN(a.winRate) ? '—' : `${(a.winRate * 100).toFixed(0)}%`,
    'net R/trade': n3(a.expectancy),
    'total R': a.totalR.toFixed(1),
    open: a.unresolved,
    'open meanR': n3(a.unresolvedMeanR),
    'exp resolved': n3(a.expectancyResolved),
    gap: n3(a.markingGap),
    'gross R/trade': mean(trades.map((t) => t.r)).toFixed(3),
    'cost R/trade': mean(trades.map((t) => t.costR)).toFixed(3),
    'planned R': mean(trades.map((t) => t.plannedR)).toFixed(2),
    'risk%': mean(trades.map((t) => t.riskPercent)).toFixed(2),
    bars: Math.round(mean(trades.map((t) => t.barsHeld))),
  };
}

async function main(): Promise<void> {
  console.log(`\nPLAN BACKTEST — replays the printed trade plan`);
  console.log(`config  ${CONFIG}\n`);

  const all: Trade[] = [];
  const MARKS = new Map<Timeframe, number>();

  const allTouches: Array<Record<string, string | number>> = [];
  for (const coin of COINS) {
    const startedAt = Date.now();
    const { trades, bars, eligible, noFill, window, structureChecks, structureMismatches, touches, marksByChart } =
      await runCoin(coin);
    all.push(...trades);
    for (const [k, v] of marksByChart) MARKS.set(k, (MARKS.get(k) ?? 0) + v);
    allTouches.push(...touches);
    const plan = trades.filter((t) => t.tier === 'PLAN');
    console.log(
      `${coin.padEnd(4)} ${bars} bars ` +
        `${window[0].toISOString().slice(0, 10)} → ${window[1].toISOString().slice(0, 10)} · ` +
        `${eligible} eligible plan(s) · ${plan.length} taken · ${noFill} never reached entry · ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s` +
        (structureMismatches > 0
          ? ` · STRUCTURE MISMATCH ${structureMismatches}/${structureChecks}`
          : ''),
    );
  }

  // A target can never be taken on the fill bar — see the target block in
  // scoreTrade. `barsHeld === 1` IS the fill bar, so this pair is impossible.
  // Asserted over the whole output rather than only in a unit test: the rule is
  // worth 0.042R, which is four times the expectancy it is measured against.
  const impossible = all.filter((t) => t.targetsHit > 0 && t.barsHeld === 1);
  if (impossible.length > 0) {
    throw new Error(
      `fill-bar target: ${impossible.length} trade(s) took a target on the bar ` +
        `they filled on, e.g. ${impossible[0].coin} ${impossible[0].time.toISOString()}`,
    );
  }

  const plan = all.filter((t) => t.tier === 'PLAN');
  if (plan.length === 0) {
    console.log('\nNo trades. Widen --states or --bars.');
    return;
  }

  console.log('');
  console.table([
    summarise('ALL PLANS', plan),
    summarise('  long', plan.filter((t) => t.direction === 'long')),
    summarise('  short', plan.filter((t) => t.direction === 'short')),
    ...COINS.map((c) => summarise(`  ${c}`, plan.filter((t) => t.coin === c))),
  ]);

  const byStatus = ['ALL_TARGETS', 'PARTIAL', 'TIMEOUT', 'STOPPED'].map((s) => ({
    status: s,
    n: plan.filter((t) => t.status === s).length,
    'share%': `${((plan.filter((t) => t.status === s).length / plan.length) * 100).toFixed(0)}%`,
    'net R/trade': mean(plan.filter((t) => t.status === s).map((t) => t.netR)).toFixed(2),
  }));
  console.table(byStatus);

  const totalMarks = [...MARKS.values()].reduce((a, b) => a + b, 0);
  console.log('\nlevels per chart (share of all marks)');
  console.log(
    LEVEL_TIMEFRAMES.filter((tf) => MARKS.has(tf))
      .map((tf) => `  ${tf.padEnd(4)} ${String(MARKS.get(tf)).padStart(7)}  ${((100 * (MARKS.get(tf) ?? 0)) / totalMarks).toFixed(1)}%`)
      .join('\n'),
  );

  if (RANDOM) {
    const control = all.filter((t) => t.tier === 'RANDOM');
    console.log('\ncontrol — same plans, random timing');
    console.table([
      summarise('PLAN', plan),
      summarise('RANDOM', control),
      summarise('  random long', control.filter((t) => t.direction === 'long')),
      summarise('  random short', control.filter((t) => t.direction === 'short')),
    ]);
    // ── edge over random, both conventions, always together ─────────────
    //
    // RESOLVED-ONLY is the primary metric. Both pre-registrations define it
    // that way — "mean net R per trade minus its own random control, resolved
    // trades only" — and both then quoted the MARKED number as the headline,
    // because that is the only one this line printed. The gap is not academic:
    // the hierarchical arm carried 22% open trades and a 0.168R marking gap.
    //
    // Both are printed, from the same `aggregate` the tables above use, so no
    // caller can select a convention after seeing the result. That is the same
    // fix CP4 made inside the scorer, applied to the number on top of it.
    const ap = aggregate(plan);
    const ac = aggregate(control);
    const line = (
      name: string,
      value: number,
      pv: number,
      cv: number,
    ): string =>
      `  ${name.padEnd(24)} ${value >= 0 ? ' ' : ''}${value.toFixed(3)}R` +
      `   = plan ${pv.toFixed(3)} - random ${cv.toFixed(3)}`;

    console.log('\nedge over random');
    console.log(
      line(
        'resolved-only (PRIMARY)',
        ap.expectancyResolved - ac.expectancyResolved,
        ap.expectancyResolved,
        ac.expectancyResolved,
      ),
    );
    console.log(line('marked', ap.expectancy - ac.expectancy, ap.expectancy, ac.expectancy));
    console.log(
      `  ${'open (unresolved)'.padEnd(24)} plan ${ap.unresolved}/${ap.n}` +
        `   random ${ac.unresolved}/${ac.n}`,
    );
    console.log(
      `  ${'marking gap'.padEnd(24)} plan ${ap.markingGap.toFixed(3)}` +
        `   random ${ac.markingGap.toFixed(3)}`,
    );
  }

  if (TOUCH_LOG && allTouches.length) {
    const tk = Object.keys(allTouches[0]);
    fs.writeFileSync(
      TOUCH_LOG,
      `# ${CONFIG}\n${tk.join(',')}\n` +
        allTouches.map((t) => tk.map((k) => t[k]).join(',')).join('\n'),
    );
    console.log(`\nwrote ${allTouches.length} bar rows to ${TOUCH_LOG} (config on line 1)`);
  }

  if (CSV) {
    const keys = Object.keys(plan[0]) as Array<keyof Trade>;
    const write = (path: string, rows: Trade[]): void => {
      fs.writeFileSync(
        path,
        `# ${CONFIG}\n${keys.join(',')}\n` +
          rows
            .map((t) =>
              keys
                .map((k) => (t[k] instanceof Date ? (t[k] as Date).toISOString() : t[k]))
                .join(','),
            )
            .join('\n'),
      );
      console.log(`wrote ${rows.length} trades to ${path} (config on line 1)`);
    };

    // Split by tier: bootstrap.ts takes strategy and control as two files, and
    // its columns are `time` / `r` / `costR`, which is why they are named that.
    console.log('');
    write(CSV, plan);
    const control = all.filter((t) => t.tier === 'RANDOM');
    if (control.length > 0) write(CSV.replace(/\.csv$/, '') + '.random.csv', control);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
