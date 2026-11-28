import React from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { ROUTE_HASH, type Route } from '../../router';
import { UserMenu } from '../community/UserMenu';
import { buttonClasses } from '../ui/Button';
import { cn } from '../ui/cn';
import { Wordmark } from './Wordmark';

const NAV: { route: Route; href: string; label: string; short?: string; hint: string }[] = [
  { route: 'learn', href: ROUTE_HASH.learn, label: 'Learn', hint: 'Follow a design one fold at a time' },
  { route: 'creasePattern', href: ROUTE_HASH.creasePattern, label: 'Crease pattern', short: 'Patterns', hint: 'Open and fold any .fold file' },
  { route: 'explore', href: ROUTE_HASH.explore, label: 'Explore', hint: 'Designs people have shared' },
];

interface TopBarProps {
  route: Route;
  /** Page-specific content on the right: the design picker, file actions. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The one top bar used on every page: wordmark, the modes and Explore, page actions, then
 * Create and your account. The marigold tab under the current page slides between pages (shared
 * layoutId), so the change of page reads as one movement.
 */
export const TopBar: React.FC<TopBarProps> = ({ route, children, className }) => (
  <header className={cn('flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:gap-6 sm:px-4', className)}>
    <a
      href={ROUTE_HASH.home}
      className="flex h-full items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 focus-visible:ring-offset-2"
      aria-label="Origami home"
    >
      <Wordmark compact />
    </a>
    <nav aria-label="Pages" className="flex h-full min-w-0 items-stretch gap-0 sm:gap-1">
      {NAV.map((n) => {
        const current = n.route === route || (n.route === 'explore' && (route === 'design' || route === 'profile'));
        return (
          <a
            key={n.route}
            href={n.href}
            title={n.hint}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'relative flex items-center whitespace-nowrap px-1.5 text-sm font-medium transition-colors duration-150 ease-out sm:px-2.5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus/60',
              current ? 'text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {n.short ? (
              <>
                <span className="sm:hidden">{n.short}</span>
                <span className="hidden sm:inline">{n.label}</span>
              </>
            ) : (
              n.label
            )}
            {current && (
              <motion.span
                layoutId="topbar-current"
                aria-hidden="true"
                className="absolute inset-x-1.5 -bottom-px h-[3px] rounded-t-sm bg-accent sm:inset-x-2.5"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
          </a>
        );
      })}
    </nav>
    <div className="ml-auto flex min-w-0 items-center gap-2">
      {children}
      {route !== 'create' && (
        <a href={ROUTE_HASH.create} className={buttonClasses('ghost', 'md', 'hidden text-ink md:inline-flex')} title="Make a step-by-step design">
          <Plus className="size-4" strokeWidth={1.75} />
          Create
        </a>
      )}
      <UserMenu />
    </div>
  </header>
);
