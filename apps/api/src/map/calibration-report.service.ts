import { Injectable } from '@nestjs/common';

export interface CalibrationEntry {
  output: string;
  status: 'PUBLISHED' | 'WITHHELD';
  bar: string;
  measured: string;
  /** Reliability points, where the output produced a curve. */
  curve: Array<{ predicted: number; realised: number; n: number }> | null;
  fittedAt: string;
  evidence: string;
  note: string;
}

/**
 * How every calibrated output has actually performed — including, and
 * especially, the ones that failed.
 *
 * ─── Why this is a first-class page and not an appendix ──────────────────
 * Every probability the product shows links here. A system that says "71%"
 * and cannot show whether its 71%s come in at 71% is asking to be trusted
 * rather than earning it, and this project's history is a list of numbers that
 * looked authoritative and were wrong: a strength score compared against a
 * touch-count threshold, a random control drawn from the wrong population, an
 * interval on a difference computed as two intervals subtracted.
 *
 * The failures are listed with the same prominence as the pass. Three of the
 * four entries here are withheld outputs, and a reader who sees only a working
 * cone has not been told what this system tried and could not do.
 *
 * Static because these are holdout results. A holdout touched once produces one
 * number, and recomputing it live would mean touching it again.
 */
@Injectable()
export class CalibrationReportService {
  private static readonly ENTRIES: CalibrationEntry[] = [
    {
      output: 'expected-move-cone',
      status: 'PUBLISHED',
      bar: 'Coverage within 3 points of nominal at 50/80/90%, on a 182-day holdout.',
      measured:
        '4h: 51.4 / 80.4 / 90.7.  12h: 50.6 / 81.1 / 91.1.  24h: 50.0 / 81.5 / 91.9. ' +
        'Nine of nine inside the bar, worst deviation 1.9 points.',
      curve: [
        { predicted: 0.5, realised: 0.514, n: 43640 },
        { predicted: 0.8, realised: 0.804, n: 43640 },
        { predicted: 0.9, realised: 0.907, n: 43640 },
      ],
      fittedAt: '2026-09-06',
      evidence: 'docs/evidence/LAYER2_CALIBRATION.md',
      note:
        'The bands run slightly wide at every level, so the cone is a touch conservative ' +
        'at the tails. That is the safer direction to err and it is inside the bar.',
    },
    {
      output: 'zone-bounce-4h',
      status: 'WITHHELD',
      bar: 'ECE under 5 points AND a Brier score better than always quoting the base rate.',
      measured:
        'ECE 1.13 points — honest. Brier 0.18375 against a base-rate 0.18369 — WORSE. ' +
        'All twelve bucket keys predicted between 73.0% and 76.7%, a spread of 3.7 points ' +
        'against a 75.8% base rate, so the whole holdout fell in one reliability bucket.',
      curve: [{ predicted: 0.746, realised: 0.758, n: 6029 }],
      fittedAt: '2026-09-06',
      evidence: 'docs/evidence/LAYER2_CALIBRATION.md',
      note:
        'A model that only ever emits the base rate is perfectly calibrated and useless. ' +
        'That is what this is, and the Brier condition exists to catch it. Shelf thickness ' +
        'was tested separately in Layer 3 and also carried nothing.',
    },
    {
      output: 'regime-exit-24h',
      status: 'WITHHELD',
      bar: 'ECE under 5 points.',
      measured:
        'ECE 5.06 points. Brier 0.2416 against a base-rate 0.2440, so it IS informative — ' +
        'but every TRENDING bucket under 48h exited 5 to 11 points more often in the ' +
        'holdout than the fitted table expected.',
      curve: [
        { predicted: 0.463, realised: 0.548, n: 14992 },
        { predicted: 0.565, realised: 0.534, n: 19049 },
        { predicted: 0.738, realised: 0.707, n: 8151 },
        { predicted: 0.807, realised: 0.744, n: 1144 },
        { predicted: 0.934, realised: 0.933, n: 104 },
      ],
      fittedAt: '2026-09-06',
      evidence: 'docs/evidence/LAYER2_CALIBRATION.md',
      note:
        'Trends were markedly less persistent in the holdout than in training. This is ' +
        'calibration decay, not a pipeline defect, and the bar was not renegotiated after ' +
        'the result. The open question is refit cadence.',
    },
    {
      output: 'unwind-lift-24h',
      status: 'WITHHELD',
      bar:
        'Conditional adverse rate above the base rate by an interval excluding zero, ' +
        'with at least 100 matches over at least 4 distinct 30-day blocks.',
      measured:
        '103 matches over 6 blocks, so the sample condition passed. Conditional rate ' +
        '11.7% against an 11.1% base rate, 95% interval [7.5%, 19.4%] — which contains ' +
        'the base rate.',
      curve: null,
      fittedAt: '2026-09-06',
      evidence: 'docs/evidence/LAYER3_LIQUIDITY.md',
      note:
        'Crowded positioning does not measurably raise the chance of a sharp fall on this ' +
        'data. No liquidation feed exists, so a cascade claim would be uncheckable in ' +
        'principle as well as unsupported in fact.',
    },
  ];

  report(): { entries: CalibrationEntry[]; summary: string } {
    return {
      entries: CalibrationReportService.ENTRIES,
      summary:
        'One of four outputs is published as a probability. The other three were measured, ' +
        'failed their pre-registered bars, and are served as nulls with the reason attached. ' +
        'Calibration decays; every entry carries the date its table was fitted.',
    };
  }

  forOutput(output: string): CalibrationEntry | { error: string } {
    const found = CalibrationReportService.ENTRIES.find((e) => e.output === output);
    return found ?? { error: `No calibrated output named "${output}".` };
  }
}
