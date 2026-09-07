import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MapService } from './map.service';
import { LiquidityService } from '../liquidity/liquidity.service';
import { ConditionService } from './condition.service';
import { CalibrationReportService } from './calibration-report.service';
import { ConditionQuery, MarketMap } from './map.types';

/**
 * The market map. Everything Meridian is willing to state, and nothing else.
 *
 * `GET /map/:symbol` is the aggregate the screen calls: one request, one
 * payload. The sub-routes exist for clients that want one panel, not to be
 * chained together — six round trips inside a 120-second Lambda ceiling is how
 * a cold start becomes a failed page.
 */
@ApiTags('map')
@Controller('map')
export class MapController {
  constructor(
    private readonly map: MapService,
    private readonly liquidity: LiquidityService,
    private readonly condition: ConditionService,
    private readonly calibration: CalibrationReportService,
  ) {}

  @Get(':symbol')
  @ApiOperation({
    summary: 'The whole map for one coin',
    description:
      'Regime, expected-move cone, zones and depth in one payload. Emits no direction, ' +
      'no target and no entry. Probabilities that did not pass their calibration bar are ' +
      'null with a reason attached.',
  })
  async get(
    @Param('symbol') symbol: string,
    @Query('universe') universe?: string,
  ): Promise<MarketMap> {
    return this.map.build(symbol, universe ? universe.split(',') : undefined);
  }

  @Get(':symbol/zones')
  async zones(@Param('symbol') symbol: string): Promise<MarketMap['zones']> {
    return (await this.map.build(symbol)).zones;
  }

  @Get(':symbol/regime')
  async regime(@Param('symbol') symbol: string): Promise<MarketMap['regime']> {
    return (await this.map.build(symbol)).regime;
  }

  @Get(':symbol/liquidity')
  @ApiOperation({
    summary: 'Resting depth by shell',
    description:
      'Published only to +-5% of mid. A `distance` beyond that returns 400 rather than ' +
      'an extrapolation — the book out there is unknown, not thin.',
  })
  async liquidityFor(
    @Param('symbol') symbol: string,
    @Query('distance') distance?: string,
  ): Promise<unknown> {
    if (distance !== undefined) {
      this.liquidity.assertWithinRange(Number(distance));
    }
    return this.liquidity.profile(symbol);
  }

  @Get(':symbol/shelf-map')
  async shelfMap(
    @Param('symbol') symbol: string,
    @Query('days') days?: string,
  ): Promise<unknown> {
    return this.liquidity.shelfMap(symbol, days ? Number(days) : 30);
  }

  @Post(':symbol/condition')
  @ApiOperation({
    summary: 'Historical analogues for a described state',
    description:
      'Finds past hours matching the condition and reports what followed. Never ' +
      'simulates. Sets `warning` when the matches are too few or too clustered in time ' +
      'to support a reading.',
  })
  async conditional(
    @Param('symbol') symbol: string,
    @Body() query: ConditionQuery,
  ): Promise<unknown> {
    return this.condition.find(symbol, query);
  }
}

/**
 * The page that makes the rest of the product credible.
 *
 * Separate controller because it is not about one coin: it reports how every
 * calibrated output has actually performed, including the ones that failed and
 * are therefore published as nulls.
 */
@ApiTags('calibration')
@Controller('calibration')
export class CalibrationController {
  constructor(private readonly calibration: CalibrationReportService) {}

  @Get()
  report(): unknown {
    return this.calibration.report();
  }

  @Get(':output')
  one(@Param('output') output: string): unknown {
    return this.calibration.forOutput(output);
  }
}
