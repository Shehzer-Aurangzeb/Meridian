import type { Metadata } from 'next';
import { PageHeader } from '@/components/features/dashboard/page-header';
import { QuickAnalyze } from '@/components/features/dashboard/quick-analyze';
import { StatsStrip } from '@/components/features/dashboard/stats-strip';
import { LatestAnalysis } from '@/components/features/dashboard/latest-analysis';
import { RecentHistory } from '@/components/features/dashboard/recent-history';
import { Watchlist } from '@/components/features/dashboard/watchlist';
import { ActiveAlerts } from '@/components/features/dashboard/active-alerts';
import { Disclaimer } from '@/components/ui/disclaimer';
import { SectionHead } from '@/components/ui/section-head';

export const metadata: Metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return (
    <>
      <PageHeader />

      <QuickAnalyze />

      <StatsStrip />

      <section className="mt-14">
        <SectionHead eyebrow="Activity" title="Today on Meridian" />

        <div className="grid grid-cols-1 lg:grid-cols-[1.45fr_1fr] gap-6">
          <div className="flex flex-col gap-6">
            <LatestAnalysis />
            <RecentHistory />
          </div>

          <div className="flex flex-col gap-6">
            <Watchlist />
            <ActiveAlerts />
          </div>
        </div>
      </section>

      <Disclaimer
        text="For research purposes. Not investment advice. Always size positions to your own risk tolerance and conviction."
        variant="hero"
      />
    </>
  );
}
