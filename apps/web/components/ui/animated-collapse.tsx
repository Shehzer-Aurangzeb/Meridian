'use client';

import { ReactNode, useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedCollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

export function AnimatedCollapse({ open, children, className }: AnimatedCollapseProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(open ? undefined : 0);

  useEffect(() => {
    if (!contentRef.current) return;

    if (open) {
      const contentHeight = contentRef.current.scrollHeight;
      setHeight(contentHeight);
      // After animation completes, set to auto for dynamic content
      const timeout = setTimeout(() => setHeight(undefined), 300);
      return () => clearTimeout(timeout);
    } else {
      // First set explicit height, then animate to 0
      const contentHeight = contentRef.current.scrollHeight;
      setHeight(contentHeight);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setHeight(0);
        });
      });
    }
  }, [open]);

  return (
    <div
      className={cn(
        'overflow-hidden transition-all duration-300 ease-out',
        className
      )}
      style={{ height: height !== undefined ? `${height}px` : 'auto' }}
    >
      <div ref={contentRef}>
        {children}
      </div>
    </div>
  );
}
