'use client';

import { useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { CloseIcon } from '@/assets/icons/close-icon';

function MobileSidebar({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-primary/40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="absolute inset-y-0 left-0 w-[280px] animate-slide-in-left">
        <Sidebar className="w-full" />
        
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className={cn(
            'absolute top-4 right-4',
            'w-8 h-8 rounded-full',
            'bg-gold/10 hover:bg-gold/20',
            'grid place-items-center',
            'text-sidebar-text transition-colors',
          )}
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleMenuOpen = useCallback(() => {
    setMobileMenuOpen(true);
  }, []);

  const handleMenuClose = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* `children` is rendered ONCE. It used to appear twice — a desktop
          branch and a mobile branch, one of them hidden by CSS — which mounted
          every page twice: two sets of hooks, two fetches, and two independent
          copies of any form state. A hidden chart also measures zero width, so
          its candles collapse against the right edge. */}
      <div className="md:grid md:grid-cols-[260px_1fr]">
        <Sidebar className="max-md:hidden" />
        <main className="min-w-0">
          <Topbar onMenuClick={handleMenuOpen} />
          {/* The shell owns page padding — pages add none. Five of them used
              to add `p-5 md:p-8 lg:p-10` on top of this, which is how history
              ended up with 80px of gutter on a desktop. */}
          <div className="mx-auto max-w-content-max px-5 py-8 pb-16 md:px-8 md:py-10 md:pb-24">
            {children}
          </div>
        </main>
      </div>

      <MobileSidebar isOpen={mobileMenuOpen} onClose={handleMenuClose} />
    </div>
  );
}
