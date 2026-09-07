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
      bar:
        'When we say a move stays within a range 50, 80 or 90% of the time, it has to ' +
        'actually happen that often — within 3 points either way — over six months the ' +
        'model had never seen.',
      measured:
        'Over the next 4 hours we were right 51.4%, 80.4% and 90.7% of the time against ' +
        'promises of 50, 80 and 90%. Over 12 hours: 50.6%, 81.1%, 91.1%. Over 24 hours: ' +
        '50.0%, 81.5%, 91.9%. Nine checks out of nine passed, and the worst was off by ' +
        'only 1.9 points.',
      curve: [
        { predicted: 0.5, realised: 0.514, n: 43640 },
        { predicted: 0.8, realised: 0.804, n: 43640 },
        { predicted: 0.9, realised: 0.907, n: 43640 },
      ],
      fittedAt: '2026-09-06',
      evidence: 'docs/evidence/LAYER2_CALIBRATION.md',
      note:
        'The ranges come out slightly wider than they strictly need to be, so the product ' +
        'errs towards caution. That is the safer way to be wrong, and it is well inside ' +
        'what we allowed.',
    },
    {
      output: 'zone-bounce-4h',
      status: 'WITHHELD',
      bar:
        'Two things at once: the promises had to be off by under 5 points, AND the number ' +
        'had to beat simply quoting the long-run average every time.',
      measured:
        'The promises were off by only 1.1 points, so the number was honest. But it never ' +
        'moved: across every situation we checked, the answer stayed between 73.0% and ' +
        '76.7% — a spread of under 4 points around a long-run average of 75.8%. It was ' +
        'very slightly worse than just quoting that average.',
      curve: [{ predicted: 0.746, realised: 0.758, n: 6029 }],
      fittedAt: '2026-09-06',
      evidence: 'docs/evidence/LAYER2_CALIBRATION.md',
      note:
        'A forecast that always answers with the long-run average is perfectly honest and ' +
        'completely useless, and that is exactly what this turned out to be. The second ' +
        'half of the test exists to catch precisely this. We also checked whether a wall ' +
        'of waiting buy orders behind a level helped predict it. It did not.',
    },
    {
      output: 'regime-exit-24h',
      status: 'WITHHELD',
      bar: 'The promises had to be off by under 5 points.',
      measured:
        'They were off by 5.1 points — just past the line. This one does beat the long-run ' +
        'average, so it genuinely knows something. But in the test period, markets that ' +
        'had been moving one way stopped doing so 5 to 11 points more often than the ' +
        'years we learned from would suggest.',
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
        'The market simply behaved differently in the test period than in the years the ' +
        'model learned from. Nothing is broken; the world moved. We set the limit before ' +
        'seeing the result and did not move it afterwards, so this stays unpublished until ' +
        'a fresher fit clears it.',
    },
    {
      output: 'unwind-lift-24h',
      status: 'WITHHELD',
      bar:
        'A sharp fall had to follow crowded conditions clearly more often than it follows ' +
        'ordinary ones — with at least 100 such occasions, spread over at least four ' +
        'separate months rather than bunched into one.',
      measured:
        'We found 103 occasions spread across six months, so there was plenty to look at. ' +
        'A sharp fall followed 11.7% of the time, against 11.1% of the time in ordinary ' +
        'conditions. Allowing for chance, the true figure could be anywhere from 7.5% to ' +
        '19.4% — a range that comfortably includes the ordinary rate.',
      curve: null,
      fittedAt: '2026-09-06',
      evidence: 'docs/evidence/LAYER3_LIQUIDITY.md',
      note:
        'On this data, a crowd of traders leaning the same way does not measurably raise ' +
        'the chance of a sharp fall. We also cannot see forced sell-offs directly, so a ' +
        'warning about them would be unverifiable even if the pattern had been there.',
    },
  ];

  report(): { entries: CalibrationEntry[]; summary: string } {
    return {
      entries: CalibrationReportService.ENTRIES,
      summary:
        'One of these four numbers passed its test and is shown in the product. The other ' +
        'three were measured, failed, and are left blank on purpose — with the reason ' +
        'given here. Every check has a date, because a number that was accurate two years ' +
        'ago need not still be accurate now.',
    };
  }

  forOutput(output: string): CalibrationEntry | { error: string } {
    const found = CalibrationReportService.ENTRIES.find((e) => e.output === output);
    return found ?? { error: `No calibrated output named "${output}".` };
  }
}
