/**
 * Mapper utilities for converting API responses to UI data shapes
 */

import type {
  CoordinateAnalysisResponse,
  ClaudeAnalysisResponse,
  CoordinatorAnalysisResult,
  ChecklistItem,
  Timeframe,
} from '@/types';
import type { SignalData, SignalDirection, PriceLevel } from '@/components/features/analysis/signal-card';
import type { ReasoningData, ConditionItem } from '@/components/features/analysis/reasoning-section';
import type { IndicatorData, IndicatorFlag } from '@/components/features/analysis/indicators-section';
import { formatCurrency } from '@/lib/format';

/**
 * UI Timeframe type (display format)
 */
export type UITimeframe = '1H' | '4H' | '1D' | '1W';

/**
 * Map UI timeframe to API timeframe
 */
export function mapUITimeframeToApi(tf: UITimeframe): Timeframe {
  const mapping: Record<UITimeframe, Timeframe> = {
    '1H': '1h',
    '4H': '4h',
    '1D': '1d',
    '1W': '1w',
  };
  return mapping[tf] ?? '1h';
}

/**
 * Map API action to UI direction
 */
function mapActionToDirection(action: string): SignalDirection {
  switch (action) {
    case 'LONG':
      return 'long';
    case 'SHORT':
      return 'short';
    default:
      return 'wait';
  }
}

/**
 * Map strategy route to display name
 */
function mapStrategyRoute(route: string): string {
  switch (route) {
    case 'SQUEEZE_BREAKOUT':
      return 'Squeeze breakout';
    case 'CONFLUENCE_CHECKLIST':
      return 'Confluence checklist';
    default:
      return 'Analysis';
  }
}

/**
 * Map timeframe to display format
 */
function mapTimeframeDisplay(tf: Timeframe): string {
  switch (tf) {
    case '1m':
      return '1 Minute';
    case '5m':
      return '5 Minutes';
    case '15m':
      return '15 Minutes';
    case '30m':
      return '30 Minutes';
    case '1h':
      return 'Hourly';
    case '4h':
      return '4 Hour';
    case '1d':
      return 'Daily';
    case '1w':
      return 'Weekly';
    default:
      return tf;
  }
}

/**
 * Calculate risk-reward ratio
 */
function calculateRiskReward(entry: number, stop: number, tp1: number): string {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(tp1 - entry);
  if (risk === 0) return '—';
  const ratio = (reward / risk).toFixed(1);
  return `1 : ${ratio}`;
}

/**
 * Calculate percentage change
 */
function calculatePercentChange(from: number, to: number): string {
  const change = ((to - from) / from) * 100;
  const sign = change >= 0 ? '+' : '';
  return `${sign} ${change.toFixed(2)} %`;
}

/**
 * Get horizon based on timeframe
 */
function getHorizon(timeframe: Timeframe): string {
  switch (timeframe) {
    case '1m':
    case '5m':
      return '< 1 hour';
    case '15m':
    case '30m':
      return '1 – 4 hours';
    case '1h':
      return '4 – 24 hours';
    case '4h':
      return '1 – 3 days';
    case '1d':
      return '3 – 7 days';
    case '1w':
      return '1 – 4 weeks';
    default:
      return '—';
  }
}

/**
 * Map API response to SignalData
 */
