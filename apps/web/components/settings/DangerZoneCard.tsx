'use client';

/**
 * Danger zone card with export and delete account
 */
interface DangerZoneCardProps {
  onExport?: () => void;
  onDelete?: () => void;
}

export function DangerZoneCard({ onExport, onDelete }: DangerZoneCardProps) {
  return (
    <div id="danger" className="bg-surface border border-rust/25 rounded-lg p-6 md:p-9 mb-6">
      <h2 className="font-display text-[26px] font-semibold tracking-[0.04em] uppercase text-rust mb-1.5">
        Danger zone
      </h2>
      <p className="text-sm text-text-secondary mb-7 max-w-md">
        Account deletion is permanent. All analyses, history, alerts, and notes are removed within 24 hours.
      </p>

      {/* Export data */}
      <div className="flex items-center justify-between py-4 border-b border-border/10 dark:border-border gap-6">
        <div>
          <div className="text-sm font-medium text-text-primary">Export your data</div>
          <div className="text-[13px] text-text-secondary mt-1 max-w-md">
            Download all your analyses, history and notes as a JSON archive.
          </div>
        </div>
        <button
          onClick={onExport}
          className="px-4 py-2 border border-border/10 dark:border-border rounded-full text-[13px] font-medium text-text-primary hover:border-border-hover/18 dark:hover:border-border-hover transition-colors whitespace-nowrap"
        >
          Export
        </button>
      </div>

      {/* Delete account */}
      <div className="flex items-center justify-between py-4 gap-6">
        <div>
          <div className="text-sm font-medium text-text-primary">Delete account</div>
          <div className="text-[13px] text-text-secondary mt-1 max-w-md">
            This cannot be undone. You will be asked to confirm.
          </div>
        </div>
        <button
          onClick={onDelete}
          className="px-4 py-2.5 border border-rust rounded-full text-[13px] font-semibold tracking-[0.12em] uppercase text-rust hover:bg-rust hover:text-background transition-colors whitespace-nowrap"
        >
          Delete account
        </button>
      </div>
    </div>
  );
}
