'use client';
import { USER } from '@/lib/constants';

export interface OAuthConnection {
  id: string;
  provider: 'google' | 'apple';
  name: string;
  email?: string;
  connected: boolean;
}

export const DEFAULT_CONNECTIONS: OAuthConnection[] = [
  { id: '1', provider: 'google', name: 'Google', email: USER.email, connected: true },
  { id: '2', provider: 'apple', name: 'Apple', connected: false },
];

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="w-[18px] h-[18px]">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 44 24c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.5-5.2l-6.2-5.3A12 12 0 0 1 13 28.1l-6.5 5A20 20 0 0 0 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.5l6.2 5.3C36.9 41.2 44 36 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px]">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

interface OAuthRowProps {
  connection: OAuthConnection;
  onConnect?: (id: string) => void;
  isLast?: boolean;
}

function OAuthRow({ connection, onConnect, isLast }: OAuthRowProps) {
  return (
    <div className={`flex items-center justify-between py-4 ${!isLast ? 'border-b border-border/10 dark:border-border' : ''}`}>
      <div className="flex items-center gap-3.5">
        <div className="w-9 h-9 rounded-lg bg-background border border-border/10 dark:border-border flex items-center justify-center flex-shrink-0">
          {connection.provider === 'google' ? <GoogleIcon /> : <AppleIcon />}
        </div>
        <div>
          <div className="text-sm font-medium text-text-primary">{connection.name}</div>
          <div className="text-xs text-text-tertiary font-mono tracking-[0.04em] mt-0.5">
            {connection.connected ? connection.email : 'Not connected'}
          </div>
        </div>
      </div>
      {connection.connected ? (
        <span className="text-[11px] font-semibold tracking-[0.16em] uppercase text-text-primary bg-sage/20 px-2.5 py-1 rounded">
          Connected
        </span>
      ) : (
        <button
          onClick={() => onConnect?.(connection.id)}
          className="px-4 py-2 border border-border/10 dark:border-border rounded-full text-[13px] font-medium text-text-primary hover:border-border-hover/18 dark:hover:border-border-hover transition-colors"
        >
          Connect
        </button>
      )}
    </div>
  );
}

interface AccountCardProps {
  connections?: OAuthConnection[];
  onConnect?: (id: string) => void;
  onSignOut?: () => void;
}

export function AccountCard({
  connections = DEFAULT_CONNECTIONS,
  onConnect,
  onSignOut,
}: AccountCardProps) {
  return (
    <div id="account" className="bg-surface border border-border/10 dark:border-border rounded-lg p-6 md:p-9 mb-6">
      <h2 className="font-display text-[26px] font-semibold tracking-[0.04em] uppercase text-text-primary mb-1.5">
        Account
      </h2>
      <p className="text-sm text-text-secondary mb-7 max-w-md">
        You signed in with a connected account. Manage how you authenticate to Meridian.
      </p>

      {/* OAuth connections */}
      {connections.map((conn, idx) => (
        <OAuthRow
          key={conn.id}
          connection={conn}
          onConnect={onConnect}
          isLast={idx === connections.length - 1}
        />
      ))}

      {/* Sign out */}
      <div className="flex justify-end mt-2">
        <button
          onClick={onSignOut}
          className="inline-flex items-center gap-2 px-4 py-2 border border-border/10 dark:border-border rounded-full text-[13px] font-medium text-text-primary hover:border-border-hover/18 dark:hover:border-border-hover transition-colors"
        >
          <SignOutIcon />
          Sign out
        </button>
      </div>
    </div>
  );
}
