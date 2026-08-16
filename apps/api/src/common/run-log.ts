import * as fs from 'fs';
import * as path from 'path';

/**
 * A running log of what the analysis said and when, one entry per line.
 *
 * A plain file rather than the database, so the command-line tool works
 * without one. Only ever added to, never rewritten — keeping what was said at
 * the time is the entire point.
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
