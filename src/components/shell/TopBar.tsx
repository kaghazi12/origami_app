import React from 'react';
import { ROUTE_HASH, type Route } from '../../router';
import { cn } from '../ui/cn';
import { Wordmark } from './Wordmark';

const NAV: { route: Route; label: string; hint: string }[] = [
  { route: 'learn', label: 'Learn', hint: 'Follow a design one fold at a time' },
  { route: 'creasePattern', label: 'Crease pattern', hint: 'Open and fold any .fold file' },
];

interface TopBarProps {
  route: Route;
  /** Page-specific content on the right: the design picker, file actions. */
  children?: React.ReactNode;
  className?: string;
}

/** The one top bar used on every page: wordmark, the two modes, then page actions. */
export const TopBar: React.FC<TopBarProps> = ({ route, children, className }) => (
  <header className={cn('flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3 sm:gap-6 sm:px-4', className)}>
    <a
      href={ROUTE_HASH.home}
      className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2"
      aria-label="Origami home"
    >
      <Wordmark compact />
    </a>
    <nav aria-label="Modes" className="flex h-full items-stretch gap-1">
      {NAV.map((n) => {
        const current = n.route === route;
        return (
          <a
            key={n.route}
            href={ROUTE_HASH[n.route]}
            title={n.hint}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'relative flex items-center whitespace-nowrap px-2 text-sm font-medium transition-colors duration-150 ease-out sm:px-2.5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
              current ? 'text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {n.label}
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-colors duration-150 sm:inset-x-2.5',
                current ? 'bg-ink' : 'bg-transparent',
              )}
            />
          </a>
        );
      })}
    </nav>
    <div className="ml-auto flex min-w-0 items-center gap-2">{children}</div>
  </header>
);
