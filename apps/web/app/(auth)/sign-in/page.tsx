'use client';

import Link from 'next/link';

/**
 * Google icon
 */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="w-[18px] h-[18px]">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 44 24c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.5-5.2l-6.2-5.3A12 12 0 0 1 13 28.1l-6.5 5A20 20 0 0 0 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.5l6.2 5.3C36.9 41.2 44 36 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

/**
 * Apple icon
 */
function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] fill-current">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

/**
 * Brand panel (left side) - Desktop only
 */
function BrandPanel() {
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

/**
 * Form panel (right side)
 */
function FormPanel() {
  const handleGoogleSignIn = () => {
    // TODO: Implement Google OAuth
    // For now, redirect to dashboard for demo
    window.location.href = '/dashboard';
  };

  const handleAppleSignIn = () => {
    // TODO: Implement Apple OAuth
    // For now, redirect to dashboard for demo
    window.location.href = '/dashboard';
  };

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
            Sign in to pick up where you left off. New here? You'll be set up automatically.
          </p>

        {/* OAuth buttons */}
        <button
          onClick={handleGoogleSignIn}
          className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-surface border border-border/20 dark:border-border rounded-full text-sm font-medium text-text-primary hover:bg-surface-hover hover:border-border-hover/18 dark:hover:border-border-hover transition-colors mb-3"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <button
          onClick={handleAppleSignIn}
          className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-primary border border-primary rounded-full text-sm font-medium text-background hover:opacity-90 transition-colors"
        >
          <AppleIcon />
          Continue with Apple
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4 my-7">
          <div className="flex-1 h-px bg-border/10 dark:bg-border" />
          <span className="text-[11px] font-medium tracking-[0.16em] uppercase text-text-tertiary">Secure sign-in</span>
          <div className="flex-1 h-px bg-border/10 dark:bg-border" />
        </div>

        {/* Terms */}
        <p className="text-center text-[13px] text-text-secondary">
          By continuing you agree to our{' '}
          <Link href="#" className="text-text-primary underline decoration-gold underline-offset-4">Terms</Link>
          {' '}and{' '}
          <Link href="#" className="text-text-primary underline decoration-gold underline-offset-4">Privacy policy</Link>.
          We'll never post or message on your behalf.
        </p>

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

/**
 * Sign In Page
 */
export default function SignInPage() {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      <BrandPanel />
      <FormPanel />
    </div>
  );
}
