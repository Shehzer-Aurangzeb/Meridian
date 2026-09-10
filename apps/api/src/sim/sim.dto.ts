import { BadRequestException } from '@nestjs/common';

export interface TargetInput {
  price: number;
  weightPercent: number;
}

export interface SimTradeInput {
  symbol: string;
  verdict: 'TAKE' | 'SKIP';
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  targets: TargetInput[];
  rationale?: string;
  mapSnapshot: unknown;
  spotAtDecision: number;
  usedOutsideData?: boolean;
  decidedAt?: string;
}

export interface CreateBatchInput {
  trades: SimTradeInput[];
}

const SYMBOL = /^[A-Z0-9]{2,15}$/;
/** Targets must sum to this, within a rounding tolerance. */
const WEIGHT_TOTAL = 100;
const WEIGHT_TOLERANCE = 0.01;

const fail = (where: string, why: string): never => {
  throw new BadRequestException(`${where}: ${why}`);
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate one recorded call.
 *
 * Rejects rather than storing anything that could never be scored. A row that
 * sits at `netR: null` forever is indistinguishable from one still in its
 * window, and the difference matters: one is waiting, the other is broken.
 */
export function validateTrade(raw: unknown, index: number): SimTradeInput {
  const where = `trades[${index}]`;
  if (typeof raw !== 'object' || raw === null) fail(where, 'not an object');
  const t = raw as Record<string, unknown>;

  const symbol = typeof t.symbol === 'string' ? t.symbol.toUpperCase() : '';
  if (!SYMBOL.test(symbol)) fail(where, `invalid symbol "${String(t.symbol)}"`);

  if (t.verdict !== 'TAKE' && t.verdict !== 'SKIP') {
    fail(where, 'verdict must be TAKE or SKIP');
  }
  if (t.direction !== 'long' && t.direction !== 'short') {
    fail(where, 'direction must be long or short');
  }

  // Every row carries a plan, SKIP included — a pass without one cannot be
  // scored in R, and then the take-versus-pass comparison has only one arm.
  if (!finite(t.entry) || t.entry <= 0) fail(where, 'entry must be a positive number');
  if (!finite(t.stop) || t.stop <= 0) fail(where, 'stop must be a positive number');
  const entry = t.entry as number;
  const stop = t.stop as number;
  if (entry === stop) fail(where, 'stop equals entry, so the trade has no risk to measure');
  if (t.direction === 'long' && stop > entry) {
    fail(where, `a long stop must sit below its entry (got stop ${stop} above entry ${entry})`);
  }
  if (t.direction === 'short' && stop < entry) {
    fail(where, `a short stop must sit above its entry (got stop ${stop} below entry ${entry})`);
  }

  if (!finite(t.spotAtDecision) || (t.spotAtDecision as number) <= 0) {
    fail(where, 'spotAtDecision must be a positive number');
  }
  if (t.mapSnapshot === undefined || t.mapSnapshot === null) {
    fail(where, 'mapSnapshot is required — a record without one cannot be checked later');
  }

  const targets = validateTargets(t.targets, t.direction as 'long' | 'short', entry, where);

  let decidedAt: string | undefined;
  if (t.decidedAt !== undefined) {
    if (typeof t.decidedAt !== 'string' || Number.isNaN(Date.parse(t.decidedAt))) {
      fail(where, 'decidedAt must be an ISO timestamp');
    }
    decidedAt = t.decidedAt as string;
  }

  return {
    symbol,
    verdict: t.verdict as 'TAKE' | 'SKIP',
    direction: t.direction as 'long' | 'short',
    entry,
    stop,
    targets,
    rationale: typeof t.rationale === 'string' ? t.rationale : undefined,
    mapSnapshot: t.mapSnapshot,
    spotAtDecision: t.spotAtDecision as number,
    usedOutsideData: t.usedOutsideData === true,
    decidedAt,
  };
}

function validateTargets(
  raw: unknown,
  direction: 'long' | 'short',
  entry: number,
  where: string,
): TargetInput[] {
  if (!Array.isArray(raw)) fail(where, 'targets must be an array');
  const list = raw as unknown[];
  // A plan with no target can only stop out or expire. Allowed, because that is
  // a real if poor plan and refusing it would edit the analyst's answer.
  if (list.length === 0) return [];

  const out: TargetInput[] = [];
  list.forEach((item, i) => {
    const at = `${where}.targets[${i}]`;
    if (typeof item !== 'object' || item === null) fail(at, 'not an object');
    const { price, weightPercent } = item as Record<string, unknown>;
    if (!finite(price) || price <= 0) fail(at, 'price must be a positive number');
    if (!finite(weightPercent) || weightPercent <= 0) {
      fail(at, 'weightPercent must be a positive number');
    }
    if (direction === 'long' && (price as number) <= entry) {
      fail(at, `a long target must sit above its entry (got ${price} at or below ${entry})`);
    }
    if (direction === 'short' && (price as number) >= entry) {
      fail(at, `a short target must sit below its entry (got ${price} at or above ${entry})`);
    }
    out.push({ price: price as number, weightPercent: weightPercent as number });
  });

  const total = out.reduce((a, t) => a + t.weightPercent, 0);
  if (Math.abs(total - WEIGHT_TOTAL) > WEIGHT_TOLERANCE) {
    // Selling 140% of a position produces an R-multiple that looks like skill.
    fail(where, `target weights sum to ${total}, not ${WEIGHT_TOTAL}`);
  }
  return out;
}

export function validateBatch(raw: unknown): SimTradeInput[] {
  if (typeof raw !== 'object' || raw === null) fail('body', 'not an object');
  const trades = (raw as Record<string, unknown>).trades;
  if (!Array.isArray(trades) || trades.length === 0) {
    fail('body', 'trades must be a non-empty array');
  }
  const list = trades as unknown[];
  if (list.length > 50) fail('body', `${list.length} trades in one batch, maximum 50`);
  return list.map(validateTrade);
}
