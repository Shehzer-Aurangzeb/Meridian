import { redirect } from 'next/navigation';

/**
 * Root page - redirects based on auth status
 * 
 * TODO: When auth is implemented, check session here:
 * - If authenticated → redirect to /dashboard
 * - If not authenticated → redirect to /sign-in
 * 
 * For now, redirects to sign-in (demo mode)
 */
export default function Home() {
  // TODO: Replace with actual auth check
  const isAuthenticated = false;

  if (isAuthenticated) {
    redirect('/dashboard');
  } else {
    redirect('/sign-in');
  }
}
