import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logRun, readRuns } from './run-log';

describe('run-log', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-log-'));
    file = path.join(dir, 'nested', 'runs.jsonl');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('appends rather than overwrites, and creates the directory', () => {
    logRun({ symbol: 'BTC', conditionsMet: 3 }, file);
    logRun({ symbol: 'ETH', conditionsMet: 1 }, file);

    const runs = readRuns(file);
    expect(runs).toHaveLength(2);
    expect(runs[0].symbol).toBe('BTC');
    expect(runs[1].symbol).toBe('ETH');
    // A past verdict must stay exactly as issued.
    expect(runs[0].conditionsMet).toBe(3);
  });

  it('stamps every record with a timestamp', () => {
    logRun({ symbol: 'SOL' }, file);
    expect(typeof readRuns(file)[0].ts).toBe('string');
  });

  it('returns empty for a log that does not exist yet', () => {
    expect(readRuns(path.join(dir, 'absent.jsonl'))).toEqual([]);
  });

  it('is fail-soft — a bad path must not throw', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // A directory where a file must go: mkdir succeeds, appendFile cannot.
    expect(() => logRun({ symbol: 'BTC' }, dir)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
