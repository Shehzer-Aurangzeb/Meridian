import { LoadingBar } from '@/components/ui/loading-bar';
import { Spinner } from '@/components/ui/spinner';

interface AnalysisLoadingProps {
  coin?: string;
}

export function AnalysisLoading({ coin }: AnalysisLoadingProps) {
  return (
    <div className="mt-12 animate-fade-in">
      <div className="bg-surface border border-border/10 dark:border-border rounded-xl p-8 max-w-xl mx-auto">
        <div className="flex flex-col items-center text-center">
          <Spinner size="lg" className="text-gold mb-4" />
          <p className="font-inter font-medium text-text-primary mb-2">
            Analyzing {coin || 'market data'}
          </p>
          <p className="font-inter text-sm text-text-secondary mb-6">
            Evaluating price action, indicators, and market structure...
          </p>
          <LoadingBar className="max-w-xs" />
        </div>
      </div>
    </div>
  );
}
