'use client';

export function StrategiesPageHeader() {
  return (
    <header className="mb-8">
      <div className="eyebrow relative pl-4 before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-3 before:bg-gold before:rounded-full">
        The library
      </div>
      <h1 className="font-display text-[44px] md:text-[52px] font-semibold tracking-[0.02em] leading-[1.05] text-text-primary mt-3">
        Strategies
      </h1>
      <p className="text-base text-text-secondary leading-relaxed max-w-2xl mt-3">
        The professional playbooks Meridian draws on when forming a view. Each analysis is a weighted blend of these — never a single voice in isolation.
      </p>
    </header>
  );
}
