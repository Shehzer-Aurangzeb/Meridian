'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Panel, PanelHead } from './panel';
import { PlusIcon } from '@/assets/icons/plus-icon';

/**
 * Watchlist item type
 */
interface WatchItem {
  symbol: string;
  name: string;
  price: string;
  change: number;
}

/**
 * Watchlist row component
 */
function WatchRow({ item }: { item: WatchItem }) {
  const isUp = item.change >= 0;

  return (
    <Link
      href={`/analysis?coin=${item.symbol}`}
      className={cn(
        'grid grid-cols-[1fr_auto_auto] gap-3.5 items-center',
        'px-6 py-3.5 border-b border-border/10 dark:border-border',
        'no-underline text-inherit',
        'transition-colors duration-[160ms]',
        'hover:bg-primary/[0.025]',
        'last:border-b-0'
      )}
    >
      <span className="font-antonio text-[17px] font-semibold tracking-[0.04em] uppercase">
        {item.symbol}
        <span className="block font-inter text-[11px] font-normal text-text-tertiary normal-case tracking-normal mt-0.5">
          {item.name}
        </span>
      </span>
      
      <span className="font-mono text-[13px] text-text-primary text-right">
        {item.price}
      </span>
      
      <span
        className={cn(
          'font-mono text-xs min-w-16 text-right',
          isUp ? 'text-sage' : 'text-rust'
        )}
      >
        {isUp ? '+ ' : '− '}{Math.abs(item.change).toFixed(2)}%
      </span>
    </Link>
  );
}

/**
 * Add coin button
 */
function AddButton() {
  return (
    <button
      type="button"
      className={cn(
        'flex gap-2.5 items-center',
        'bg-transparent border-0',
        'text-text-secondary text-[13px] cursor-pointer p-0',
        'hover:text-primary transition-colors'
      )}
    >
      <span className="w-[22px] h-[22px] rounded-full border border-dashed border-border-hover/18 dark:border-border-hover grid place-items-center text-sm">
        <PlusIcon className="w-3 h-3" />
      </span>
      Add a coin to watch
    </button>
  );
}

/**
 * Mock watchlist data
 */
const MOCK_WATCHLIST: WatchItem[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: '$43,310', change: -1.84 },
  { symbol: 'ETH', name: 'Ethereum', price: '$2,418', change: 0.62 },
  { symbol: 'SOL', name: 'Solana', price: '$148.22', change: 2.1 },
  { symbol: 'LINK', name: 'Chainlink', price: '$14.82', change: -0.41 },
  { symbol: 'AVAX', name: 'Avalanche', price: '$36.71', change: 1.18 },
];

/**
 * Watchlist panel
 */
export function Watchlist() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <Panel>
      <PanelHead title="Watchlist" meta={`Live · ${timeStr}`} />
      
      <div>
        {MOCK_WATCHLIST.map((item) => (
          <WatchRow key={item.symbol} item={item} />
        ))}
      </div>
      
      <div className="px-6 py-3.5 border-t border-border/10 dark:border-border">
        <AddButton />
      </div>
    </Panel>
  );
}
