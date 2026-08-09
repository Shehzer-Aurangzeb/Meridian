'use client';

import { cn } from '@/lib/utils';

export interface SettingsNavItem {
  id: string;
  label: string;
  isDanger?: boolean;
}

export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'account', label: 'Account' },
  { id: 'danger', label: 'Danger zone', isDanger: true },
];

interface SettingsRailProps {
  activeSection: string;
  onNavigate: (sectionId: string) => void;
}

export function SettingsRail({ activeSection, onNavigate }: SettingsRailProps) {
  return (
    <aside className="lg:sticky lg:top-24 flex lg:flex-col gap-0.5 flex-wrap">
      {SETTINGS_NAV.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          className={cn(
            'block px-3 py-2 text-sm rounded-md text-left transition-colors',
            'border-l-2 lg:border-l-2 lg:border-b-0 border-b-2 lg:ml-0 -ml-0.5',
            activeSection === item.id
              ? item.isDanger
                ? 'text-text-primary border-rust font-medium'
                : 'text-text-primary border-gold font-medium'
              : 'text-text-secondary border-transparent hover:text-text-primary'
          )}
        >
          {item.label}
        </button>
      ))}
    </aside>
  );
}
