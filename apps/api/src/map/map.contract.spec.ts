/**
 * Bar 4b — the API contract.
 *
 * These are not unit tests of convenience. Each one encodes a promise the
 * product makes to whoever reads its numbers, and each corresponds to a way
 * this project has previously been wrong:
 *
 *   n < 200 returns null        a probability from a thin bucket reads as
 *                               confident and is not; effective n here runs
 *                               one to two orders below the raw count
 *   every probability has n     a bare number cannot be checked by a reader
 *   beyond +-5% is an error     the archive publishes nothing out there, and
 *                               "thin" is a different claim from "unknown"
 *   warning on few blocks       17 trades in one 30-day block once produced a
 *                               zero-width interval that looked like certainty
 */
import { BadRequestException } from '@nestjs/common';
import { publish, isPublished, ZONE_BOUNCE_WITHHELD, REGIME_EXIT_WITHHELD, UNWIND_LIFT_WITHHELD, MAP_DISCLAIMERS } from './withheld';
import { MIN_SAMPLE_FOR_PROBABILITY } from '../calibration/calibration';
import { ConditionService, MIN_MATCHES, MIN_BLOCKS, Analogue } from './condition.service';
import { LiquidityService } from '../liquidity/liquidity.service';
import { CalibrationReportService } from './calibration-report.service';
import { Probability } from './map.types';

describe('contract: n < 200 returns null', () => {
  it('refuses to publish below the minimum', () => {
    const p = publish(0.71, MIN_SAMPLE_FOR_PROBABILITY - 1, '2026-09-06');
    expect(p.value).toBeNull();
    expect(isPublished(p)).toBe(false);
  });

  it('publishes at exactly the minimum', () => {
    const p = publish(0.71, MIN_SAMPLE_FOR_PROBABILITY, '2026-09-06');
    expect(p.value).toBeCloseTo(0.71, 10);
    expect(isPublished(p)).toBe(true);
  });

  it('refuses a non-finite value however large the sample', () => {
    expect(publish(NaN, 100_000, '2026-09-06').value).toBeNull();
  });

  it('explains the refusal rather than returning a bare null', () => {
    const p = publish(0.71, 10, '2026-09-06');
    if (isPublished(p)) throw new Error('should not be published');
    expect(p.reason).toContain('below the 200');
    expect(p.evidence).toBeTruthy();
  });
});

describe('contract: every published probability carries its n and fit date', () => {
  it('carries both, and an interval when given one', () => {
    const p = publish(0.71, 1847, '2026-09-06', [0.67, 0.75]);
    if (!isPublished(p)) throw new Error('should be published');
    expect(p.n).toBe(1847);
    expect(p.fittedAt).toBe('2026-09-06');
    expect(p.ci95).toEqual([0.67, 0.75]);
  });

  it('makes a number without an n unrepresentable', () => {
    // The type has no branch carrying `value` without `n`, so this is a
    // compile-time guarantee as well as a runtime one. Asserted anyway,
    // because the type can be widened by accident and this test cannot.
    const p: Probability = publish(0.5, 500, '2026-09-06');
    if (isPublished(p)) expect(typeof p.n).toBe('number');
  });
});

describe('contract: the three withheld outputs stay withheld', () => {
  it.each([
    ['zone bounce', ZONE_BOUNCE_WITHHELD],
    ['regime exit', REGIME_EXIT_WITHHELD],
    ['unwind lift', UNWIND_LIFT_WITHHELD],
  ])('%s is null with a reason and an evidence pointer', (_name, w) => {
    expect(w.value).toBeNull();
    expect(w.reason.length).toBeGreaterThan(60);
    expect(w.evidence).toMatch(/docs\/evidence/);
  });

  it('states the measurement, not just that it failed', () => {
    expect(ZONE_BOUNCE_WITHHELD.reason).toContain('Brier');
    expect(REGIME_EXIT_WITHHELD.reason).toContain('5.06');
    expect(UNWIND_LIFT_WITHHELD.reason).toContain('11.1%');
  });
});

