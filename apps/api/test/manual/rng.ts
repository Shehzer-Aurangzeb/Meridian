/**
 * Moved to `src/common/stats/block-bootstrap.ts` on 8 September 2026, so the
 * API and the harness share one generator. Re-exported here because thirteen
 * research scripts import it by this path and a sealed script should not be
 * edited to chase a move.
 */
export { makeRng } from '../../src/common/stats/block-bootstrap';
