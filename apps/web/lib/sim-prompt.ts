import type { MarketMap } from '@/types/map';

/**
 * The prompt sent to the analyst. Frozen — see docs/SIM_PROMPT.md.
 *
 * A prompt that drifts between batches makes every batch its own experiment,
 * so this string is duplicated nowhere and edited only deliberately.
 */
export const SIM_PROMPT = [
  'Act as an expert trading analyst. Below is an analysis my system produced.',
  'Retrieve current information if you need any. Tell me the trade plan to put.',
  '',
  'For any coin you would skip, still give the plan you would have placed, and',
  'mark it SKIP.',
  '',
  "I'm testing my system, so this trade goes into simulation.",
].join('\n');

/**
 * What the analyst is shown.
 *
 * `disclaimers` is dropped: one of them states that twenty pre-registered tests
 * found nothing predictive, which is the failure brief this experiment
 * deliberately withholds. The STORED snapshot keeps it — the snapshot records
 * what the system held, the paste records what the analyst saw, and they differ
 * by exactly this field, always.
 */
export function pasteablePayload(map: MarketMap): Omit<MarketMap, 'disclaimers'> {
  const { disclaimers: _withheld, ...rest } = map;
  return rest;
}

export function promptFor(map: MarketMap): string {
  return `${SIM_PROMPT}\n\n${JSON.stringify(pasteablePayload(map), null, 2)}`;
}
