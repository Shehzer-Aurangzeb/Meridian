'use client';

import { cn } from '@/lib/utils';
import { AnalysisData } from '@/types/analysis';
import { Eyebrow } from '@/components/ui/eyebrow';
import { CardTitle } from '@/components/ui/card-title';
import { Body } from '@/components/ui/body';
import { Caption } from '@/components/ui/caption';
import { SuccessCheck } from '@/components/ui/success-check';

interface AnalysisResultsProps {
  data: AnalysisData;
}

export function AnalysisResults({ data }: AnalysisResultsProps) {
  return (
    <div className="mt-12 space-y-12 animate-fade-in">
      <SignalCard
        action={data.action}
        coin={data.coin}
        currentPrice={data.currentPrice}
      />

      <PriceGrid
        entryPrice={data.entryPrice}
        tp1={data.tp1}
        tp2={data.tp2}
        tp3={data.tp3}
        stopLoss={data.stopLoss}
      />

      <LeverageInfo leverage={data.leverage} />

      <IndicatorsSection indicators={data.indicators} currentPrice={data.currentPrice} />

      <ReasoningSection
        reasoning={data.reasoning}
        conditionsMet={data.conditionsMet}
      />
    </div>
  );
}

function SignalCard({
  action,
  coin,
  currentPrice,
}: {
  action: string;
  coin: string;
  currentPrice: number;
}) {
  const badgeStyles = {
    LONG: 'bg-sage text-deep-green dark:bg-green/30 dark:text-green',
    SHORT: 'bg-primary text-primary-foreground',
    WAIT: 'bg-surface text-text-primary border border-primary',
  };

  return (
    <div className="bg-background border border-primary/[0.08] rounded-xl p-8 text-center">
      <div className="flex items-center justify-center gap-3 mb-4">
        <SuccessCheck size="sm" className="text-sage" />
        <span className="font-inter text-sm text-sage font-medium">Analysis Complete</span>
      </div>
      <div
        className={cn(
          'inline-block px-6 py-3 rounded-lg font-antonio text-2xl uppercase tracking-headline',
          badgeStyles[action as keyof typeof badgeStyles] || badgeStyles.WAIT
        )}
      >
        {action}
      </div>
      <div className="w-10 h-px bg-gold mx-auto my-6" />
      <CardTitle className="mb-2">
        {coin}/USDT
      </CardTitle>
      <Caption>
        Current Price: ${formatPrice(currentPrice)}
      </Caption>
    </div>
  );
}

function PriceGrid({
  entryPrice,
  tp1,
  tp2,
  tp3,
  stopLoss,
}: {
  entryPrice: number;
  tp1: number;
  tp2: number;
  tp3: number;
  stopLoss: number;
}) {
  return (
    <div>
      <Eyebrow className="mb-6">Entry & Exit Prices</Eyebrow>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <PriceCard label="Entry Price" value={entryPrice} highlight />
        <PriceCard label="Take Profit 1" value={tp1} />
        <PriceCard label="Take Profit 2" value={tp2} />
        <PriceCard label="Take Profit 3" value={tp3} />
        <PriceCard label="Stop Loss" value={stopLoss} isStopLoss />
      </div>
    </div>
  );
}

function PriceCard({
  label,
  value,
  highlight = false,
  isStopLoss = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  isStopLoss?: boolean;
}) {
  return (
    <div
      className={cn(
        'bg-background border border-primary/[0.08] rounded-xl p-6',
        isStopLoss && 'bg-rust/10 border-rust/30'
      )}
    >
      <Eyebrow className={cn('mb-2', highlight && 'text-gold')}>
        {label}
      </Eyebrow>
      <span
        className={cn(
          'font-inter font-semibold text-3xl tabular-nums',
          highlight ? 'text-gold' : 'text-text-primary'
        )}
      >
        ${formatPrice(value)}
      </span>
    </div>
  );
}

function LeverageInfo({ leverage }: { leverage: number }) {
  return (
    <div className="bg-background border border-primary/[0.08] rounded-xl p-6">
      <Body>
        Recommended Leverage: <span className="font-semibold">{leverage}x</span>
      </Body>
      <Caption className="mt-1 block">
        Position size: Calculate based on your capital and risk tolerance
      </Caption>
    </div>
  );
}

