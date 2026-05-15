import {
  PageHeader,
  QuickAnalyze,
  StatsStrip,
  LatestAnalysis,
  RecentHistory,
  Watchlist,
  ActiveAlerts,
  Disclaimer,
} from '@/components/features/dashboard';
import { SectionHead } from '@/components/ui/section-head';

export default function DashboardPage() {
  return (
    <>
      <PageHeader />

      <QuickAnalyze />

      <StatsStrip />

      {/* Activity Section - Two Column Grid */}
      <section className="mt-14">
        <SectionHead eyebrow="Activity" title="Today on Meridian" />

        <div className="grid grid-cols-1 lg:grid-cols-[1.45fr_1fr] gap-6">
          {/* Left Column */}
          <div className="flex flex-col gap-6">
            <LatestAnalysis />
            <RecentHistory />
          </div>

          {/* Right Column */}
          <div className="flex flex-col gap-6">
            <Watchlist />
            <ActiveAlerts />
          </div>
        </div>
      </section>

      <Disclaimer />
    </>
  );
}
