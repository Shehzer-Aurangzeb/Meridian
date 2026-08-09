import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BrandPanel } from '@/components/features/auth/brand-panel';
import { FormPanel } from '@/components/features/auth/form-panel';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      <BrandPanel />
      {/* FormPanel reads ?next= via useSearchParams, which needs a boundary
          for this page to stay prerendered. */}
      <Suspense>
        <FormPanel />
      </Suspense>
    </div>
  );
}
