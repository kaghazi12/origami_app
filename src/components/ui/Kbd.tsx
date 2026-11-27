import React from 'react';
import { cn } from './cn';

/** A keyboard key, for shortcut hints. */
export const Kbd: React.FC<{ children: React.ReactNode; tone?: 'default' | 'inverse' }> = ({ children, tone = 'default' }) => (
  <kbd
    className={cn(
      'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-sm px-1 font-mono text-xs leading-none',
      tone === 'inverse' ? 'bg-ink-muted/60 text-canvas' : 'border border-line-strong bg-surface-raised text-ink-muted',
    )}
  >
    {children}
  </kbd>
);
