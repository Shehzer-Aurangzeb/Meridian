import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SimService } from './sim.service';
import { validateBatch } from './sim.dto';

@ApiTags('sim')
@Controller('sim')
export class SimController {
  constructor(private readonly sim: SimService) {}

  @Post()
  @ApiOperation({
    summary: 'Record one batch of analyst calls',
    description:
      'Every row carries a plan, SKIP included, so both arms can be scored in R. ' +
      'Rejects anything that could never be scored rather than storing it.',
  })
  async create(@Body() body: unknown): Promise<{ batchId: string; trades: number }> {
    return this.sim.createBatch(validateBatch(body));
  }

  @Get()
  @ApiOperation({
    summary: 'The journal, newest first',
    description:
      'Resolves any row whose 96-hour window has closed before returning. There is no ' +
      'scheduled scorer — this read is the scorer.',
  })
  async list(
    @Query('take') take?: string,
    @Query('cursor') cursor?: string,
  ): Promise<unknown> {
    return this.sim.list(Number(take) || 100, cursor);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Take versus pass, paired within batches',
    description:
      'The delta is null below four time blocks. Big n across few blocks is the shape ' +
      'of a fake finding, not a small one.',
  })
  async stats(): Promise<unknown> {
    return this.sim.stats();
  }

  @Get(':id')
  async one(@Param('id') id: string): Promise<unknown> {
    const row = await this.sim.findOne(id);
    if (row === null) throw new NotFoundException(`No recorded trade "${id}".`);
    return row;
  }
}
