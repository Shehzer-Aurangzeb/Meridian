/**
 * The probabilities Meridian measured and will not publish.
 *
 * Kept in one file, as constants, so that "we do not have a number for this"
 * is a fact the code states once rather than a null that appears in three
 * services and means something slightly different in each. Every entry names
 * the measurement that produced it and the document that records it.
 *
 * A layer that later passes its bar deletes its entry here. Nothing else in
 * the API needs to change, because the field is already a `Probability`.
 */
import { Withheld, Calibrated, Probability } from './map.types';
import { MIN_SAMPLE_FOR_PROBABILITY } from '../calibration/calibration';

export const ZONE_BOUNCE_WITHHELD: Withheld = {
  value: null,
  reason:
    'Not published. Measured on the 182-day holdout, the zone-bounce forecast was ' +
    'honest (ECE 1.13 points) and carried no information: its Brier score was worse ' +
    'than always quoting the base rate, and all twelve bucket keys predicted within ' +
    '3.7 points of each other against a 75.8% base rate. Zone type, confluence count ' +
    'and regime say nothing about whether a level holds. Shelf thickness was tested ' +
    'separately and also failed.',
  evidence: 'docs/evidence/LAYER2_CALIBRATION.md, docs/evidence/LAYER3_LIQUIDITY.md',
};

export const REGIME_EXIT_WITHHELD: Withheld = {
  value: null,
  reason:
    'Not published. Expected calibration error was 5.06 points against a bar of 5.00. ' +
    'It beats the base rate on Brier, so it is informative, but every TRENDING bucket ' +
    'under 48 hours exited 5 to 11 points more often in the holdout than the fitted ' +
    'table expected — trends were less persistent than in training. The bar was not ' +
    'renegotiated after the result.',
  evidence: 'docs/evidence/LAYER2_CALIBRATION.md',
};

export const UNWIND_LIFT_WITHHELD: Withheld = {
  value: null,
  reason:
    'Not published. Conditional on extreme crowding, a 5% adverse move within 24 hours ' +
    'followed 11.7% of the time against an 11.1% base rate, with a 95% interval of ' +
    '[7.5%, 19.4%] that contains the base rate. 103 matches over 6 blocks, so the ' +
    'sample was adequate and the lift is simply absent.',
  evidence: 'docs/evidence/LAYER3_LIQUIDITY.md',
};

/**
 * The disclaimers that ride with every map.
 *
 * Carried in the payload rather than left to the frontend, because a client
 * that renders the numbers without them is the failure mode this whole product
 * exists to avoid, and a backend cannot enforce a footer it does not send.
 */
export const MAP_DISCLAIMERS: string[] = [
  'This map describes the market. It does not forecast direction, and no field in it is a trade signal.',
  'Twenty pre-registered tests found no directional edge in this data that survives a 14 bp round trip.',
  'The expected-move cone is a SIZE forecast: how far price is likely to travel, not which way.',
  'Order-book depth is published only to +-5% of mid. Beyond that, this system has no data at all.',
  'Liquidation data is unavailable. Falling open interest is the footprint of forced unwinding, seen after the fact.',
  'Base rates are for ten liquid majors and need not hold elsewhere.',
];

/**
 * Build a published probability, or refuse.
 *
 * The single place a `Calibrated` is allowed to come into existence, so the
 * `n < 200` policy cannot be forgotten at one call site: below the minimum
 * there is no `value` field to populate at all.
 */
export function publish(
  value: number,
  n: number,
  fittedAt: string,
  ci95?: [number, number],
): Probability {
  if (!Number.isFinite(value) || n < MIN_SAMPLE_FOR_PROBABILITY) {
    return {
      value: null,
      reason:
        `Not published: ${n.toLocaleString()} observations is below the ${MIN_SAMPLE_FOR_PROBABILITY} ` +
        'required. Effective sample size on this data runs one to two orders of magnitude below the raw count.',
      evidence: 'docs/PRODUCT_LAYERS.md',
    };
  }
  const out: Calibrated = { value, n, fittedAt };
  if (ci95) out.ci95 = ci95;
  return out;
}

/** True when a probability actually carries a number. */
export const isPublished = (p: Probability): p is Calibrated => p.value !== null;
