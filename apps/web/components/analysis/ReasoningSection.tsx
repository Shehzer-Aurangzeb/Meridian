import { cn } from '@/lib/utils';
import { SectionHead } from '@/components/dashboard';

/**
 * Condition item type
 */
export interface ConditionItem {
  label: string;
  met: boolean;
  weight: number;
}

/**
 * Reasoning data type
 */
export interface ReasoningData {
  paragraphs: string[];
  conditions: ConditionItem[];
  strategiesCount: number;
}

/**
 * Prose section component
 */
function ProseSection({ paragraphs }: { paragraphs: string[] }) {
  return (
    <article className="bg-surface border border-border/10 dark:border-border rounded-xl p-7 md:p-9">
      {paragraphs.map((text, idx) => (
        <p
          key={idx}
          className={cn(
            'text-base leading-[1.65] text-text-primary m-0',
            idx < paragraphs.length - 1 && 'mb-4'
          )}
          style={{ textWrap: 'pretty' }}
        >
          {text}
        </p>
      ))}
    </article>
  );
}

/**
 * Conditions checklist component
 */
function ConditionsChecklist({ conditions }: { conditions: ConditionItem[] }) {
  return (
    <aside className="bg-surface border border-border/10 dark:border-border rounded-xl p-7">
      <h4 className="m-0 mb-4 font-antonio uppercase tracking-[0.06em] font-semibold text-base">
        Conditions
      </h4>
      <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
        {conditions.map((condition) => (
          <li
            key={condition.label}
            className={cn(
              'grid grid-cols-[20px_1fr_auto] gap-3.5 items-center py-3 border-b border-border/10 dark:border-border text-sm',
              'last:border-b-0',
              !condition.met && 'text-text-tertiary'
            )}
          >
            <span
              className={cn(
                'w-[18px] h-[18px] rounded-full grid place-items-center text-[11px] font-bold',
                condition.met
                  ? 'bg-sage text-deep-green dark:bg-green/30 dark:text-green'
                  : 'bg-transparent text-text-tertiary border border-border-hover/18 dark:border-border-hover'
              )}
            >
              {condition.met ? '✓' : '✕'}
            </span>
            <span className={cn(condition.met ? 'text-text-primary' : 'text-text-tertiary')}>
              {condition.label}
            </span>
            <span className="font-mono text-[11px] text-text-tertiary tracking-[0.04em]">
              w {condition.weight.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Reasoning section props
 */
interface ReasoningSectionProps {
  reasoning: ReasoningData;
  className?: string;
}

/**
 * Reasoning section with prose and conditions checklist
 */
export function ReasoningSection({
  reasoning,
  className,
}: ReasoningSectionProps) {
  return (
    <section className={cn('mt-14', className)}>
      <SectionHead
        eyebrow="Reasoning"
        title="A note on the trade"
        linkText={`Generated · weighted across ${reasoning.strategiesCount} strategies`}
        linkHref="#"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 md:gap-8">
        <ProseSection paragraphs={reasoning.paragraphs} />
        <ConditionsChecklist conditions={reasoning.conditions} />
      </div>
    </section>
  );
}

/**
 * Mock reasoning data for development
 */
export const MOCK_REASONING: ReasoningData = {
  paragraphs: [
    'Bitcoin has spent the last nine sessions retracing a measured 9.4% from its April peak, finding its way back to the structural support that defined the February-to-March consolidation. The pullback is orderly: volume has tapered with each successive low, momentum has cooled rather than collapsed, and the broader trend on the weekly chart remains intact.',
    'At $43,250 the asset sits squarely on the lower Bollinger band with an RSI reading of 28.5 — the first oversold print since the cycle began. Historically, similar setups in trending markets have produced a mean-reversion of one to two standard deviations within five to nine sessions. The risk is well-defined: a daily close beneath $42,360 would invalidate the support thesis and warrant an exit.',
    'We size for two scaled targets — a conservative bounce to the 20-day mean at $44,820, and a fuller reversion to the prior range high near $46,400 — with the trail moved to entry on the first target.',
  ],
  conditions: [
    { label: 'RSI oversold (< 30)', met: true, weight: 0.25 },
    { label: 'Price at structural support', met: true, weight: 0.22 },
    { label: 'Weekly trend intact', met: true, weight: 0.2 },
    { label: 'Lower Bollinger touch', met: true, weight: 0.15 },
    { label: 'Volume confirmation', met: false, weight: 0.12 },
    { label: 'Bullish divergence on MACD', met: false, weight: 0.06 },
  ],
  strategiesCount: 4,
};
