import { BadRequestException, Injectable, Logger } from '@nestjs/common';

/**
 * Read an analyst's reply back into draft rows.
 *
 * This is an EXTRACTOR, not an analyst. It is allowed to find numbers that are
 * already written down and nothing else: no inferring a stop from a percentage,
 * no splitting weights that were not given, no filling a missing entry with the
 * spot price. A field that is absent comes back null and a person types it,
 * because a guessed number scored in R is indistinguishable from a real one
 * afterwards.
 */

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 60_000;
/** Long enough for ten coins of prose, short enough to reject a pasted book. */
const MAX_INPUT_CHARS = 200_000;

export interface ParsedTarget {
  price: number | null;
  weightPercent: number | null;
}

export interface ParsedRow {
  symbol: string;
  verdict: 'TAKE' | 'SKIP' | null;
  direction: 'long' | 'short' | null;
  entry: number | null;
  stop: number | null;
  targets: ParsedTarget[];
  rationale: string | null;
  /** Said SKIP but gave a plan anyway. Surfaced so the screen can say so. */
  planDespiteSkip: boolean;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Symbols asked for that the reply had nothing about. */
  missing: string[];
}

const INSTRUCTIONS = `You extract trading plans from an analyst's written reply. You are a parser, not an analyst.

THE ONE RULE: only report what is literally written in the reply. Never calculate, infer, estimate, convert or complete anything. If a value is not stated, return null for it. A null is a correct answer; an invented number is not.

Specifically forbidden:
- Do not derive a stop or target from a percentage, a risk/reward ratio, or an ATR.
- Do not use a price mentioned in the market data or commentary as an entry, stop or target unless the analyst gave it as that field.
- Do not split weights across targets that were not given weights. Leave weightPercent null.
- Do not normalise weights so they total 100. Report them exactly as written.
- Do not translate a word like "market" or "spot" into a number. That is not a stated price, so entry is null.
- Do not repair a stop that sits on the wrong side of the entry. Report both as written.

If the analyst gave a range for a field ("84000-84500"), take the number the analyst says they would use. If they name no single number, return null.

VERDICT: report the verdict the analyst actually gave — TAKE or SKIP. If they said SKIP, or passed, or declined, the verdict is SKIP.

PLAN DESPITE SKIP: an analyst often marks a coin SKIP and still writes out the plan they would have placed. When that happens, extract that plan in full — entry, stop and targets — exactly as with a TAKE, and set planDespiteSkip to true. Never return empty fields just because the verdict is SKIP. Set planDespiteSkip to false whenever the verdict is TAKE, or when a SKIP carries no plan.

NUMBERS: strip currency symbols and thousands separators. 84,120 is 84120. $1.2345 is 1.2345. Never round.

RATIONALE: one short line in the analyst's own words saying why. If they gave no reason, null.

SYMBOLS: use the bare ticker in upper case — BTC, not BTCUSDT and not "Bitcoin".

Return one object per coin the reply actually discusses. Omit a coin the reply does not mention rather than inventing a row for it.`;

const SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          verdict: { type: 'string', nullable: true, enum: ['TAKE', 'SKIP'] },
          direction: { type: 'string', nullable: true, enum: ['long', 'short'] },
          entry: { type: 'number', nullable: true },
          stop: { type: 'number', nullable: true },
          targets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                price: { type: 'number', nullable: true },
                weightPercent: { type: 'number', nullable: true },
              },
              required: ['price', 'weightPercent'],
            },
          },
          rationale: { type: 'string', nullable: true },
          planDespiteSkip: { type: 'boolean' },
        },
        required: [
          'symbol',
          'verdict',
          'direction',
          'entry',
          'stop',
          'targets',
          'rationale',
          'planDespiteSkip',
        ],
      },
    },
  },
  required: ['rows'],
} as const;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * The model is schema-constrained, but a schema does not make a response
 * trustworthy — it only makes it shaped. Everything is re-checked here.
 */
