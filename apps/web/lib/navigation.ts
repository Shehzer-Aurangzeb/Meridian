import { AnalysisIcon } from '@/assets/icons/analysis-icon';
import { HistoryIcon } from '@/assets/icons/history-icon';
import { ComponentType, SVGProps } from 'react';
import { isRouteEnabled } from './feature-flags';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  badge?: number;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Two pages, because the product makes two kinds of statement.
 *
 * Dashboard, Analysis, History, Alerts and Strategies retired on 6 September
 * 2026 with the trade planner they displayed. They showed entry ladders, stops,
 * targets and R-multiples for a programme that twenty pre-registered tests
 * closed.
 *
 * The map says what the market is doing. The calibration page says how well
 * every number on it has actually done — and three of its four entries are
 * outputs that failed their bars and are published as nulls.
 */
const FULL_NAVIGATION: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/map', label: 'Map', icon: AnalysisIcon },
      { href: '/calibration', label: 'Calibration', icon: HistoryIcon },
    ],
  },
];

export function getNavigation(): NavSection[] {
  return FULL_NAVIGATION
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isRouteEnabled(item.href)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Main navigation structure following the design system
 * Filtered based on feature flags
 */
export const NAVIGATION: NavSection[] = getNavigation();

export const NAV_ITEMS = NAVIGATION.flatMap((section) => section.items);

export const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/analysis': 'Analysis',
  '/history': 'History',
  '/alerts': 'Alerts',
  '/strategies': 'Strategies',
  '/settings': 'Settings',
};
