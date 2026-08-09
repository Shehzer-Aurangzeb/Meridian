'use client';


export function HistoryPageHeader() {
  return (
    <header className="mb-8">
      <div>
        <div className="eyebrow relative pl-4 before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-3 before:bg-gold before:rounded-full">
          The record
        </div>
        <h1 className="font-display text-[44px] md:text-[52px] font-semibold tracking-[0.02em] leading-[1.05] text-text-primary mt-3">
          History
        </h1>
        <p className="text-base text-text-secondary leading-relaxed max-w-xl mt-3">
          Every analysis, scheduled or run by hand. Open one for its levels,
          plans, and what price has done since.
        </p>
      </div>
      
    </header>
  );
}
