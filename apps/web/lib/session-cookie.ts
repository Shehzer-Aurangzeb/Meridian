/**
 * Its own file because middleware runs on the Edge runtime and cannot import
 * lib/api/server.ts, which pulls in next/headers. A name that drifts between
 * the setter and the gate fails as "signed in, then instantly signed out".
 */
export const SESSION_COOKIE = 'meridian_session';
