import type { Metadata } from 'next';

/** See history/layout.tsx — the page is a client component. */
export const metadata: Metadata = { title: 'New analysis' };

export default function AnalysisLayout({ children }: { children: React.ReactNode }) {
  return children;
}
