'use client';

import { useState } from 'react';
import type { ParseOutcome } from '@/lib/hooks/use-batch';

interface ReplyBoxProps {
  onFill: (text: string) => Promise<ParseOutcome>;
  parsing: boolean;
  disabled: boolean;
}

/**
 * Paste the analyst's whole reply and have the rows filled in.
 *
 * The reader stays the author of the record: this fills the boxes and stops.
 * Nothing is saved, every field remains editable, and a field the reply did not
 * state is left for a person rather than guessed — see sim.parse.ts.
 */
export function ReplyBox({ onFill, parsing, disabled }: ReplyBoxProps) {
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<ParseOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const handleFill = async () => {
    setFailure(null);
    setOutcome(null);
    try {
      setOutcome(await onFill(text));
    } catch (e) {
      setFailure((e as Error).message);
    }
  };

  return (
    <section className="mt-6 rounded border border-border/40 bg-surface p-5">
      <h2 className="font-antonio text-[17px] font-semibold uppercase tracking-headline text-text-primary">
        Paste the reply
      </h2>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
        Paste everything the analyst wrote for all ten coins and the rows below fill
        themselves. Only what the reply actually states is copied across — anything it
        left out stays blank for you, and nothing is saved until you press Save.
      </p>

      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="The analyst's whole reply, all ten coins at once."
        className="mt-3 w-full rounded-sm border border-border/60 bg-background px-3 py-2 font-mono text-[12px] leading-relaxed text-text-primary outline-none focus:border-gold/60"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleFill}
          disabled={parsing || disabled || text.trim() === ''}
          className="rounded-sm bg-gold px-4 py-2 font-mono text-[13px] text-gold-contrast disabled:opacity-40"
        >
          {parsing ? 'Reading…' : 'Fill the rows'}
        </button>
        {text.trim() !== '' ? (
          <button
            type="button"
            onClick={() => {
              setText('');
              setOutcome(null);
              setFailure(null);
            }}
            className="font-mono text-[12px] text-text-tertiary hover:text-text-primary"
          >
            clear
          </button>
        ) : null}
        <span className="font-mono text-[12px] text-text-tertiary">
          {disabled ? 'waiting for the readings' : 'check every row before saving'}
        </span>
      </div>

      {outcome ? (
        <div className="mt-3 space-y-1.5 text-[13px]">
          <p className="text-text-primary">
            {outcome.filled.length === 0
              ? 'Nothing in that reply matched the ten coins.'
              : `Filled ${outcome.filled.length}: ${outcome.filled.join(', ')}.`}
          </p>
          {outcome.missing.length > 0 ? (
            <p className="text-text-tertiary">
              Not mentioned in the reply: {outcome.missing.join(', ')}.
            </p>
          ) : null}
          {outcome.incomplete.length > 0 ? (
            <p className="text-amber">
              Still needs an entry, a stop or a target: {outcome.incomplete.join(', ')}. The
              reply did not give those numbers, so they were left for you rather than
              guessed.
            </p>
          ) : null}
        </div>
      ) : null}

      {failure ? (
        <p className="mt-3 text-[13px] text-amber">{failure}</p>
      ) : null}
    </section>
  );
}
