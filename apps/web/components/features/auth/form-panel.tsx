'use client';

import Link from 'next/link';

import { GoogleIcon } from '@/assets/icons/google-icon';
import { AppleIcon } from '@/assets/icons/apple-icon';

export function FormPanel() {
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
