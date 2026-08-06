import * as fs from 'fs';
import * as path from 'path';

/**
 * Append-only JSONL record of what the analyst said, and when.
 *
 * Deliberately a file rather than Postgres: `pnpm analyze` must run without
 * Docker. The DB path (`CoordinatorRun`) still exists for the served API —
 * this is the CLI's record.
 *
 * One JSON object per line, so it can be grepped, `jq`'d, or read back with
 * a split on newlines. Never overwritten, so a run's verdict stays exactly
 * as it was issued — that is the whole point of keeping it.
 */
const DEFAULT_PATH = process.env.MERIDIAN_LOG ?? 'logs/runs.jsonl';

export function logRun(record: Record<string, unknown>, file = DEFAULT_PATH): void {
  // ponytail: fail-soft. A full disk must not take down an analysis; the
  // log is a record, not a dependency. Surfaced on stderr so it can't rot
  // silently.
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n',
    );
  } catch (err) {
    console.error(
      `run-log: could not write ${file} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Read a JSONL log back. Skips blank lines; throws on malformed JSON. */
export function readRuns(file = DEFAULT_PATH): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}
