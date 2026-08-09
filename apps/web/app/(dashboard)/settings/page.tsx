'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { SettingsPageHeader } from '@/components/features/settings/settings-page-header';
import { SettingsRail } from '@/components/features/settings/settings-rail';
import { ProfileCard } from '@/components/features/settings/profile-card';
import { AccountCard } from '@/components/features/settings/account-card';
import { DangerZoneCard } from '@/components/features/settings/danger-zone-card';
import { Disclaimer } from '@/components/ui/disclaimer';

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
  const handleSaveProfile = useCallback(() => {}, []);
  const handleConnect = useCallback((_id: string) => {}, []);
  const handleSignOut = useCallback(() => {}, []);
  const handleExport = useCallback(() => {}, []);
  const handleDelete = useCallback(() => {}, []);

  return (
    <div>
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

      <Disclaimer text="Meridian stores your data on encrypted infrastructure. Read our privacy policy and security notes for the technical detail." />
    </div>
  );
}
