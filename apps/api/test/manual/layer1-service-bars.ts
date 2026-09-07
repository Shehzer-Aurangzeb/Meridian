/**
 * Layer 1's bars, re-run through the SERVICE code rather than the research rig.
 *
 *   pnpm --filter api layer1-service-bars
 *
 * `layer1-bars.ts` proved the model works when the research harness builds it.
 * This file proves the thing that will actually run in production computes the
 * same numbers — it imports `conesForHour` and `trailingBaseline` from
 * `src/expected-move/`, and `classifyWithHysteresis` from `src/market-regime/`,
 * and replays them over the 320,000-row panel.
 *
 * That distinction has teeth. A promoted model can differ from its research
 * version by a standardisation divisor, a feature order, an off-by-one in the
 * baseline window — none of which show up as an error, all of which show up
 * here as a bar that stops clearing.
 *
 * The holdout is the same last 182 days, and the weights being applied were
 * fitted without it.
 */
import { load, mean } from './phase-b';
import {
  conesForHour, trailingBaseline, CoinFeatures,
} from '../../src/expected-move/expected-move.math';
import { FEATURE_ORDER, BASELINE_WINDOW_HOURS, HORIZONS, ExpectedMoveHorizon } from '../../src/expected-move/fitted';
import { classifyWithHysteresis, REGIME_HYSTERESIS } from '../../src/market-regime/regime-hysteresis';
import { makeRng } from './rng';

const args = process.argv.slice(2);
const str = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const num = (n: string, d: number): number => Number(str(n, String(d)));

const IN = str('in', 'test/manual/results/panel.csv');
const HOLDOUT_DAYS = num('holdout-days', 182);
const QUINTILES = num('quintiles', 5);
const SEED = num('seed', 12345);
const BAR_1A_SPREAD_BP = num('bar-1a', 20);
const BAR_1B_MARGIN_BP = num('bar-1b', 8);
const BAR_1C_MEDIAN_HOURS = num('bar-1c', 12);

const pct = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];

function quintileProfile(pred: number[], realised: number[], q: number): number[] {
  const order = pred.map((_, i) => i).sort((a, b) => pred[a] - pred[b]);
  const out: number[] = [];
  for (let k = 0; k < q; k += 1) {
    const lo = Math.floor((k * order.length) / q);
    const hi = Math.floor(((k + 1) * order.length) / q);
    const slice = order.slice(lo, hi).map((i) => realised[i]);
    out.push(slice.length === 0 ? NaN : mean(slice));
  }
  return out;
}

const isMonotonic = (xs: number[]): boolean => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

