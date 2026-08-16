/**
 * The trading method, boiled down to what fits in one AI request. The full
 * document is thousands of lines, most of it examples and screenshots that do
 * not change how a setup is read.
 *
 * The entry, stop and target formulas are deliberately left OUT: those are
 * already calculated, and including them would invite the model to work them
 * out again and disagree.
 */
export const PLAYBOOK_RULES = `
# THE METHOD (Miraj playbook, distilled)

## Core stance
- **DDE — Data Determines Everything.** Decisions come from observed structure, not opinion.
- "Trend is your friend until it ends" — follow it, but respect the break.
- "Altcoins are oscillators to Bitcoin at best" — alt strength is measured against BTC, not USD.
- Capital preservation outranks frequency. Missing a trade costs nothing; a bad trade costs capital.
- Patience is part of the edge: 2–5 level-to-level trades per month is normal, not a drought.

## Timeframe hierarchy (p8-9)
- Analyse top-down, always: HTF establishes bias and the major levels, LTF refines timing.
- Weekly/Daily/12h = macro view. 4h = swing. 1h = intraday. 15m and below = scalping.
- A signal on a low timeframe that contradicts the higher timeframe is a trap, not a setup.

## Market structure (p10)
- Bullish = higher highs AND higher lows. Bearish = lower highs AND lower lows.
- A structure BREAK is the reversal signal: HH/HL suddenly printing a lower low, or LH/LL printing a higher high.
- "Ranging" is a real state, not a failure to classify — it means no structural edge.
- Trendlines need 3+ touches to count. More touches, more meaningful. Valid until broken.

## What makes a level worth trading (p51-53)
- Levels matter in proportion to how many INDEPENDENT things agree at the same price.
- Confluence sources: Fibonacci quarters (0 / 0.25 / 0.5 / 0.75 / 1.0), horizontal S/R that has held more than once, trendlines, round numbers, and levels from more than one timeframe.
- A level tested many times and holding is stronger. A level tested many times and finally breaking often flips role — old resistance becomes support, and vice versa.
- The strongest entries sit where several timeframes' levels overlap in a narrow band (~0.5%).
- **Wait for price to reach the zone.** Chasing price away from a level is how good analysis becomes a bad trade.

## The five conditions (p12)
Read as CONFIRMATION of a setup already located at a level — never as a scanner:
1. RSI in the oversold band for longs / overbought for shorts, read on the higher timeframe.
2. QQE momentum bars aligned with the trade direction.
3. Price at a Bollinger extreme (bands must be expanded, not squeezed).
4. Market structure aligned with the direction, or in the act of reversing to it.
5. Price at a support/demand zone (long) or resistance/supply zone (short).
Bonus weight: RSI divergence, a trendline holding, volume rising into the level, a recognised pattern forming.

## Regime
- Compressed bands mean a move is building and direction is unknown. Compression is a reason to prepare, not a reason to pick a side.
- Trending markets reward continuation entries at pullbacks. Ranging markets reward the edges and punish the middle.
- Naming the regime is a description of what IS. It is not a forecast of what comes next.

## Exits (p14)
- "Never exit at random prices. Always exit at marked resistance levels."
- Scale out across successive levels rather than all at one price.
- After the first target, move the stop to breakeven — the trade should stop being able to hurt.
- Exit EARLY, before the stop, if: structure breaks against the position, the higher timeframe reverses, the confluence that justified the entry stops holding, volume dies in your direction, or divergence appears against you.
- "Trade your plan, but don't marry your position."

## Risk (p22-27)
- Never risk more than 1–2% of capital on one trade.
- Position size matters more than entry price.
- Stops always. No exceptions.
- Leverage by experience, not by conviction: beginner 2–3x, intermediate 3–5x, advanced 5–10x.
- Close a position when genuinely uncertain rather than hoping.
- Journal everything; review weekly.

## Things the method treats as warnings
- A setup where the only argument is a single level with nothing else agreeing.
- Bands squeezed — a Bollinger "extreme" inside a squeeze is not an extreme.
- Momentum and structure disagreeing with each other.
- Price already extended away from the level that justified the idea.
- A level whose strength comes from touches that all happened long ago.
`.trim();
