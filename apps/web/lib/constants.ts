// API Configuration
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Navigation
export const NAV_ITEMS = [
  { href: '/analysis', label: 'Analysis' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/history', label: 'History' },
] as const;

// Style Maps
export const SUGGESTION_STYLES = {
  LONG: 'bg-sage text-deep-green',
  SHORT: 'bg-primary text-primary-foreground',
  WAIT: 'bg-beige border border-deep-green/20 text-deep-green',
} as const;

export const STATUS_STYLES = {
  correct: 'bg-sage/20 text-sage border-sage/30',
  failed: 'bg-red-50 text-red-700 border-red-200',
  pending: 'bg-beige border-deep-green/20 text-text-secondary',
  neutral: 'bg-beige border-deep-green/20 text-text-secondary',
} as const;

export const STATUS_LABELS = {
  correct: '✓ CORRECT',
  failed: '✗ FAILED',
  pending: '◔ PENDING',
  neutral: '○ NEUTRAL',
} as const;

// Animation Durations
export const ANIMATION = {
  fast: 150,
  normal: 200,
  slow: 300,
} as const;

// Toast Duration
export const TOAST_DURATION = 4000;
