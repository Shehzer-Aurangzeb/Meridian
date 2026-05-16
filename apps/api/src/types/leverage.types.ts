export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export type TradeStyle = 'swing' | 'day' | 'scalp' | 'ultra-scalp';

export interface LeverageInput {
  // Trade parameters
  timeframe: string;                    // '1d', '4h', '1h', etc.
  checklistScore: number;               // 0-100
  atr: number;                          // Average True Range
  currentPrice: number;                 // Current asset price
  
  // Risk parameters
  stopLossPercentage: number;           // Distance to stop loss
  tradeStyle?: TradeStyle;              // Override trade style
  
  // Trader parameters
  experienceLevel: ExperienceLevel;     // User's experience
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
  
  // Market conditions
  volatilityIndex?: number;             // Optional: current market volatility
  marketCycle?: 'bull' | 'bear' | 'ranging'; // Optional: current cycle
}

export interface LeverageRecommendation {
  // Main recommendation
  recommended: number;                  // Primary suggestion (e.g., 5)
  
  // Alternative options
  conservative: number;                 // Lower risk option
  moderate: number;                     // Balanced option (same as recommended)
  aggressive: number;                   // Higher risk option
  
  // Justification
  reasoning: string;                    // Why this leverage was chosen
  adjustments: string[];                // What factors influenced the decision
  
  // Risk information
  liquidationPrice: number;             // Where liquidation occurs
  liquidationDistance: string;          // '10% below entry'
  maxDrawdown: string;                  // Maximum loss before liquidation
  
  // Warnings
  warnings: string[];                   // Any cautions about this leverage
  
  // Metadata
  tradeStyle: TradeStyle;               // Inferred trade style
  riskLevel: 'low' | 'medium' | 'high' | 'very-high';
}

export interface LeverageConstraints {
  min: number;
  max: number;
  reason: string;
}
