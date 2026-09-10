/**
 * One batch of map payloads, ready to paste to the analyst.
 *
 *   pnpm --filter api sim-batch [--coins BTC,ETH] [--out file]
 */
import * as dotenv from 'dotenv';

dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'local'}` });

import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MapService } from '../src/map/map.service';
import { MarketMap } from '../src/map/map.types';

/** The ten the cone was fitted on. */
const FITTED_UNIVERSE = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK', 'DOT', 'LTC'];

const PROMPT = [
  'Act as an expert trading analyst. Below is an analysis my system produced.',
  'Retrieve current information if you need any. Tell me the trade plan to put.',
  '',
  'For any coin you would skip, still give the plan you would have placed, and',
  'mark it SKIP.',
  '',
  "I'm testing my system, so this trade goes into simulation.",
].join('\n');

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Strips `disclaimers`: one of them names the failed directional tests. */
function toPaste(map: MarketMap): Omit<MarketMap, 'disclaimers'> {
  const { disclaimers: _omitted, ...rest } = map;
  return rest;
}

async function main(): Promise<void> {
  Logger.overrideLogger(['error', 'warn']);

  const coins = (flag('coins') ?? FITTED_UNIVERSE.join(','))
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (coins.length === 0) throw new Error('No coins given.');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const mapService = app.get(MapService);

  const batchId = randomUUID();
  const blocks: string[] = [];
  const failed: string[] = [];

  for (const coin of coins) {
    try {
      // The whole universe, so the cone carries its cross-sectional tilt.
      const map = await mapService.read(coin, coins);
      blocks.push(
        [
          `${'='.repeat(72)}`,
          `${coin}  ·  batch ${batchId}  ·  spot ${map.spot}  ·  ${map.asOf}`,
          `${'='.repeat(72)}`,
          '',
          PROMPT,
          '',
          JSON.stringify(toPaste(map), null, 2),
        ].join('\n'),
      );
    } catch (err) {
      failed.push(`${coin}: ${(err as Error).message}`);
    }
  }

  await app.close();

  const output = blocks.join('\n\n');
  const out = flag('out');
  if (out) {
    writeFileSync(out, output);
    console.log(`${blocks.length} of ${coins.length} coins written to ${out}`);
  } else {
    console.log(output);
  }

  console.log(`\nbatch ${batchId}`);
  if (failed.length > 0) {
    console.log(`\n${failed.length} coin(s) unavailable and omitted:`);
    for (const f of failed) console.log(`  ${f}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
