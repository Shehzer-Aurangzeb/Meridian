'use client';

import Link from 'next/link';

import { NotWired } from '@/components/ui/not-wired';

export function FormPanel() {
  return (
    <section className="bg-background min-h-screen lg:min-h-0 p-6 sm:p-10 md:p-14 flex flex-col">
      {/* Mobile header with logo */}
      <header className="lg:hidden flex items-center justify-center mb-8">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gold to-gold-dark" />
          <span className="font-display text-lg font-semibold tracking-[0.08em] uppercase text-text-primary">Meridian</span>
        </Link>
      </header>

      {/* Form content - centered */}
      <div className="flex-1 flex flex-col justify-center">
        <div className="w-full max-w-[380px] mx-auto">
          <h1 className="font-display text-[32px] sm:text-[40px] font-bold tracking-[0.03em] uppercase mb-3 leading-none text-text-primary">
            Welcome back
          </h1>
          <p className="text-text-secondary text-[15px] mb-9">
            Enter your password to continue.
          </p>

        <NotWired
          title="Not wired"
          detail="Meridian signs in with a single password, not OAuth. POST /api/auth/login is live; this form still needs its password field."
          className="text-left"
        />

        {/* Divider */}
        <div className="flex items-center gap-4 my-7">
          <div className="flex-1 h-px bg-border/10 dark:bg-border" />
          <span className="text-[11px] font-medium tracking-[0.16em] uppercase text-text-tertiary">Secure sign-in</span>
          <div className="flex-1 h-px bg-border/10 dark:bg-border" />
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center mt-12 pt-6 border-t border-border/10 dark:border-border font-mono text-[11px] text-text-tertiary tracking-[0.06em]">
          <span>© Meridian 2026</span>
          <Link href="#" className="hover:text-text-primary transition-colors">Help</Link>
        </div>
        </div>
      </div>
    </section>
  );
}