function main(): void {
  const t0 = Date.now();
  const panel = load(IN);
  const nC = panel.coins.length;
  const nT = panel.times.length;
  const holdoutLo = nT - HOLDOUT_DAYS * 24;

  console.log('\nLAYER 1 — BARS THROUGH THE SERVICE CODE');
  console.log(`panel      ${IN}  ${nT.toLocaleString()} hours x ${nC} coins`);
  console.log(`features   ${FEATURE_ORDER.length}: ${FEATURE_ORDER.join(' ')}`);
  console.log(`baseline   ${BASELINE_WINDOW_HOURS / 24}-day trailing, from src/expected-move/fitted.ts`);
  console.log(`holdout    last ${HOLDOUT_DAYS} days: ${new Date(panel.times[holdoutLo]).toISOString().slice(0, 10)} -> ${new Date(panel.times[nT - 1]).toISOString().slice(0, 10)}\n`);

  const close = panel.data.get('close')!;
  const cols = FEATURE_ORDER.map((f) => panel.data.get(f)!);

  // Per-coin close series, so the service's own baseline function can be used
  // rather than a second implementation of it.
  const closes: number[][] = [];
  for (let ci = 0; ci < nC; ci += 1) {
    const series = new Array<number>(nT);
    for (let ti = 0; ti < nT; ti += 1) series[ti] = close[ti * nC + ci];
    closes.push(series);
  }

  let pass1a = true;
  let pass1b = true;

  console.log('── bar 1a / 1b — expected move, via conesForHour() ──');
  for (const horizon of HORIZONS as readonly ExpectedMoveHorizon[]) {
    const pred: number[] = [];
    const realised: number[] = [];
    const timeIdx: number[] = [];

    for (let ti = holdoutLo; ti < nT; ti += 1) {
      // Everything the service would have at this bar, for every coin present.
      const rows: CoinFeatures[] = [];
      const outcome: number[] = [];
      for (let ci = 0; ci < nC; ci += 1) {
        if (ti + horizon >= nT) continue;
        const a = closes[ci][ti];
        const b = closes[ci][ti + horizon];
        if (!(a > 0) || !(b > 0)) continue;
        const baseline = trailingBaseline(closes[ci].slice(0, ti + 1), horizon, BASELINE_WINDOW_HOURS);
        if (baseline === null) continue;
        rows.push({
          symbol: panel.coins[ci],
          features: cols.map((c) => c[ti * nC + ci]),
          baseline,
        });
        outcome.push(Math.abs(Math.log(b / a)) * 1e4);
      }
      if (rows.length < 2) continue;

      const cones = conesForHour(rows, horizon);
      rows.forEach((r, i) => {
        const cone = cones.get(r.symbol)!;
        pred.push(cone.predicted);
        realised.push(outcome[i]);
        timeIdx.push(ti);
      });
    }

    // Shuffle control: permute the forecast among the coins present in each
    // hour. Rows are emitted hour-major, so a run of equal timeIdx is one hour.
    const rng = makeRng(SEED);
    const shuffled = [...pred];
    let i = 0;
    while (i < shuffled.length) {
      let j = i;
      while (j + 1 < shuffled.length && timeIdx[j + 1] === timeIdx[i]) j += 1;
      for (let k = j; k > i; k -= 1) {
        const s = i + Math.floor(rng() * (k - i + 1));
        [shuffled[k], shuffled[s]] = [shuffled[s], shuffled[k]];
      }
      i = j + 1;
    }

    const real = quintileProfile(pred, realised, QUINTILES);
    const shuf = quintileProfile(shuffled, realised, QUINTILES);
    const spread = real[real.length - 1] - real[0];
    const margin = real[real.length - 1] - shuf[shuf.length - 1];
    const mono = isMonotonic(real);
    const ok1a = mono && spread >= BAR_1A_SPREAD_BP;
    const ok1b = margin >= BAR_1B_MARGIN_BP;
    pass1a = pass1a && ok1a;
    pass1b = pass1b && ok1b;

    console.log(`\n${horizon}h  n=${pred.length.toLocaleString()}  quintiles ${real.map((x) => x.toFixed(0)).join(' -> ')} bp`);
    console.log(`     shuffled  ${shuf.map((x) => x.toFixed(0)).join(' -> ')} bp`);
    console.log(`     1a: ${mono ? 'monotonic' : 'NOT MONOTONIC'}, spread ${spread.toFixed(1)} bp (bar ${BAR_1A_SPREAD_BP}) ${ok1a ? 'PASS' : 'FAIL'}`);
    console.log(`     1b: top ${real[real.length - 1].toFixed(1)} vs shuffled ${shuf[shuf.length - 1].toFixed(1)}, margin ${margin.toFixed(1)} bp (bar ${BAR_1B_MARGIN_BP}) ${ok1b ? 'PASS' : 'FAIL'}`);
  }

  // ── bar 1c, through the service's own classifier ──
  console.log('\n── bar 1c — regime stability, via classifyWithHysteresis() ──');
  console.log(
    `hysteresis  ADX enter ${REGIME_HYSTERESIS.adxEnter} / exit ${REGIME_HYSTERESIS.adxExit}, ` +
      `compression enter ${REGIME_HYSTERESIS.compressionEnterPct} / exit ${REGIME_HYSTERESIS.compressionExitPct}th pct`,
  );
  const bw = panel.data.get('bandWidth')!;
  const adx = panel.data.get('adx')!;
  const durations: number[] = [];
  const exit24 = new Map<string, { entries: number; exited: number }>();
  const held = new Map<string, number>();
  let total = 0;

  for (let ci = 0; ci < nC; ci += 1) {
    const hist: number[] = [];
    const labels: Array<string | null> = new Array(nT).fill(null);
    let prev: ReturnType<typeof classifyWithHysteresis> | null = null;
    for (let ti = 0; ti < nT; ti += 1) {
      const v = bw[ti * nC + ci];
      const a = adx[ti * nC + ci];
      if (hist.length >= REGIME_HYSTERESIS.bandWidthLookback && Number.isFinite(v) && Number.isFinite(a)) {
        prev = classifyWithHysteresis(v, a, hist.slice(-REGIME_HYSTERESIS.bandWidthLookback), prev?.regime ?? null);
        labels[ti] = prev.regime;
      }
      if (Number.isFinite(v)) hist.push(v);
    }
    let i = 0;
    while (i < nT) {
      if (labels[i] === null) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < nT && labels[j + 1] === labels[i]) j += 1;
      durations.push(j - i + 1);
      held.set(labels[i]!, (held.get(labels[i]!) ?? 0) + (j - i + 1));
      total += j - i + 1;
      for (let t = i; t <= j; t += 1) {
        if (t + 24 >= nT) break;
        const cell = exit24.get(labels[i]!) ?? { entries: 0, exited: 0 };
        cell.entries += 1;
        if (labels[t + 24] !== labels[i]) cell.exited += 1;
        exit24.set(labels[i]!, cell);
      }
      i = j + 1;
    }
  }

  durations.sort((a, b) => a - b);
  const median = pct(durations, 50);
  const short = durations.filter((d) => d <= 2).length / durations.length;
  console.log(`runs ${durations.length.toLocaleString()}, median ${median}h, mean ${mean(durations).toFixed(1)}h, 1-2h runs ${(short * 100).toFixed(1)}%`);
  const rates: number[] = [];
  for (const [regime, cell] of [...exit24].sort()) {
    const rate = cell.exited / cell.entries;
    rates.push(rate);
    console.log(
      `  ${regime.padEnd(15)} share ${(((held.get(regime) ?? 0) / total) * 100).toFixed(1)}%  ` +
        `24h exit rate ${(rate * 100).toFixed(1)}%  (n=${cell.entries.toLocaleString()})`,
    );
  }
  const rateSpread = rates.length < 2 ? 0 : Math.max(...rates) - Math.min(...rates);
  const ok1c = median > BAR_1C_MEDIAN_HOURS && rateSpread >= 0.1;
  console.log(
    `  1c: median ${median}h (bar > ${BAR_1C_MEDIAN_HOURS}h), exit-rate spread ${(rateSpread * 100).toFixed(1)} points ${ok1c ? 'PASS' : 'FAIL'}`,
  );

  console.log('\n── verdict ──');
  console.log(`1a ${pass1a ? 'PASS' : 'FAIL'}   1b ${pass1b ? 'PASS' : 'FAIL'}   1c ${ok1c ? 'PASS' : 'FAIL'}`);
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (!pass1a || !pass1b || !ok1c) process.exitCode = 1;
}

if (require.main === module) main();
