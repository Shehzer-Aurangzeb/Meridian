/**
 * Refuses narration that states a direction.
 *
 * ─── Why a runtime guard and not only a test ─────────────────────────────
 * A test asserts the prompt behaved on the examples someone thought of. This
 * runs on every generation, including the one nobody thought of. The numbers in
 * this product refuse to call a direction after twenty pre-registered tests
 * found none that pays a fee; prose that quietly reintroduces the call is worse
 * than no prose, because it carries the authority of the screen around it.
 *
 * ─── What it looks for ───────────────────────────────────────────────────
 * Three families, all of which are claims the data does not support:
 *   a forecast verb       "will rise", "should bounce", "expect a drop"
 *   a trade instruction   "buy", "go long", "take profit", "set a stop"
 *   a price objective     "target", "entry", "upside to"
 *
 * ─── The false-positive problem, handled deliberately ────────────────────
 * "Long" appears in "long-term" and "as long as". "Short" appears in
 * "shorter", "short-lived" and "in the short run". "Target" appears in
 * "targeted". Matching those would make the guard fire on correct writing,
 * which trains whoever maintains it to disable the guard — the worst outcome.
 *
 * So every pattern is anchored to word boundaries and the ambiguous words are
 * matched only in their trading senses ("go long", "long position"), never
 * bare. A guard that cries wolf gets switched off.
 */

export interface DirectionFinding {
  phrase: string;
  category: 'forecast' | 'instruction' | 'objective';
}

/**
 * Patterns, with their category. Each is a claim the map does not make.
 *
 * Written out one per line rather than assembled from parts, because a
 * generated regex here would be unreadable at exactly the moment somebody
 * needs to check whether a specific phrase is covered.
 */
const PATTERNS: Array<{ re: RegExp; category: DirectionFinding['category'] }> = [
  // ── forecast verbs ──
  { re: /\b(?:will|should|is going to|likely to|expect(?:ed)? to)\s+(?:rise|fall|drop|climb|bounce|break|rally|reverse|surge|plunge|dump|pump)\b/gi, category: 'forecast' },
  { re: /\bexpect\s+(?:a|an|the)?\s*(?:move|drop|fall|rise|rally|bounce|breakout|reversal)\b/gi, category: 'forecast' },
  { re: /\b(?:price|it|this)\s+(?:will|should)\s+\w+/gi, category: 'forecast' },
  { re: /\b(?:bullish|bearish)\b/gi, category: 'forecast' },
  { re: /\b(?:upside|downside)\s+(?:to|of)\s*\$?\d/gi, category: 'forecast' },

  // ── trade instructions ──
  { re: /\b(?:buy|sell|short|long)\s+(?:here|now|this|it|at\b)/gi, category: 'instruction' },
  { re: /\bgo\s+(?:long|short)\b/gi, category: 'instruction' },
  { re: /\b(?:long|short)\s+position\b/gi, category: 'instruction' },
  { re: /\b(?:take|book)\s+profit\b/gi, category: 'instruction' },
  { re: /\bcut\s+(?:losses|the\s+loss)\b/gi, category: 'instruction' },
  { re: /\bset\s+(?:a\s+)?stop\b/gi, category: 'instruction' },
  { re: /\b(?:enter|exit)\s+(?:the\s+)?(?:trade|position)\b/gi, category: 'instruction' },

  // ── price objectives ──
  { re: /\b(?:price\s+)?targets?\s+(?:of|at|is|are)\s*\$?\d/gi, category: 'objective' },
  { re: /\bentry\s+(?:price|zone|level|point)\b/gi, category: 'objective' },
  { re: /\bstop[\s-]?loss\b/gi, category: 'objective' },
  { re: /\brisk[\s/-]?reward\b/gi, category: 'objective' },
  { re: /\bR\s*multiple\b/gi, category: 'objective' },
];

/** Every directional claim found, in order. Empty means the text is clean. */
export function findDirectionalLanguage(text: string): DirectionFinding[] {
  const out: DirectionFinding[] = [];
  for (const { re, category } of PATTERNS) {
    // A fresh regex per call: a shared /g/ regex carries lastIndex between
    // calls and silently skips matches on every second invocation.
    const scan = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null = scan.exec(text);
    while (m !== null) {
      out.push({ phrase: m[0].trim(), category });
      m = scan.exec(text);
    }
  }
  return out;
}

export const statesDirection = (text: string): boolean =>
  findDirectionalLanguage(text).length > 0;

/**
 * Throw rather than publish prose that calls a direction.
 *
 * A failed narration is an optional extra the product does without. A
 * narration that tells the reader where price is going is a claim the whole
 * system was built to avoid making.
 */
export function assertNoDirection(text: string): void {
  const found = findDirectionalLanguage(text);
  if (found.length === 0) return;
  const listed = [...new Set(found.map((f) => `"${f.phrase}" (${f.category})`))].join(', ');
  throw new Error(
    `Narration states a direction and was discarded: ${listed}. ` +
      'The map describes the market and does not forecast direction.',
  );
}
