import { cn } from '@/lib/utils';
import { Body } from '@/components/ui/body';

interface AnalysisErrorProps {
  message: string;
  onRetry: () => void;
}

export function AnalysisError({ message, onRetry }: AnalysisErrorProps) {
  return (
    <div className="mt-12 animate-fade-in">
      <div className="bg-surface border border-rust/30 rounded-xl p-8 max-w-xl mx-auto text-center">
        <Body className="mb-6">{message}</Body>
        <button
          onClick={onRetry}
          className={cn(
            'font-inter font-medium text-sm',
            'px-6 py-3 rounded-lg',
            'border border-primary text-text-primary',
            'transition-colors duration-200',
            'hover:bg-primary hover:text-background'
          )}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
