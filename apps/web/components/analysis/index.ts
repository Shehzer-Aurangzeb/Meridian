// Legacy components (to be deprecated)
export { AnalysisError } from './AnalysisError';
export { AnalysisForm } from './AnalysisForm';
export { AnalysisLoading } from './AnalysisLoading';
export { AnalysisResults } from './AnalysisResults';

// New design components
export { AnalysisPageHeader } from './AnalysisPageHeader';
export { AnalysisInput, type Timeframe } from './AnalysisInput';
export {
  SignalCard,
  MOCK_SIGNAL,
  type SignalData,
  type SignalDirection,
  type PriceLevel,
} from './SignalCard';
export {
  IndicatorsSection,
  MOCK_INDICATORS,
  type IndicatorData,
  type RSIIndicator,
  type BollingerIndicator,
  type ATRIndicator,
  type IndicatorFlag,
} from './IndicatorsSection';
export {
  ReasoningSection,
  MOCK_REASONING,
  type ReasoningData,
  type ConditionItem,
} from './ReasoningSection';