export function normaliseRows(raw: unknown, wanted: string[]): ParseResult {
  const rows = (raw as { rows?: unknown })?.rows;
  const list = Array.isArray(rows) ? rows : [];
  const allowed = new Set(wanted.map((s) => s.toUpperCase()));

  const parsed: ParsedRow[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;

    const symbol = (str(r.symbol) ?? '').toUpperCase().replace(/USDT?$/, '');
    // A coin nobody asked about has no reading to attach to, so it cannot be
    // scored and is dropped rather than shown.
    if (symbol === '' || (allowed.size > 0 && !allowed.has(symbol))) continue;

    const verdict = r.verdict === 'TAKE' || r.verdict === 'SKIP' ? r.verdict : null;
    const direction =
      r.direction === 'long' || r.direction === 'short' ? r.direction : null;

    const targets = (Array.isArray(r.targets) ? r.targets : [])
      .map((t) => {
        const o = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
        return { price: num(o.price), weightPercent: num(o.weightPercent) };
      })
      .filter((t) => t.price !== null || t.weightPercent !== null);

    const hasPlan = num(r.entry) !== null || num(r.stop) !== null || targets.length > 0;

    parsed.push({
      symbol,
      verdict,
      direction,
      entry: num(r.entry),
      stop: num(r.stop),
      targets,
      rationale: str(r.rationale),
      // Recomputed rather than trusted: it is a claim about the other fields,
      // and those are right here.
      planDespiteSkip: verdict === 'SKIP' && hasPlan,
    });
  }

  const seen = new Set(parsed.map((p) => p.symbol));
  return {
    rows: parsed,
    missing: wanted.map((s) => s.toUpperCase()).filter((s) => !seen.has(s)),
  };
}

@Injectable()
export class SimParseService {
  private readonly logger = new Logger(SimParseService.name);

  async parse(text: string, symbols: string[]): Promise<ParseResult> {
    const reply = text?.trim() ?? '';
    if (reply === '') {
      throw new BadRequestException('Paste the analyst reply first — nothing was sent.');
    }
    if (reply.length > MAX_INPUT_CHARS) {
      throw new BadRequestException(
        `That reply is ${reply.length} characters, over the ${MAX_INPUT_CHARS} limit.`,
      );
    }

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new BadRequestException(
        'GEMINI_API_KEY is not set, so replies cannot be read automatically. ' +
          'Fill the rows in by hand, or set the key and restart the API.',
      );
    }

    const asked =
      symbols.length > 0
        ? `\n\nThe reply should cover these coins: ${symbols.join(', ')}. Ignore any other coin it mentions.`
        : '';

    const body = {
      systemInstruction: { parts: [{ text: INSTRUCTIONS + asked }] },
      contents: [{ role: 'user', parts: [{ text: reply }] }],
      generationConfig: {
        // Extraction has one right answer, so there is nothing to sample for.
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        // The body can carry the key back in an error echo, so it is logged
        // rather than returned.
        this.logger.error(`Gemini ${response.status}: ${(await response.text()).slice(0, 500)}`);
        throw new BadRequestException(
          `Could not read the reply: the extraction service returned ${response.status}.`,
        );
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const payload = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!payload) {
        throw new BadRequestException('The extraction service returned nothing to read.');
      }

      return normaliseRows(JSON.parse(payload), symbols);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof SyntaxError) {
        throw new BadRequestException('The extraction service returned malformed JSON.');
      }
      if ((error as Error)?.name === 'AbortError') {
        throw new BadRequestException(
          `Reading the reply took longer than ${TIMEOUT_MS / 1000}s and was stopped.`,
        );
      }
      this.logger.error(`Gemini call failed: ${String(error)}`);
      throw new BadRequestException('Could not reach the extraction service.');
    } finally {
      clearTimeout(timer);
    }
  }
}
