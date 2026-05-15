'use client';

import { useState } from 'react';
import {
  AlertsPageHeader,
  AlertTabs,
  AlertList,
  AlertSectionHeader,
  TriggeredSectionHeader,
  TriggeredAlertsList,
  MOCK_PRICE_ALERTS,
  MOCK_SIGNAL_ALERTS,
  MOCK_INDICATOR_ALERTS,
  MOCK_TRIGGERED_ALERTS,
} from '@/components/features/alerts';
import type { AlertTab, AlertData } from '@/components/features/alerts';

/**
 * Disclaimer footer
 */
function Disclaimer() {
  return (
    <footer className="flex items-center justify-between text-xs text-text-tertiary mt-10 pt-6 border-t border-border/10 dark:border-border">
      <div>
        Alerts are checked at the close of each candle on the chosen timeframe. Delivery may lag by a few minutes during exchange congestion.
      </div>
      <div className="font-display text-sm font-medium tracking-[0.04em]">Meridian</div>
    </footer>
  );
}

/**
 * Tab definitions
 */
const TABS: AlertTab[] = [
  { id: 'active', label: 'Active', count: 8 },
  { id: 'triggered', label: 'Triggered', count: 12 },
  { id: 'paused', label: 'Paused', count: 2 },
];

export default function AlertsPage() {
  const [activeTab, setActiveTab] = useState('active');
  const [priceAlerts, setPriceAlerts] = useState<AlertData[]>(MOCK_PRICE_ALERTS);
  const [signalAlerts, setSignalAlerts] = useState<AlertData[]>(MOCK_SIGNAL_ALERTS);
  const [indicatorAlerts, setIndicatorAlerts] = useState<AlertData[]>(MOCK_INDICATOR_ALERTS);

  const handleNewAlert = () => {
    // TODO: Open new alert modal
  };

  const handleToggle = (id: string, enabled: boolean) => {
    // Update the alert state
    const updateAlerts = (alerts: AlertData[]) =>
      alerts.map((a) => (a.id === id ? { ...a, enabled } : a));

    setPriceAlerts(updateAlerts);
    setSignalAlerts(updateAlerts);
    setIndicatorAlerts(updateAlerts);
  };

  const handleClearTriggered = () => {
    // TODO: Clear triggered alerts
  };

  return (
    <div className="p-5 md:p-8 lg:p-10">
      <AlertsPageHeader onNewAlert={handleNewAlert} />

      <section>
        <AlertTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === 'active' && (
          <>
            {/* Price Alerts */}
            <AlertSectionHeader title="Price alerts" count={priceAlerts.length} />
            <AlertList alerts={priceAlerts} onToggle={handleToggle} />

            {/* Signal Alerts */}
            <AlertSectionHeader title="Signal alerts" count={signalAlerts.length} className="mt-8" />
            <AlertList alerts={signalAlerts} onToggle={handleToggle} />

            {/* Indicator Alerts */}
            <AlertSectionHeader title="Indicator alerts" count={indicatorAlerts.length} className="mt-8" />
            <AlertList alerts={indicatorAlerts} onToggle={handleToggle} />

            {/* Triggered Alerts */}
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

      <Disclaimer />
    </div>
  );
}
