import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface CacheStats {
  hits: number;
  misses: number;
}

/**
 * Counts how often cached data was reused during one request. Wrap a piece of
 * work in `run()` and anything inside it can record against that count.
 * Outside one, recording does nothing, so it is always safe to call.
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
