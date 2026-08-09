import { TradePlan } from '../analysis/services/trade-plan.service';
import { PlanResult } from './outcome';
import { buildVerdict } from './verdict';

/**
 * The verdict restates computed numbers as prose. It fails silently and
 * plausibly — a wrong branch still reads like a sentence — so what is checked
 * here is that each clause matches the struct it came from.
 */

const zone = (over: Partial<TradePlan['zone']> = {}): TradePlan['zone'] => ({
  low: 64000,
  high: 64400,
  center: 64200,
  type: 'support',
  sources: ['1h support', '4h support', '0.5 Fib (12h)'],
  spanPercent: 0.62,
  distancePercent: -0.8,
  ...over,
});

const plan = (over: Partial<TradePlan> = {}): TradePlan => ({
  direction: 'long',
  state: 'ACTIONABLE',
  zone: zone(),
  distanceToZonePercent: -0.8,
  entries: [{ price: 64200, weightPercent: 100 }],
  averageEntry: 64200,
  stop: 63700,
  riskPercent: 0.78,
  riskPerUnit: 500,
  targets: [
    { price: 64800, weightPercent: 50, rMultiple: 1.2, source: '4h resistance' },
    { price: 65400, weightPercent: 50, rMultiple: 2.4, source: '12h resistance' },
  ],
  blendedR: 1.8,
  comeBackWhen: 'price closes back above the zone',
  ...over,
});

const record = (over: Partial<Parameters<typeof buildVerdict>[0]> = {}) => ({
  symbol: 'BTC',
  regime: {
    symbol: 'BTC',
    timeframe: '12h',
    regime: 'MEAN_REVERSION' as const,
    reason: 'ADX below 25',
    metrics: {
      adx: 18.4,
      pdi: 20,
      mdi: 22,
      rsi: 44,
      atr: 900,
      bandWidth: 3.2,
      bandWidthPercentile: 40,
      bandWidthThreshold: 1.9,
      bandWidthLookback: 200,
      bandWidthSamples: 200,
      bollingerBands: { upper: 66000, middle: 64500, lower: 63000 },
    },
  },
  route: 'CONFLUENCE_CHECKLIST' as const,
  checklist: { conditionsMet: 3 } as never,
  plans: [plan()],
  map: { spot: 64300 } as never,
  ...over,
});

const outcome = (over: Partial<PlanResult> = {}): PlanResult => ({
  direction: 'long',
  outcome: 'PENDING',
  r: null,
  filledAt: null,
  targetsHit: 0,
  ...over,
});

describe('buildVerdict', () => {
  it('leads with the actionable plan and states its real risk', () => {
    const v = buildVerdict(record(), 'LIVE', [outcome()], 64300);

    expect(v.headline).toBe('BTC · a long is actionable now');
    // The three numbers a trader acts on must be the plan's own.
    expect(v.body.join(' ')).toContain('0.78%');
    expect(v.body.join(' ')).toContain('$63,700');
    expect(v.body.join(' ')).toContain('1.80R');
    // Confluence is the point: the count is the zone's source count, not the
    // number of timeframes or of plans.
    expect(v.body[0]).toContain('3 independent levels agree');
  });

  it('says nothing is tradeable when no plan was built', () => {
    const v = buildVerdict(record({ plans: [] }), 'LIVE', [], 64300);

    expect(v.headline).toBe('BTC · nothing to trade here');
    expect(v.body[0]).toContain('$64,300');
    expect(v.status).toBeNull();
  });

  it('lets freshness override the plan state — a dead read is not actionable', () => {
    const live = buildVerdict(record(), 'LIVE', [outcome()], 64300);
    const dead = buildVerdict(record(), 'INVALIDATED', [outcome()], 63000);

    expect(live.headline).toContain('actionable now');
    expect(dead.headline).toBe('BTC · this read is finished');
    expect(dead.body.join(' ')).toContain('gone through every stop');
  });

  it('prefers an ACTIONABLE plan over a nearer APPROACHING one', () => {
    const near = plan({ direction: 'short', state: 'APPROACHING', distanceToZonePercent: 0.1 });
    const far = plan({ direction: 'long', state: 'ACTIONABLE', distanceToZonePercent: -2.0 });
    const v = buildVerdict(record({ plans: [near, far] }), 'LIVE', [outcome(), outcome()], 64300);

    expect(v.headline).toBe('BTC · a long is actionable now');
  });

  it('reads the outcome of the plan it led with, not plans[0]', () => {
    const watch = plan({ direction: 'short', state: 'APPROACHING', distanceToZonePercent: 0.1 });
    const take = plan({ direction: 'long', state: 'ACTIONABLE', distanceToZonePercent: -2.0 });
    const v = buildVerdict(
      record({ plans: [watch, take] }),
      'LIVE',
      [outcome({ outcome: 'STOPPED', r: -1 }), outcome({ outcome: 'OPEN', r: 0.42 })],
      64300,
    );

    expect(v.status).toContain('+0.42R');
    expect(v.status).not.toContain('stopped');
  });

  it('reports each outcome in the tense it happened', () => {
    const at = (o: Partial<PlanResult>) =>
      buildVerdict(record(), 'LIVE', [outcome(o)], 64300).status;

    expect(at({ outcome: 'PENDING' })).toContain('not reached the entry');
    expect(at({ outcome: 'MISSED' })).toContain('passed by');
    expect(at({ outcome: 'STOPPED', r: -1 })).toContain('stopped out');
    expect(at({ outcome: 'PARTIAL', r: 0.6, targetsHit: 1 })).toContain('1 target hit');
    expect(at({ outcome: 'ALL_TARGETS', r: 1.8 })).toContain('every target');
  });
});