function IndicatorsSection({
  indicators,
  currentPrice,
}: {
  indicators: AnalysisData['indicators'];
  currentPrice: number;
}) {
  const rsiStatus = getRsiStatus(indicators.rsi);
  const bbPosition = getBBPosition(currentPrice, indicators.bb);

  return (
    <div>
      <Eyebrow className="mb-6">Technical Indicators</Eyebrow>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <IndicatorCard
          label="RSI (14)"
          value={indicators.rsi.toFixed(2)}
          status={rsiStatus}
        >
          <RSIBar value={indicators.rsi} />
        </IndicatorCard>

        <IndicatorCard
          label="Bollinger Bands"
          value={bbPosition}
        >
          <div className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-text-secondary">Upper</span>
              <span className="tabular-nums">${formatPrice(indicators.bb.upper)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Middle</span>
              <span className="tabular-nums">${formatPrice(indicators.bb.middle)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Lower</span>
              <span className="tabular-nums">${formatPrice(indicators.bb.lower)}</span>
            </div>
          </div>
        </IndicatorCard>

        <IndicatorCard
          label="ATR (14)"
          value={formatPrice(indicators.atr)}
          status="Volatility measure"
        />
      </div>

      {(indicators.support || indicators.resistance) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          {indicators.support && (
            <IndicatorCard label="Support" value={`$${formatPrice(indicators.support)}`} />
          )}
          {indicators.resistance && (
            <IndicatorCard label="Resistance" value={`$${formatPrice(indicators.resistance)}`} />
          )}
        </div>
      )}
    </div>
  );
}

function IndicatorCard({
  label,
  value,
  status,
  children,
}: {
  label: string;
  value: string;
  status?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-background border border-primary/[0.08] rounded-xl p-6">
      <Caption className="block mb-1">{label}</Caption>
      <span className="font-inter font-semibold text-xl text-text-primary">
        {value}
      </span>
      {status && (
        <Caption className="block mt-1">{status}</Caption>
      )}
      {children}
    </div>
  );
}

function RSIBar({ value }: { value: number }) {
  const position = Math.min(100, Math.max(0, value));
  
  return (
    <div className="mt-3">
      <div className="relative h-2 bg-primary/10 rounded-full overflow-hidden">
        <div className="absolute left-[30%] top-0 bottom-0 w-px bg-sage/50" />
        <div className="absolute left-[70%] top-0 bottom-0 w-px bg-sage/50" />
        <div
          className="absolute top-0 bottom-0 w-2 bg-gold rounded-full -translate-x-1/2"
          style={{ left: `${position}%` }}
        />
      </div>
      <div className="flex justify-between mt-1 text-xs text-text-secondary">
        <span>Oversold</span>
        <span>Overbought</span>
      </div>
    </div>
  );
}

function ReasoningSection({
  reasoning,
  conditionsMet,
}: {
  reasoning: string;
  conditionsMet: string[];
}) {
  return (
    <div>
      <Eyebrow className="mb-6">Analysis</Eyebrow>
      <div className="bg-background border border-primary/[0.08] rounded-xl p-8">
        <Body className="text-text-secondary leading-relaxed mb-6">
          {reasoning}
        </Body>

        {conditionsMet.length > 0 && (
          <div className="border-t border-primary/[0.08] pt-6">
            <Caption className="block mb-4">Conditions</Caption>
            <ul className="space-y-2">
              {conditionsMet.map((condition, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-sage">✓</span>
                  <span className="text-sm text-text-primary">{condition}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toFixed(2);
  }
  return price.toPrecision(4);
}

function getRsiStatus(rsi: number): string {
  if (rsi < 30) return 'Oversold';
  if (rsi > 70) return 'Overbought';
  return 'Neutral';
}

function getBBPosition(price: number, bb: { upper: number; middle: number; lower: number }): string {
  if (price >= bb.upper) return 'At Upper Band';
  if (price <= bb.lower) return 'At Lower Band';
  if (price > bb.middle) return 'Above Middle';
  return 'Below Middle';
}
