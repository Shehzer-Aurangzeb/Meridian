/**
 * Footer disclaimer component
 */
export function Disclaimer() {
  return (
    <footer className="mt-16 border-t border-border/10 dark:border-border pt-6 text-xs text-text-tertiary tracking-[0.04em] flex justify-between gap-6 flex-wrap">
      <div>
        For research purposes. Not investment advice. Always size positions to
        your own risk tolerance and conviction.
      </div>
      <div className="font-antonio uppercase tracking-[0.18em] text-text-secondary">
        Meridian
      </div>
    </footer>
  );
}
