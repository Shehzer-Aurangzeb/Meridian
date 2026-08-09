/**
 * ponytail: hardcoded. Meridian authenticates with one password and has no
 * user table, so there is nobody to look this up from. Replace with the
 * session response the day the backend grows accounts.
 */
export const USER = {
  name: 'Shehzar Abbasi',
  firstName: 'Shehzar',
  lastName: 'Abbasi',
  initials: 'SA',
  email: 'shehzar.abbasi@dedicate.com',
} as const;

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
