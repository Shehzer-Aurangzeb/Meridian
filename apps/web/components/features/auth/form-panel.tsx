'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLogin } from '@/lib/hooks/use-auth';

/**
 * Where to go after signing in. Anyone can send you a sign-in link with this
 * set to any address, so only paths inside this site are followed.
 *
 * Both of the first two characters matter: an address starting `//` or `/\`
 * points at another website, not at a page here.
 */
function safeNext(value: string | null): string {
  if (!value || value[0] !== '/' || value[1] === '/' || value[1] === '\\') {
    return '/dashboard';
  }
  return value;
}

export function FormPanel() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const login = useLogin(safeNext(searchParams.get('next')));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password) login.mutate(password);
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
            Meridian takes one password — there is no account to create.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <Input
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              autoFocus
              required
              error={login.error ? login.error.message : undefined}
            />

            <Button
              type="submit"
              size="lg"
              className="w-full rounded-full"
              loading={login.isPending}
              disabled={!password}
            >
              {login.isPending ? 'Signing in' : 'Sign in'}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-7">
            <div className="flex-1 h-px bg-border/10 dark:bg-border" />
            <span className="text-[11px] font-medium tracking-[0.16em] uppercase text-text-tertiary">Secure sign-in</span>
            <div className="flex-1 h-px bg-border/10 dark:bg-border" />
          </div>

          <p className="text-center text-[13px] text-text-tertiary">
            The password is checked on the server and exchanged for a session
            cookie. It is never stored in your browser.
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
