import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface CacheStats {
  hits: number;
  misses: number;
}

/**
 * Per-request cache hit/miss counter scoped via AsyncLocalStorage.
 *
 * Callers wrap a unit of work in `run()` and any code path executed
 * inside that callback can record hits / misses on the active scope.
 * Outside any scope the recorders are no-ops, so this is safe to call
 * from background jobs and unrelated request paths.
 */
@Injectable()
export class CacheTelemetryService {
  private readonly storage = new AsyncLocalStorage<CacheStats>();

  /**
   * Run `fn` with a fresh stats scope and return both the result and
   * the collected counters.
   */
  async run<T>(fn: () => Promise<T>): Promise<{ value: T; stats: CacheStats }> {
    const stats: CacheStats = { hits: 0, misses: 0 };
    const value = await this.storage.run(stats, fn);
    return { value, stats };
  }

  recordHit(): void {
    const stats = this.storage.getStore();
    if (stats) stats.hits++;
  }

  recordMiss(): void {
    const stats = this.storage.getStore();
    if (stats) stats.misses++;
  }

  /** Read the current scope's stats without ending it. */
  getStats(): CacheStats | null {
    return this.storage.getStore() ?? null;
  }
}
