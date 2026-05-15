'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from '@/lib/constants';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';

export function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const pageTitle = NAV_ITEMS.find((item) => item.href === pathname)?.label || 'Meridian';

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/[0.06] dark:border-border">
      <div className="flex items-center justify-between h-16 px-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 -ml-2 text-text-primary hover:text-gold transition-colors duration-200"
            aria-label="Toggle menu"
          >
            <MenuIcon open={mobileMenuOpen} className="w-6 h-6" />
          </button>
          <h1 className="font-antonio text-xl font-semibold uppercase tracking-headline text-text-primary">
            {pageTitle}
          </h1>
        </div>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'px-4 py-2 rounded-lg font-inter text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-primary/5 text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-primary/[0.02]'
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <AnimatedCollapse open={mobileMenuOpen} className="lg:hidden">
        <div className="border-t border-border/[0.08] dark:border-border bg-surface">
          <nav className="p-4 space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'block px-4 py-3 rounded-lg font-inter text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-primary text-background'
                      : 'text-text-primary hover:bg-primary/5'
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </AnimatedCollapse>
    </header>
  );
}

function MenuIcon({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path
        className="transition-all duration-200 origin-center"
        strokeLinecap="round"
        strokeLinejoin="round"
        d={open 
          ? "M6 18L18 6M6 6l12 12" 
          : "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
        }
      />
    </svg>
  );
}
