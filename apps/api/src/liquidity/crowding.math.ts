/**
 * Crowding: how stretched positioning is. A DESCRIPTION, never a signal.
 *
 * ─── What this is not, and the measurement that settles it ───────────────
 * The obvious use of a crowding number is contrarian — "everyone is long, so
 * fade it". This project has priced that: Phase B's cross-sectional funding
 * signal, traded contrarian on crowding, earned 1.83 bp against a 14 bp round
 * trip. It is not a trade.
 *
 * The second obvious use is a warning — "crowded positioning means a cascade
 * is coming". Bar 3b tested exactly that and failed: conditional on funding
 * above its 90th percentile, open interest up 5% in a day, and price at the
 * top of its band, a 5% adverse move followed 11.7% of the time against an
 * 11.1% base rate, with a bootstrap interval of [7.5%, 19.4%] that contains
 * the base rate comfortably. **There is no measured lift.**
 *
 * So this emits percentiles and nothing else: how unusual today's funding, open
 * interest change and positioning are, against this coin's own history. A
 * reader can see that positioning is stretched. The system does not tell them
 * what it means, because it measured that and found nothing.
 *
 * ─── And it never mentions liquidations ──────────────────────────────────
 * Binance removed the free liquidation feed. There is no series to calibrate
 * against, so a cascade claim would be uncheckable by construction. Open
 * interest FALLING is the observable footprint of forced deleveraging after
 * the fact, and that is the strongest available phrasing.
 */
import { percentileOf } from './depth.math';

export interface CrowdingInput {
  /** Latest funding rate, and its own trailing history. */
  funding: number;
  fundingHistory: number[];
  /** Open interest now and 24 hours ago; the change is what carries meaning. */
  openInterest: number;
  openInterest24hAgo: number;
  openInterestChangeHistory: number[];
  /** Optional: top-trader positioning ratio and its history. */
  topTraderRatio?: number;
  topTraderHistory?: number[];
}

export interface Crowding {
  fundingPercentile: number;
  oiChange24h: number | null;
  oiChangePercentile: number | null;
  topTraderPercentile: number | null;
  /** Mean of the components present, 0-100. Higher means more stretched. */
  score: number;
  /** Which components were actually measurable. */
  components: string[];
  /**
   * Carried on every reading so no consumer can present this as a forecast.
   * Bar 3b measured the conditional adverse rate and found no lift.
   */
  note: string;
}

export const CROWDING_NOTE =
  'Descriptive only. Conditional on extreme crowding, a 5% adverse move within 24h ' +
  'followed 11.7% of the time against an 11.1% base rate (95% interval [7.5%, 19.4%], ' +
  '103 matches) — no measured lift. Liquidation data is unavailable; open interest ' +
  'falling is the observable footprint of forced unwinding, after the fact.';

export function computeCrowding(input: CrowdingInput): Crowding {
  const components: string[] = [];

  const fundingPercentile = percentileOf(input.funding, input.fundingHistory);
  if (input.fundingHistory.length > 0) components.push('funding');

  let oiChange: number | null = null;
  let oiChangePercentile: number | null = null;
  if (input.openInterest > 0 && input.openInterest24hAgo > 0) {
    oiChange = input.openInterest / input.openInterest24hAgo - 1;
    if (input.openInterestChangeHistory.length > 0) {
      oiChangePercentile = percentileOf(oiChange, input.openInterestChangeHistory);
      components.push('openInterestChange');
    }
  }

  let topTraderPercentile: number | null = null;
  if (
    input.topTraderRatio !== undefined &&
    input.topTraderHistory !== undefined &&
    input.topTraderHistory.length > 0
  ) {
    topTraderPercentile = percentileOf(input.topTraderRatio, input.topTraderHistory);
    components.push('topTrader');
  }

  // Averaged over what is PRESENT, not over a fixed denominator. Treating a
  // missing component as zero would report a crowded market as calm.
  const present = [
    components.includes('funding') ? fundingPercentile : null,
    oiChangePercentile,
    topTraderPercentile,
  ].filter((v): v is number => v !== null);

  return {
    fundingPercentile,
    oiChange24h: oiChange,
    oiChangePercentile,
    topTraderPercentile,
    score: present.length === 0 ? 0 : present.reduce((s, v) => s + v, 0) / present.length,
    components,
    note: CROWDING_NOTE,
  };
}
