// Legacy components (to be deprecated)
export { AnalysisError } from './analysis-error';
export { AnalysisForm } from './analysis-form';
export { AnalysisLoading } from './analysis-loading';
export { AnalysisResults } from './analysis-results';

// New design components
export { AnalysisPageHeader } from './analysis-page-header';
export { AnalysisInput, type Timeframe } from './analysis-input';
export {
  SignalCard,
  MOCK_SIGNAL,
  type SignalData,
  type SignalDirection,
  type PriceLevel,
} from './signal-card';
export {
  IndicatorsSection,
  MOCK_INDICATORS,
  type IndicatorData,
  type RSIIndicator,
  type BollingerIndicator,
  type ATRIndicator,
  type IndicatorFlag,
} from './indicators-section';
export {
  ReasoningSection,
  MOCK_REASONING,
  type ReasoningData,
  type ConditionItem,
} from './reasoning-section';
