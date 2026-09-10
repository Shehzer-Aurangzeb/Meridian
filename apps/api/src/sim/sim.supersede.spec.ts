import { firstRegimeChangeAfter, regimeOfSnapshot } from './sim.supersede';
import { scoreSimTrade, isTerminal, type SimPlanInput } from './sim.scoring';
import { Candle } from '../common/types/candle.types';
import type { LabelledBar } from '../market-regime/market-regime.service';

const T0 = Date.parse('2026-09-01T00:00:00Z');
const HOUR = 3_600_000;

const labelled = (regimes: string[]): LabelledBar[] =>
  regimes.map((regime, i) => ({
    time: new Date(T0 + i * HOUR),
    regime: regime as LabelledBar['regime'],
    reason: '',
    bandWidthPercentile: 0,
  }));

describe('firstRegimeChangeAfter', () => {
  const decidedAt = new Date(T0 + 2 * HOUR);

  it('finds the bar the state changed on', () => {
    const series = labelled(['COMPRESSION', 'COMPRESSION', 'COMPRESSION', 'COMPRESSION', 'TRENDING']);
    expect(firstRegimeChangeAfter(series, decidedAt, 'COMPRESSION')).toEqual(
      new Date(T0 + 4 * HOUR),
    );
  });

  it('ignores everything at or before the decision', () => {
    // The state before the decision is not a change; the analyst saw it.
    const series = labelled(['TRENDING', 'TRENDING', 'COMPRESSION', 'COMPRESSION']);
    expect(firstRegimeChangeAfter(series, decidedAt, 'COMPRESSION')).toBeNull();
  });

  it('catches a state that leaves and comes back', () => {
    // An age-of-current-run check would report COMPRESSION holding and miss
    // this entirely. The thesis still broke at hour 3.
    const series = labelled([
      'COMPRESSION', 'COMPRESSION', 'COMPRESSION', 'TRENDING', 'COMPRESSION',
    ]);
    expect(firstRegimeChangeAfter(series, decidedAt, 'COMPRESSION')).toEqual(
      new Date(T0 + 3 * HOUR),
    );
  });

  it('is null while the state holds, and on an empty series', () => {
    expect(
      firstRegimeChangeAfter(labelled(['COMPRESSION', 'COMPRESSION', 'COMPRESSION', 'COMPRESSION']), decidedAt, 'COMPRESSION'),
    ).toBeNull();
    expect(firstRegimeChangeAfter([], decidedAt, 'COMPRESSION')).toBeNull();
  });
});

describe('regimeOfSnapshot', () => {
  it('reads the state the analyst was shown', () => {
    expect(regimeOfSnapshot({ regime: { state: 'TRENDING' } })).toBe('TRENDING');
  });

  it('is null when the snapshot never held one', () => {
    // An archived reading with no regime cannot be superseded on regime, and
    // must not be superseded on a guess either.
    expect(regimeOfSnapshot({ regime: null })).toBeNull();
    expect(regimeOfSnapshot({})).toBeNull();
    expect(regimeOfSnapshot(null)).toBeNull();
  });
});

const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({
  time: new Date(T0 + i * HOUR),
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 0,
});

const flat = (from: number, count: number, price: number): Candle[] =>
  Array.from({ length: count }, (_, i) => bar(from + i, price, price, price, price));

describe('closing a trade early', () => {
  const decidedAt = new Date(T0);
  const NOW = T0 + 96 * HOUR;

  const plan: SimPlanInput = {
    direction: 'long',
    entry: 100,
    stop: 90,
    targets: [{ price: 130, weightPercent: 100 }],
  };

  // Fills on bar 1, then drifts up to 104 and stays. Neither stop nor target.
  const running = [
    bar(0, 100, 100, 100, 100),
    bar(1, 101, 101, 99, 100),
    ...flat(2, 100, 104),
  ];

  it('without a close, it runs out the window and EXPIRES', () => {
    const out = scoreSimTrade(plan, running, decidedAt, NOW);
    expect(out.outcome).toBe('EXPIRED');
  });

  it('with a close, it is SUPERSEDED and scored at that bar', () => {
    const out = scoreSimTrade(plan, running, decidedAt, NOW, undefined, new Date(T0 + 10 * HOUR));
    expect(out.outcome).toBe('SUPERSEDED');
    expect(isTerminal(out.outcome)).toBe(true);
    // Closed at 104 against an entry of 100 and 10 of risk: +0.4R before costs.
    expect(out.grossR).toBeCloseTo(0.4, 2);
    expect(out.netR).not.toBeNull();
    expect(out.netR as number).toBeLessThan(out.grossR as number);
  });

  it('does NOT reach back and rewrite a trade that already finished', () => {
    // Stops on bar 2. A thesis expiring at hour 10 cannot undo that.
    const stopped = [
      bar(0, 100, 100, 100, 100),
      bar(1, 101, 101, 99, 100),
      bar(2, 100, 100, 89, 90),
      ...flat(3, 100, 90),
    ];
    const out = scoreSimTrade(plan, stopped, decidedAt, NOW, undefined, new Date(T0 + 10 * HOUR));
    expect(out.outcome).toBe('STOPPED');
  });

  it('does not invent a fill for a trade that never filled before the close', () => {
    const never: SimPlanInput = { ...plan, entry: 50, stop: 45 };
    const out = scoreSimTrade(never, flat(0, 100, 100), decidedAt, NOW, undefined, new Date(T0 + 10 * HOUR));
    expect(out.filledAt).toBeNull();
    expect(out.netR).toBeNull();
  });

  it('carries no numbers when closed before any forward bar exists', () => {
    const out = scoreSimTrade(plan, running, decidedAt, NOW, undefined, new Date(T0 - HOUR));
    expect(out.netR).toBeNull();
    expect(out.filledAt).toBeNull();
  });
});

describe('a replaced trade is finished even if it never started', () => {
  const decidedAt = new Date(T0);
  const NOW = T0 + 96 * HOUR;
  const unreachable: SimPlanInput = {
    direction: 'long',
    entry: 50,
    stop: 45,
    targets: [{ price: 60, weightPercent: 100 }],
  };

  it('is MISSED, not PENDING, so it does not sit unresolved for good', () => {
    const out = scoreSimTrade(
      unreachable, flat(0, 100, 100), decidedAt, NOW, undefined, new Date(T0 + 2 * HOUR),
    );
    expect(out.outcome).toBe('MISSED');
    expect(isTerminal(out.outcome)).toBe(true);
    expect(out.netR).toBeNull();
  });

  it('is MISSED even when closed before any bar existed', () => {
    const out = scoreSimTrade(
      unreachable, flat(0, 100, 100), decidedAt, NOW, undefined, new Date(T0 - HOUR),
    );
    expect(out.outcome).toBe('MISSED');
    expect(isTerminal(out.outcome)).toBe(true);
  });
});
