'use client';

import { useState, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { CloseIcon } from '@/components/ui/icons';

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
      {/* Desktop layout with sidebar */}
      <div className="hidden md:grid md:grid-cols-[260px_1fr]">
        <Sidebar />
        <main className="min-w-0">
          <Topbar />
          <div className="max-w-content-max mx-auto px-5 md:px-10 py-8 md:py-14 pb-24">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile layout without sidebar */}
      <div className="md:hidden">
        <Topbar onMenuClick={handleMenuOpen} />
        <main className="px-5 py-8 pb-16">
          {children}
        </main>
      </div>

      {/* Mobile sidebar drawer */}
      <MobileSidebar isOpen={mobileMenuOpen} onClose={handleMenuClose} />
    </div>
  );
}
