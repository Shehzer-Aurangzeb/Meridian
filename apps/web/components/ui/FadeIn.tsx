'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FadeInProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  threshold?: number;
  once?: boolean;
}

export function FadeIn({ 
  children, 
  className, 
  delay = 0, 
  threshold = 0.1,
  once = true 
}: FadeInProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) {
            observer.unobserve(element);
          }
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin: '0px 0px -50px 0px' }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, once]);

  return (
    <div
      ref={ref}
      className={cn(
        'transition-opacity duration-500 ease-out',
        isVisible ? 'opacity-100' : 'opacity-0',
        className
      )}
      style={{ transitionDelay: isVisible ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  );
}

interface FadeInGroupProps {
  children: ReactNode[];
  className?: string;
  staggerDelay?: number;
  threshold?: number;
}

export function FadeInGroup({ 
  children, 
  className,
  staggerDelay = 75,
  threshold = 0.1 
}: FadeInGroupProps) {
  return (
    <div className={className}>
      {children.map((child, index) => (
        <FadeIn key={index} delay={index * staggerDelay} threshold={threshold}>
          {child}
        </FadeIn>
      ))}
    </div>
  );
}
