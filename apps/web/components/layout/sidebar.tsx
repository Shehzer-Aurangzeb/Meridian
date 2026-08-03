'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAVIGATION, type NavItem } from '@/lib/navigation';
import { isFeatureEnabled } from '@/lib/feature-flags';


function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-3 px-7 pb-9 no-underline">
      <div className="relative w-7 h-7 rounded-full border-[1.5px] border-gold shrink-0">
        <div 
          className="absolute inset-[5px] rounded-full bg-gold"
          style={{ clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 50% 50%)' }}
        />
      </div>
      <span className="font-antonio font-bold text-[22px] tracking-[0.14em] uppercase text-sidebar-text">
        Meridian
      </span>
    </Link>
  );
}


function NavSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.18em] text-gold/55 font-medium px-7 pb-3 mt-1">
      {children}
    </div>
  );
}


function NavItemLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const Icon = item.icon;
  
  return (
    <Link
      href={item.href}
      className={cn(
        'relative flex items-center gap-3.5 px-4 py-[11px] ml-4 mr-4',
        'text-[14px] font-medium rounded-lg',
        'transition-all duration-[160ms] ease-out',
        'no-underline',
        isActive
          ? 'bg-gold/[0.08] text-sidebar-text'
          : 'text-sidebar-text/70 hover:bg-gold/[0.06] hover:text-sidebar-text'
      )}
    >
      {/* Active indicator bar */}
      {isActive && (
        <span className="absolute left-[-16px] top-2 bottom-2 w-[3px] bg-gold rounded-r-sm" />
      )}
      
      <Icon className={cn('w-[17px] h-[17px] shrink-0 opacity-90')} />
      
      <span>{item.label}</span>
      
      {/* Badge for alerts etc */}
      {item.badge !== undefined && item.badge > 0 && (
        <span className="ml-auto font-mono text-[11px] text-gold/60 tracking-[0.04em]">
          {item.badge}
        </span>
      )}
    </Link>
  );
}


function UserProfile() {
  const showSettings = isFeatureEnabled('SETTINGS');
  
  const content = (
    <>
      <div 
        className="w-[34px] h-[34px] rounded-full shrink-0 grid place-items-center text-text-primary font-semibold text-[13px] font-inter"
        style={{ background: 'linear-gradient(135deg, rgb(var(--gold-ink)), rgb(var(--gold-dark)))' }}
      >
        EM
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] text-sidebar-text font-medium truncate">Elena Marchetti</span>
        <span className="text-[11px] text-gold/55 tracking-[0.08em] uppercase">Atelier · Pro</span>
      </div>
    </>
  );
  
  return (
    <div className="mt-auto pt-6 px-7 border-t border-gold/[0.08]">
      {showSettings ? (
        <Link href="/settings" className="flex items-center gap-3 no-underline">
          {content}
        </Link>
      ) : (
        <div className="flex items-center gap-3">
          {content}
        </div>
      )}
    </div>
  );
}

/**
 * Sidebar props
 */
interface SidebarProps {
  className?: string;
}

/**
 * Main sidebar component
 * Displays navigation grouped by sections with user profile at bottom
 */
export function Sidebar({ className }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'bg-sidebar-bg text-sidebar-text',
        'flex flex-col',
        'py-8 pb-6',
        'border-r border-gold/[0.08]',
        'h-screen sticky top-0',
        'w-sidebar',
        className
      )}
    >
      <Brand />

      <nav className="flex-1 overflow-y-auto">
        {NAVIGATION.map((section, idx) => (
          <div key={section.label} className={cn(idx > 0 && 'mt-6')}>
            <NavSectionLabel>{section.label}</NavSectionLabel>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <NavItemLink
                  key={item.href}
                  item={item}
                  isActive={pathname === item.href}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <UserProfile />
    </aside>
  );
}
