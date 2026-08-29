import { Bucket, BUCKETS, bucketOf, bucketWhere } from './buckets';

/**
 * `bucketOf` decides in TypeScript, `bucketWhere` decides in SQL. They are two
 * spellings of one rule, and nothing stops them drifting apart — so this
 * evaluates the SQL form by hand over every row a database could hold and
 * checks it picks exactly the rows `bucketOf` would.
 */

const OUTCOMES = [
  'PENDING',
  'MISSED',
  'OPEN',
  'STOPPED',
  'PARTIAL',
  'ALL_TARGETS',
  'EXPIRED',
  'UNSCOREABLE',
  null,
];
const NET_RS = [-2, -0.001, 0, 0.001, 2, null];

type Row = { outcome: string | null; netR: number | null };
const ALL: Row[] = OUTCOMES.flatMap((outcome) => NET_RS.map((netR) => ({ outcome, netR })));

/** Enough of a Prisma where-clause evaluator for the shapes bucketWhere emits. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Record<string, unknown>[]).some((c) => matches(row, c));
    const value = row[key as keyof Row];
    if (cond === null || typeof cond === 'string') return value === cond;
    const ops = cond as { gte?: number; lt?: number };
    if (value === null) return false;
    if (ops.gte !== undefined) return (value as number) >= ops.gte;
    if (ops.lt !== undefined) return (value as number) < ops.lt;
    throw new Error(`unhandled condition ${JSON.stringify(cond)}`);
  });
}

describe('buckets', () => {
  it('puts every possible row in exactly one bucket', () => {
    for (const row of ALL) {
      const hits = BUCKETS.filter((b) => bucketOf(row.outcome, row.netR) === b);
      expect(hits).toHaveLength(1);
    }
  });

  it('the SQL filter selects exactly the rows the TS rule buckets there', () => {
    for (const bucket of BUCKETS) {
      const byRule = ALL.filter((r) => bucketOf(r.outcome, r.netR) === bucket);
      const bySql = ALL.filter((r) => matches(r, bucketWhere(bucket) as Record<string, unknown>));
      expect(new Set(bySql)).toEqual(new Set(byRule));
    }
  });

  it('splits open trades on the sign of net R, with zero counting as profit', () => {
    expect(bucketOf('OPEN', 0)).toBe('openUp');
    expect(bucketOf('OPEN', -0.001)).toBe('openDown');
    // A partial is closed, so it lands in won or lost, never in open.
    expect(bucketOf('PARTIAL', 0.001)).toBe('wonClosed');
    expect(bucketOf('PARTIAL', -0.001)).toBe('lostClosed');
  });

  it('counts a row with no plan and a row with no candles the same way', () => {
    // Neither can flatter or damage the split, so both are simply absent.
    expect(bucketOf(null, null)).toBe('unscored');
    expect(bucketOf('UNSCOREABLE', null)).toBe('unscored');
  });
});

/** Guards the label list the frontend renders against a bucket being added. */
it('BUCKETS lists every member of the union', () => {
  const known: Record<Bucket, true> = {
    openUp: true,
    openDown: true,
    wonClosed: true,
    lostClosed: true,
    expired: true,
    neverStarted: true,
    tooEarly: true,
    unscored: true,
  };
  expect(BUCKETS.sort()).toEqual(Object.keys(known).sort());
});
