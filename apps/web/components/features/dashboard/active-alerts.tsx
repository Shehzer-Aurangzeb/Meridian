import { Panel, PanelHead } from './panel';
import { NotWired } from '@/components/ui/not-wired';
import { isFeatureEnabled } from '@/lib/feature-flags';

export function ActiveAlerts() {
  const isEnabled = isFeatureEnabled('ALERTS');

  return (
    <Panel>
      <PanelHead
        title="Active alerts"
        linkText={isEnabled ? 'VIEW ALL →' : undefined}
        linkHref={isEnabled ? '/alerts' : undefined}
      />

      {isEnabled ? (
        <div className="p-6 text-center text-text-tertiary text-sm">
          <p>No active alerts. Set up alerts to get notified when conditions are met.</p>
        </div>
      ) : (
        <NotWired
          title="Coming soon"
          detail="Set price alerts and get notified when conditions are met."
          className="border-0 rounded-none"
        />
      )}
    </Panel>
  );
}
