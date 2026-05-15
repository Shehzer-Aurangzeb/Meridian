'use client';

import { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { ThemeProvider } from '@/components/ThemeProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        {children}
      </ToastProvider>
    </ThemeProvider>
  );
}
