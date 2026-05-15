/**
 * Mock data for development and placeholder content
 */

export const MOCK_COINS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'FET', name: 'Fetch.ai' },
  { symbol: 'TRX', name: 'TRON' },
  { symbol: 'RNDR', name: 'Render' },
] as const;

export type MockCoin = typeof MOCK_COINS[number];
