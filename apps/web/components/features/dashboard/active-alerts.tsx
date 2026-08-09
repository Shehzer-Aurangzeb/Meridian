import { cn } from '@/lib/utils';
import { Panel, PanelHead } from './panel';
import { isFeatureEnabled } from '@/lib/feature-flags';

export function ActiveAlerts() {
  const isEnabled = isFeatureEnabled('ALERTS');

  return (
    <Panel>
      <PanelHead 
        title="Active alerts" 
        linkText={isEnabled ? "VIEW ALL →" : undefined}
        linkHref={isEnabled ? "/alerts" : undefined}
      />
      
      <div className="p-6 text-center">
        <div className="text-text-tertiary text-sm">
          {isEnabled ? (
            <p>No active alerts. Set up alerts to get notified when conditions are met.</p>
          ) : (
            <>
              <p className="text-gold-ink font-medium mb-1">Coming Soon</p>
              <p>Set price alerts and get notified when conditions are met.</p>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
