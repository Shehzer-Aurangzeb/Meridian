'use client';

import { cn } from '@/lib/utils';

export interface PaginationState {
  page: number;
  pageSize: number;
  totalCount: number;
}

interface PageButtonProps {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

function PageButton({ children, active, disabled, onClick }: PageButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-8 h-8 rounded-md text-xs font-mono',
        'border transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-transparent text-text-primary border-border/10 dark:border-border hover:bg-surface hover:border-primary/30',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent hover:border-border/10 dark:hover:border-border'
      )}
    >
      {children}
    </button>
  );
}

interface PaginationProps {
  pagination: PaginationState;
  onPageChange?: (page: number) => void;
  maxVisiblePages?: number;
}

export function Pagination({
  pagination,
  onPageChange,
  maxVisiblePages = 5,
}: PaginationProps) {
  const { page, pageSize, totalCount } = pagination;
  const totalPages = Math.ceil(totalCount / pageSize);
  
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalCount);

  // Calculate visible page numbers
  const getVisiblePages = (): (number | 'ellipsis')[] => {
    if (totalPages <= maxVisiblePages) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | 'ellipsis')[] = [];
    
    if (page <= 3) {
      // Near start
      pages.push(1, 2, 3, 'ellipsis', totalPages);
    } else if (page >= totalPages - 2) {
      // Near end
      pages.push(1, 'ellipsis', totalPages - 2, totalPages - 1, totalPages);
    } else {
      // Middle
      pages.push(1, 'ellipsis', page, 'ellipsis', totalPages);
    }

    return pages;
  };

  const visiblePages = getVisiblePages();

  return (
    <div className="flex items-center justify-between mt-5 px-1 font-mono text-xs tracking-[0.04em] text-text-tertiary">
      <div>
        Showing {startItem} – {endItem} of {totalCount}
      </div>
      
      <div className="flex gap-1.5">
        {/* Previous button */}
        <PageButton
          disabled={page === 1}
          onClick={() => onPageChange?.(page - 1)}
        >
          ‹
        </PageButton>

        {/* Page numbers */}
        {visiblePages.map((p, idx) =>
          p === 'ellipsis' ? (
            <PageButton key={`ellipsis-${idx}`} disabled>
              …
            </PageButton>
          ) : (
            <PageButton
              key={p}
              active={p === page}
              onClick={() => onPageChange?.(p)}
            >
              {p}
            </PageButton>
          )
        )}

        {/* Next button */}
        <PageButton
          disabled={page === totalPages}
          onClick={() => onPageChange?.(page + 1)}
        >
          ›
        </PageButton>
      </div>
    </div>
  );
}
