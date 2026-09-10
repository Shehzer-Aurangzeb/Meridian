import type { MarketMap } from '@/types/map';

/**
 * The prompt sent to the analyst. Frozen — see docs/SIM_PROMPT.md.
 *
 * A prompt that drifts between batches makes every batch its own experiment,
 * so this string is duplicated nowhere and edited only deliberately.
 *
 * The PLAN block at the end is the machine-readable half. Everything the
 * journal stores appears in it, in a fixed order, so a reply can be read back
 * without anyone deciding what the analyst "meant" — see sim.parse.ts.
 */
export const SIM_PROMPT = [
  'Act as an expert trading analyst. Below is an analysis my system produced.',
  'Retrieve current information if you need any. Tell me the trade plan to put.',
  '',
  'For any coin you would skip, still give the plan you would have placed, and',
  'mark it SKIP.',
  '',
  "I'm testing my system, so this trade goes into simulation.",
  '',
  'Reason in prose first, however you like. Then close each coin with this',
  'block, on its own lines, using these exact labels:',
  '',
  'PLAN',
  'symbol: BTC',
  'verdict: TAKE',
  'direction: long',
  'entry: 84120',
  'stop: 82400',
  'targets: 87000 @ 50%, 90500 @ 50%',
  'why: one line, your reason',
  'END',
  '',
  'Rules for that block, because it is read by a machine:',
  '- One block per coin, even for a SKIP.',
  '- Plain numbers. No currency signs, no thousands separators, no ranges.',
  '- A single price per target. If you want a zone, pick the number you would',
  '  actually work the order at.',
  '- Target percentages are how much of the position closes there, and they',
  '  must add up to 100.',
  '- The stop goes below the entry for a long and above it for a short.',
  '- Entry, stop and at least one target are required. Do not leave them out,',
  '  and do not write "market" — give the price you would use.',
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
