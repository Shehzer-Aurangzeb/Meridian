import { ReactNode } from 'react';
import { AppShell } from './AppShell';

interface DashboardLayoutProps {
  children: ReactNode;
}

/**
 * Dashboard layout wrapper
 * Uses AppShell for consistent navigation and responsive behavior
 */
export function DashboardLayout({ children }: DashboardLayoutProps) {
  return <AppShell>{children}</AppShell>;
}
