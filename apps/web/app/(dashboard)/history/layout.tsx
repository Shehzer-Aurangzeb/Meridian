import type { Metadata } from 'next';

/**
 * A layout only so the title has somewhere to live: page.tsx is a client
 * component, and `metadata` is server-only. Covers /history/[id] too.
 */
export const metadata: Metadata = { title: 'History' };

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