describe('contract: beyond +-5% is an error, never an extrapolation', () => {
  const service = new LiquidityService({} as never);

  it('accepts a distance inside the published range', () => {
    expect(() => service.assertWithinRange(-2.3)).not.toThrow();
    expect(() => service.assertWithinRange(5)).not.toThrow();
  });

  it('rejects anything past the archive', () => {
    expect(() => service.assertWithinRange(5.01)).toThrow(BadRequestException);
    expect(() => service.assertWithinRange(-10)).toThrow(BadRequestException);
  });

  it('says the number is not extrapolated, so the caller cannot assume it was clamped', () => {
    expect(() => service.assertWithinRange(12)).toThrow(/not extrapolated/);
  });
});

describe('contract: the conditional endpoint warns on thin or clustered evidence', () => {
  const service = new ConditionService({} as never, {} as never);
  const at = (day: number): Analogue => ({
    time: Date.parse('2026-01-01T00:00:00Z') + day * 86_400_000,
    forwardReturn: 0.01,
    maxAdverse: -0.01,
  });

  it('warns when the matches are too few', () => {
    const spread = Array.from({ length: 50 }, (_, i) => at(i * 5));
    const got = service.summarise(spread, 24, 0.07);
    expect(got.warning).toContain(`below the ${MIN_MATCHES}`);
  });

  it('warns when enough matches sit in too few blocks', () => {
    // THE MAGNITUDE-GATE FAILURE, encoded. 150 matches inside 40 days is two
    // blocks, and a bootstrap over two blocks resamples the same weeks.
    const clustered = Array.from({ length: 150 }, (_, i) => at(i % 40));
    const got = service.summarise(clustered, 24, 0.07);
    expect(got.matches).toBe(150);
    expect(got.blocks).toBeLessThan(MIN_BLOCKS);
    expect(got.warning).toContain('Clustered in time');
  });

  it('stays silent when there is enough evidence, spread out', () => {
    const good = Array.from({ length: 200 }, (_, i) => at(i));
    const got = service.summarise(good, 24, 0.07);
    expect(got.blocks).toBeGreaterThanOrEqual(MIN_BLOCKS);
    expect(got.warning).toBeNull();
  });

  it('reports direction as the coin flip it is, rather than omitting it', () => {
    const mixed = Array.from({ length: 200 }, (_, i) => ({
      ...at(i),
      forwardReturn: i % 2 === 0 ? 0.01 : -0.01,
    }));
    const got = service.summarise(mixed, 24, 0.07);
    expect(got.outcomes?.direction?.up).toBeCloseTo(0.5, 10);
  });

  it('returns nothing rather than a shape full of NaN when there are no matches', () => {
    const got = service.summarise([], 24, 0.07);
    expect(got.matches).toBe(0);
    expect(got.outcomes).toBeNull();
    expect(got.warning).toBeTruthy();
  });
});

describe('contract: the map carries what it does not claim', () => {
  it('ships disclaimers with the payload, not as a frontend footer', () => {
    expect(MAP_DISCLAIMERS.some((d) => /does not forecast direction/i.test(d))).toBe(true);
    expect(MAP_DISCLAIMERS.some((d) => /\+-5%|5% of mid/i.test(d))).toBe(true);
    expect(MAP_DISCLAIMERS.some((d) => /[Ll]iquidation data is unavailable/.test(d))).toBe(true);
  });
});

describe('contract: the calibration page reports failures as prominently as the pass', () => {
  const report = new CalibrationReportService().report();

  it('lists every output, published or not', () => {
    expect(report.entries).toHaveLength(4);
    expect(report.entries.filter((e) => e.status === 'PUBLISHED')).toHaveLength(1);
    expect(report.entries.filter((e) => e.status === 'WITHHELD')).toHaveLength(3);
  });

  it('gives every entry its bar, its measurement and its evidence', () => {
    for (const e of report.entries) {
      // A stated bar, not a long one: "ECE under 5 points." says everything
      // it needs to. The measurement has to carry actual numbers.
      expect(e.bar).toMatch(/\S/);
      expect(e.measured).toMatch(/\d/);
      expect(e.measured.length).toBeGreaterThan(20);
      expect(e.evidence).toMatch(/docs\/evidence/);
      expect(e.fittedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('says plainly that three of four failed', () => {
    expect(report.summary).toContain('One of four');
  });
});
