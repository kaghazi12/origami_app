import React from 'react';
import { cn } from './cn';
import { Kbd } from './Kbd';

interface TooltipProps {
  content: string;
  shortcut?: string;
  side?: 'top' | 'bottom';
  children: React.ReactElement;
}

/**
 * A small label shown on hover or keyboard focus. Purely visual: the wrapped control must carry
 * its own accessible name (IconButton passes `aria-label`).
 */
export const Tooltip: React.FC<TooltipProps> = ({ content, shortcut, side = 'bottom', children }) => (
  <span className="group/tip relative inline-flex">
    {children}
    <span
      role="presentation"
      className={cn(
        'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap',
        'inline-flex items-center gap-1.5 rounded-md bg-ink px-2 py-1 text-xs font-medium text-canvas',
        'opacity-0 transition-opacity duration-150 ease-out',
        'group-hover/tip:opacity-100 group-hover/tip:delay-300 group-focus-within/tip:opacity-100',
        side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
      )}
    >
      {content}
      {shortcut && <Kbd tone="inverse">{shortcut}</Kbd>}
    </span>
  </span>
);
