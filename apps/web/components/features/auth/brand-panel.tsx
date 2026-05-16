import Link from 'next/link';

export function BrandPanel() {
  return (
    <aside className="hidden lg:flex bg-deep-green text-sidebar-text p-10 md:p-14 flex-col justify-between relative overflow-hidden">
      {/* Decorative circles */}
      <div className="absolute -top-20 -right-20 w-[360px] h-[360px] rounded-full border border-gold/[0.08]" />
      <div className="absolute -bottom-40 -left-30 w-[480px] h-[480px] rounded-full border border-gold/[0.06]" />

      {/* Brand */}
      <Link href="/" className="flex items-center gap-3 relative z-10">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gold to-gold-dark" />
        <span className="font-display text-xl font-semibold tracking-[0.08em] uppercase">Meridian</span>
      </Link>

      {/* Pitch */}
      <div className="relative z-10 max-w-[460px] mt-8 lg:mt-0">
        <div className="text-[10px] font-semibold tracking-[0.16em] uppercase text-gold mb-6 relative pl-4 before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-3 before:bg-gold before:rounded-full">
          A considered view
        </div>
        <h2 className="font-display text-[40px] lg:text-[56px] font-bold tracking-[0.03em] uppercase leading-[1] mb-6 text-balance">
          Slow signals.<br />
          <span className="text-gold italic font-normal normal-case tracking-normal">Careful</span> reasoning.
        </h2>
        <p className="text-white/70 text-base leading-relaxed max-w-[420px]">
          AI-powered crypto analysis distilled from professional strategies — refreshed every market open, never in a hurry.
        </p>
      </div>

      {/* Quote */}
      <div className="relative z-10 pt-7 border-t border-gold/[0.14] max-w-[460px] mt-8 lg:mt-0">
        <blockquote className="font-display text-xl lg:text-[22px] font-medium leading-[1.25] tracking-[0.02em] text-sidebar-text mb-4">
          <span className="text-gold">&ldquo;</span>
          Meridian replaced four newsletters and an indicator I never really understood. I check it once a morning.
          <span className="text-gold">&rdquo;</span>
        </blockquote>
        <div className="font-mono text-xs text-gold/70 tracking-[0.08em] uppercase">
          — J. Lin · Portfolio manager · Member since 2025
        </div>
      </div>
    </aside>
  );
}
