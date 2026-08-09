import { redirect } from 'next/navigation';

/** Middleware sends this to /sign-in when there is no session cookie. */
export default function Home() {
  redirect('/dashboard');
}
