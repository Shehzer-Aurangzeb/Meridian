'use client';

import { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { ThemeProvider } from '@/components/theme-provider';
import { QueryProvider } from '@/components/providers/query-provider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
