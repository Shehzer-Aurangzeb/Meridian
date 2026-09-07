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
    'We tested this over six months of history the model had never seen. The forecast ' +
    'was honest — when it said 75%, it happened about 75% of the time — but it was the ' +
    'same 75% in every situation. Whether a level was above or below the price, how ' +
    'many methods found it, and what state the market was in made no difference: every ' +
    'answer landed within 4 points of the long-run average of 75.8%. A number that ' +
    'never changes tells you nothing you did not already know. We also checked whether ' +
    'a wall of waiting buy orders behind a level made it more likely to hold. It did not.',
  evidence: 'docs/evidence/LAYER2_CALIBRATION.md, docs/evidence/LAYER3_LIQUIDITY.md',
};

export const REGIME_EXIT_WITHHELD: Withheld = {
  value: null,
  reason:
    'This one nearly worked, and unlike the others it does carry real information. But ' +
    'when we checked it against six months the model had never seen, its promises were ' +
    'off by 5.1 points where we had decided in advance to allow 5. The reason is that ' +
    'the market changed character: trends broke down 5 to 11 points more often in the ' +
    'test period than in the years we learned from. We set that limit before seeing the ' +
    'result and did not move it afterwards.',
  evidence: 'docs/evidence/LAYER2_CALIBRATION.md',
};

export const UNWIND_LIFT_WITHHELD: Withheld = {
  value: null,
  reason:
    'We looked for occasions when an unusual number of traders were betting the same ' +
    'way, and asked how often a sharp 5% fall followed within a day. It happened 11.7% ' +
    'of the time — against 11.1% of the time in ordinary conditions. That difference is ' +
    'well inside the margin of error. We had 103 such occasions spread across six ' +
    'months, so this is not a shortage of evidence: the warning simply is not there.',
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
  'Twenty tests, each with its target set in advance, found nothing that predicts direction well enough to cover trading costs.',
  'The expected move is about SIZE: how far the price is likely to travel, not which way.',
  'We can only see waiting orders within 5% of the current price. Beyond that, this system has no information at all.',
  'We cannot see forced sell-offs as they happen. We only see the traces they leave behind, afterwards.',
  'These figures come from ten large, heavily traded coins and need not hold for smaller ones.',
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
        `Based on only ${n.toLocaleString()} real cases, where we require at least ` +
        `${MIN_SAMPLE_FOR_PROBABILITY}. Market data repeats itself far more than a raw count suggests, ` +
        'so a few hundred observations carry much less evidence than they appear to.',
      evidence: 'docs/PRODUCT_LAYERS.md',
    };
  }
  const out: Calibrated = { value, n, fittedAt };
  if (ci95) out.ci95 = ci95;
  return out;
}

/** True when a probability actually carries a number. */
export const isPublished = (p: Probability): p is Calibrated => p.value !== null;
