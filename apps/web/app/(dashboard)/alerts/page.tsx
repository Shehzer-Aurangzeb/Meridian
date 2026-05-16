'use client';

import { useState, useCallback } from 'react';
import { AlertsPageHeader } from '@/components/features/alerts/alerts-page-header';
import { AlertTabs, ALERTS_TABS } from '@/components/features/alerts/alert-tabs';
import {
  AlertList,
  AlertSectionHeader,
  MOCK_PRICE_ALERTS,
  MOCK_SIGNAL_ALERTS,
  MOCK_INDICATOR_ALERTS,
} from '@/components/features/alerts/alert-row';
import type { AlertData } from '@/components/features/alerts/alert-row';
import {
  TriggeredSectionHeader,
  TriggeredAlertsList,
  MOCK_TRIGGERED_ALERTS,
} from '@/components/features/alerts/triggered-alerts';
import { Disclaimer } from '@/components/ui/disclaimer';

export default function AlertsPage() {
  const [activeTab, setActiveTab] = useState('active');
  const [priceAlerts, setPriceAlerts] = useState<AlertData[]>(MOCK_PRICE_ALERTS);
  const [signalAlerts, setSignalAlerts] = useState<AlertData[]>(MOCK_SIGNAL_ALERTS);
  const [indicatorAlerts, setIndicatorAlerts] = useState<AlertData[]>(MOCK_INDICATOR_ALERTS);

  const handleNewAlert = useCallback(() => {
    // TODO: Open new alert modal
  }, []);

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    const updateAlerts = (alerts: AlertData[]) =>
      alerts.map((a) => (a.id === id ? { ...a, enabled } : a));

    setPriceAlerts(updateAlerts);
    setSignalAlerts(updateAlerts);
    setIndicatorAlerts(updateAlerts);
  }, []);

  const handleClearTriggered = useCallback(() => {
    // TODO: Clear triggered alerts
  }, []);

  return (
    <div className="p-5 md:p-8 lg:p-10">
      <AlertsPageHeader onNewAlert={handleNewAlert} />

      <section>
        <AlertTabs tabs={ALERTS_TABS} activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === 'active' && (
          <>
            <AlertSectionHeader title="Price alerts" count={priceAlerts.length} />
            <AlertList alerts={priceAlerts} onToggle={handleToggle} />

            <AlertSectionHeader title="Signal alerts" count={signalAlerts.length} className="mt-8" />
            <AlertList alerts={signalAlerts} onToggle={handleToggle} />

            <AlertSectionHeader title="Indicator alerts" count={indicatorAlerts.length} className="mt-8" />
            <AlertList alerts={indicatorAlerts} onToggle={handleToggle} />

            <TriggeredSectionHeader onClearAll={handleClearTriggered} />
            <TriggeredAlertsList alerts={MOCK_TRIGGERED_ALERTS} />
          </>
        )}

        {activeTab === 'triggered' && (
          <>
            <TriggeredSectionHeader onClearAll={handleClearTriggered} />
            <TriggeredAlertsList alerts={MOCK_TRIGGERED_ALERTS} />
          </>
        )}

        {activeTab === 'paused' && (
          <div className="bg-surface border border-border/10 dark:border-border rounded-lg p-8 text-center">
            <div className="text-text-tertiary text-sm">No paused alerts</div>
          </div>
        )}
      </section>

      <Disclaimer text="Alerts are checked at the close of each candle on the chosen timeframe. Delivery may lag by a few minutes during exchange congestion." />
    </div>
  );
}
