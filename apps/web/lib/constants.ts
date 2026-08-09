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