export function mapToSignalData(
  response: CoordinateAnalysisResponse,
  coin: string,
  timeframe: Timeframe
): SignalData | null {
  if (!response.success || !response.data) {
    return null;
  }

  const { coordinator, ai } = response.data;

  // If no AI response or WAIT action, return wait signal
  if (!ai || ai.action === 'WAIT') {
    return {
      direction: 'wait',
      strategy: mapStrategyRoute(coordinator.strategyRoute),
      riskReward: '—',
      horizon: getHorizon(timeframe),
      confidence: 0,
      coin: coin.toUpperCase(),
      timeframe: mapTimeframeDisplay(timeframe),
      dateRange: new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
      prices: [],
    };
  }

  const prices: PriceLevel[] = [
    {
      label: 'Entry',
      value: formatCurrency(ai.entryPrice),
      subtext: `Limit order`,
      variant: 'entry',
    },
    {
      label: 'Target · TP1',
      value: formatCurrency(ai.tp1),
      subtext: calculatePercentChange(ai.entryPrice, ai.tp1),
      trend: ai.action === 'LONG' ? 'up' : 'down',
    },
    {
      label: 'Target · TP2',
      value: formatCurrency(ai.tp2),
      subtext: calculatePercentChange(ai.entryPrice, ai.tp2),
      trend: ai.action === 'LONG' ? 'up' : 'down',
    },
    {
      label: 'Stop loss',
      value: formatCurrency(ai.stopLoss),
      subtext: calculatePercentChange(ai.entryPrice, ai.stopLoss),
      variant: 'stop',
      trend: ai.action === 'LONG' ? 'down' : 'up',
    },
  ];

  return {
    direction: mapActionToDirection(ai.action),
    strategy: mapStrategyRoute(coordinator.strategyRoute),
    riskReward: calculateRiskReward(ai.entryPrice, ai.stopLoss, ai.tp1),
    horizon: getHorizon(timeframe),
    confidence: Math.round(ai.confidence),
    coin: coin.toUpperCase(),
    timeframe: mapTimeframeDisplay(timeframe),
    dateRange: new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
    prices,
  };
}

/**
 * Map checklist items to conditions
 */
function mapChecklistToConditions(items: ChecklistItem[]): ConditionItem[] {
  return items.map((item) => ({
    label: item.name,
    met: item.passed,
    weight: item.weight,
  }));
}

/**
 * Split reasoning text into paragraphs
 */
function splitIntoParagraphs(reasoning: string): string[] {
  // Split by double newlines or periods followed by newlines
  const paragraphs = reasoning
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // If only one paragraph and it's long, try to split it more
  if (paragraphs.length === 1 && paragraphs[0].length > 500) {
    const sentences = paragraphs[0].split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > 400 && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks.length > 1 ? chunks : paragraphs;
  }

  return paragraphs;
}

/**
 * Map API response to ReasoningData
 */
export function mapToReasoningData(
  response: CoordinateAnalysisResponse
): ReasoningData | null {
  if (!response.success || !response.data) {
    return null;
  }

  const { coordinator, ai } = response.data;
  const regime = coordinator.regimeResult?.regime ?? 'UNKNOWN';

  // If no AI response, return minimal reasoning
  if (!ai) {
    const conditions = coordinator.checklistResult?.items
      ? mapChecklistToConditions(coordinator.checklistResult.items)
      : [];

    return {
      paragraphs: [
        `Market regime: ${formatRegime(regime)}. Strategy route: ${mapStrategyRoute(coordinator.strategyRoute)}.`,
        coordinator.checklistResult
          ? `Checklist score: ${coordinator.checklistResult.score}/100. Status: ${coordinator.checklistResult.status}.`
          : 'No checklist data available.',
      ],
      conditions,
      strategiesCount: 1,
    };
  }

  const paragraphs = splitIntoParagraphs(ai.reasoning);
  const conditions = coordinator.checklistResult?.items
    ? mapChecklistToConditions(coordinator.checklistResult.items)
    : [];

  return {
    paragraphs,
    conditions,
    strategiesCount: conditions.length > 0 ? Math.ceil(conditions.length / 2) : 1,
  };
}

/**
 * Map regime to indicator flag
 */
function mapRegimeToFlag(regime: string, action: string | null): IndicatorFlag {
  if (!action || action === 'WAIT') return 'neutral';

  const bullishRegimes = ['TRENDING'];
  const bearishRegimes = ['TRENDING'];

  // For TRENDING regime, flag depends on action direction
  if (regime === 'TRENDING') {
    return action === 'LONG' ? 'bullish' : action === 'SHORT' ? 'bearish' : 'neutral';
  }

  if (regime === 'MEAN_REVERSION' || regime === 'COMPRESSION') return 'neutral';

  return 'neutral';
}

