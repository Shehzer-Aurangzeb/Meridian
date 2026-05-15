'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  SettingsPageHeader,
  SettingsRail,
  ProfileCard,
  AccountCard,
  DangerZoneCard,
} from '@/components/features/settings';

/**
 * Disclaimer footer
 */
function Disclaimer() {
  return (
    <footer className="flex items-center justify-between text-xs text-text-tertiary mt-10 pt-6 border-t border-border/10 dark:border-border">
      <div>
        Meridian stores your data on encrypted infrastructure. Read our privacy policy and security notes for the technical detail.
      </div>
      <div className="font-display text-sm font-medium tracking-[0.04em]">Meridian</div>
    </footer>
  );
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('profile');
  const profileRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const dangerRef = useRef<HTMLDivElement>(null);

  // Scroll to section
  const handleNavigate = useCallback((sectionId: string) => {
    const refs: Record<string, React.RefObject<HTMLDivElement | null>> = {
      profile: profileRef,
      account: accountRef,
      danger: dangerRef,
    };
    
    const ref = refs[sectionId];
    if (ref?.current) {
      const top = ref.current.offsetTop - 100;
      window.scrollTo({ top, behavior: 'smooth' });
    }
    setActiveSection(sectionId);
  }, []);

  // Update active section on scroll
  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY + 140;
      const sections = [
        { id: 'profile', ref: profileRef },
        { id: 'account', ref: accountRef },
        { id: 'danger', ref: dangerRef },
      ];

      let active = 'profile';
      for (const section of sections) {
        if (section.ref.current && section.ref.current.offsetTop <= y) {
          active = section.id;
        }
      }
      setActiveSection(active);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Handlers - TODO: Implement these
  const handleSaveProfile = () => {};
  const handleConnect = (_id: string) => {};
  const handleSignOut = () => {};
  const handleExport = () => {};
  const handleDelete = () => {};

  return (
    <div className="p-5 md:p-8 lg:p-10">
      <SettingsPageHeader />

      <section>
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-8 lg:gap-12 items-start">
          <SettingsRail activeSection={activeSection} onNavigate={handleNavigate} />

          <div>
            <div ref={profileRef}>
              <ProfileCard onSave={handleSaveProfile} />
            </div>
            <div ref={accountRef}>
              <AccountCard onConnect={handleConnect} onSignOut={handleSignOut} />
            </div>
            <div ref={dangerRef}>
              <DangerZoneCard onExport={handleExport} onDelete={handleDelete} />
            </div>
          </div>
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
