/**
 * Position Sizing Types
 * Based on Miraj's risk management rules:
 * - 1-2% risk per trade
 * - Portfolio allocation: 60% long-term, 20% mid-term, 20% short-term
 */

export interface PositionSizingInput {
  accountBalance: number; // Total account in USD
  riskPercentage: number; // 1 or 2 (percent)
  entryPrice: number; // Entry point
  stopLoss: number; // Stop loss price
  leverage: number; // 1x to 20x
}

export interface PositionSizingResult {
  // Core calculations
  riskAmount: number; // Dollar amount at risk (1-2% of account)
  positionSize: number; // Total position size in USD
  coinAmount: number; // How many coins to buy

  // Leverage details
  margin: number; // Actual capital required (positionSize / leverage)
  marginPercentage: number; // What % of account is used as margin

  // Stop loss details
  stopLossDistance: number; // Dollars between entry and stop
  stopLossPercentage: number; // Percentage stop loss

  // Liquidation
  liquidationPrice: number; // Price at which position liquidates
  liquidationDistance: number; // How far from entry to liquidation

  // Risk metrics
  riskRewardRatio: number; // Based on TP levels (0 if not calculated)
  maxLoss: number; // If stop hit (should equal riskAmount)

  // Trade direction
  direction: 'long' | 'short';

  // Validation
  isValid: boolean;
  warnings: string[];
}

export interface RiskRewardResult {
  overall: number; // Weighted average R:R
  tp1: number; // R:R at TP1
  tp2: number; // R:R at TP2
  tp3: number; // R:R at TP3
}

export interface PortfolioAllocation {
  totalBalance: number;

  longTerm: {
    allocation: number; // 60% of balance
    leverage: 1;
    purpose: string;
  };

  midTerm: {
    allocation: number; // 20% of balance
    leverage: 2 | 3;
    purpose: string;
  };

  shortTerm: {
    allocation: number; // 20% of balance
    leverage: 5 | 10;
    purpose: string;
  };
}

export type PortfolioType = 'longTerm' | 'midTerm' | 'shortTerm';