/**
 * Format regime for display
 */
function formatRegime(regime: string): string {
  return regime.replace(/_/g, ' ').toLowerCase();
}

/**
 * Map API response to IndicatorData[]
 * Note: The coordinator API doesn't return detailed indicator values,
 * so we create synthetic indicators from available data
 */
export function mapToIndicatorsData(
  response: CoordinateAnalysisResponse
): IndicatorData[] {
  if (!response.success || !response.data) {
    return [];
  }

  const { coordinator, ai } = response.data;
  const indicators: IndicatorData[] = [];

  // Get regime from the nested regimeResult
  const regime = coordinator.regimeResult?.regime ?? 'UNKNOWN';

  // Market Regime indicator
  const regimeFlag = mapRegimeToFlag(regime, ai?.action ?? null);
  indicators.push({
    type: 'rsi',
    name: 'Regime',
    period: 'Current',
    flag: regimeFlag,
    flagLabel: formatRegime(regime),
    value: formatRegime(regime),
    note: `Market is currently in ${formatRegime(regime)} mode.`,
    rsiValue: regimeFlag === 'bullish' ? 70 : regimeFlag === 'bearish' ? 30 : 50,
  });

  // Strategy Route indicator
  const strategyFlag: IndicatorFlag =
    coordinator.strategyRoute === 'SQUEEZE_BREAKOUT'
      ? 'bullish'
      : coordinator.strategyRoute === 'CONFLUENCE_CHECKLIST'
      ? 'neutral'
      : 'neutral';

  indicators.push({
    type: 'atr',
    name: 'Strategy',
    period: 'Active',
    flag: strategyFlag,
    flagLabel: coordinator.strategyRoute === 'SQUEEZE_BREAKOUT' ? 'Breakout' : 'Checklist',
    value: mapStrategyRoute(coordinator.strategyRoute),
    note:
      coordinator.strategyRoute === 'SQUEEZE_BREAKOUT'
        ? 'Squeeze breakout pattern detected — momentum expansion expected.'
        : 'Confluence checklist strategy — multiple confirmations required.',
    sparkData: [20, 22, 25, 23, 28, 30, 32, 35, 38, 42, 45, 48, 52, 55, 58, 60, 62, 65],
  });

  // Checklist Score indicator (if available)
  if (coordinator.checklistResult) {
    const score = coordinator.checklistResult.score ?? 0;
    const items = coordinator.checklistResult.items ?? [];
    const scoreFlag: IndicatorFlag = score >= 70 ? 'bullish' : score >= 50 ? 'neutral' : 'bearish';

    indicators.push({
      type: 'rsi',
      name: 'Checklist',
      period: 'Score',
      flag: scoreFlag,
      flagLabel: coordinator.checklistResult.status ?? 'Unknown',
      value: `${score}`,
      note: items.length > 0
        ? `${items.filter((i) => i.passed).length} of ${items.length} conditions met.`
        : 'No checklist items available.',
      rsiValue: score,
    });
  }

  // Squeeze Setup indicator (if active)
  if (coordinator.squeezeSetup?.isActive) {
    const squeezeDirection = coordinator.squeezeSetup.direction;
    const squeezeFlag: IndicatorFlag =
      squeezeDirection === 'long' ? 'bullish' : squeezeDirection === 'short' ? 'bearish' : 'neutral';

    indicators.push({
      type: 'bollinger',
      name: 'Squeeze',
      period: 'Active',
      flag: squeezeFlag,
      flagLabel: squeezeDirection ? squeezeDirection.toUpperCase() : 'FIRING',
      value: `${Math.round(coordinator.squeezeSetup.confidence)}%`,
      note: 'Bollinger squeeze detected — volatility expansion imminent.',
      lower: 'Tight',
      mid: 'Firing',
      upper: 'Expanding',
      position: coordinator.squeezeSetup.confidence,
    });
  }

  return indicators;
}
