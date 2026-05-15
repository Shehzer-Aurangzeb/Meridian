import {
  DashboardIcon,
  AnalysisIcon,
  HistoryIcon,
  AlertIcon,
  StrategiesIcon,
} from '@/components/ui/icons';
import { ComponentType, SVGProps } from 'react';

/**
 * Navigation item type
 */
export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  badge?: number;
}

/**
 * Navigation section type
 */
export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Main navigation structure following the design system
 */
export const NAVIGATION: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
      { href: '/analysis', label: 'Analysis', icon: AnalysisIcon },
      { href: '/history', label: 'History', icon: HistoryIcon },
      { href: '/alerts', label: 'Alerts', icon: AlertIcon, badge: 3 },
    ],
  },
  {
    label: 'Library',
    items: [
      { href: '/strategies', label: 'Strategies', icon: StrategiesIcon },
    ],
  },
];

/**
 * Flat list of all navigation items for quick access
 */
export const NAV_ITEMS = NAVIGATION.flatMap((section) => section.items);

/**
 * Page titles for breadcrumbs
 */
export const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/analysis': 'Analysis',
  '/history': 'History',
  '/alerts': 'Alerts',
  '/strategies': 'Strategies',
  '/settings': 'Settings',
};
