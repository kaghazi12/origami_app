import React from 'react';
import { theme } from '../../theme';
import { cn } from '../ui/cn';

/** The mark: a square sheet with one valley fold, corner to corner. */
export const Mark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
    <rect x="3" y="3" width="26" height="26" rx="3" fill={theme.surface} stroke={theme.ink} strokeWidth="2" />
    <path d="M3 3 29 29" stroke={theme.ink} strokeWidth="1.5" opacity="0.3" />
    <path d="M3 29 29 3" stroke={theme.accent} strokeWidth="2.5" strokeDasharray="4 3" />
  </svg>
);

/** `compact` drops the name on small screens, leaving the mark. */
export const Wordmark: React.FC<{ className?: string; compact?: boolean }> = ({ className, compact }) => (
  <span className={cn('inline-flex items-center gap-2', className)}>
    <Mark className="size-5" />
    <span className={cn('font-display text-xl leading-none tracking-tight text-ink', compact && 'hidden sm:inline')}>Origami</span>
  </span>
);
