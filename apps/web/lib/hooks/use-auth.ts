'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { fetchApi, isUnauthorized } from '@/lib/api/client';
import { queryKeys } from './query-keys';

/** Check `isPending` before treating `data` as "signed out". */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => fetchApi<{ authenticated: true }>('/api/auth/me'),
    // A 401 is the answer, not a failure.
    retry: (failureCount, error) => !isUnauthorized(error) && failureCount < 2,
    staleTime: 5 * 60 * 1000,
  });
}

/** `next` must already be validated as a same-origin path by the caller. */
export function useLogin(next = '/dashboard') {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (password: string) =>
      fetchApi<{ ok: true }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      // replace, not push: going Back to the sign-in form after signing in
      // would only bounce off middleware.
      router.replace(next);
      // Middleware gates on the cookie the server just set, and the cached
      // router tree predates it.
      router.refresh();
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => fetchApi<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      // Everything cached was fetched with a credential that no longer exists.
      queryClient.clear();
      router.push('/sign-in');
      router.refresh();
    },
  });
}
