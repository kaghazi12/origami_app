import React from 'react';
import { theme } from '../../theme';
import { href } from '../../router';
import type { User } from '../../store';
import { cn } from '../ui/cn';

const SIZES = { xs: 'size-5 text-xs', sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-16 text-2xl', xl: 'size-24 text-4xl' } as const;

/**
 * A person: a sheet of paper in their colour with one corner folded down, and their initial.
 * The same folded corner as the logo, so people read as paper too.
 */
export const Avatar: React.FC<{ user: Pick<User, 'name' | 'color'> | null; size?: keyof typeof SIZES; className?: string }> = ({
  user,
  size = 'sm',
  className,
}) => {
  const color = user?.color ?? theme.inkFaint;
  const initial = (user?.name.trim()[0] ?? '?').toUpperCase();
  return (
    <span aria-hidden="true" className={cn('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-sm font-display font-bold text-paper', SIZES[size], className)} style={{ backgroundColor: color }}>
      <span className="relative" style={{ textShadow: '0 1px 0 rgb(0 0 0 / 0.15)' }}>
        {initial}
      </span>
      {/* the folded corner, showing the paper's light back */}
      <span className="absolute right-0 top-0 size-[32%]" style={{ background: theme.canvas, clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />
      <span className="absolute right-0 top-0 size-[32%] bg-paper/85" style={{ clipPath: 'polygon(0 0, 100% 100%, 0 100%)' }} />
    </span>
  );
};

/** Avatar and name, linking to the profile. */
export const PersonLink: React.FC<{ user: User | null; size?: 'xs' | 'sm'; className?: string; muted?: boolean }> = ({ user, size = 'xs', className, muted }) => {
  if (!user) return <span className={cn('text-sm text-ink-faint', className)}>Someone</span>;
  return (
    <a
      href={href.profile(user.handle)}
      className={cn(
        'group/person relative z-10 inline-flex min-w-0 items-center gap-2 rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
        muted ? 'text-ink-muted hover:text-ink' : 'text-ink',
        className,
      )}
    >
      <Avatar user={user} size={size} />
      <span className="truncate font-medium group-hover/person:underline">{user.name}</span>
    </a>
  );
};

/** "3 days ago", "just now", or a date. */
export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)} h ago`;
  const d = h / 24;
  if (d < 2) return 'yesterday';
  if (d < 30) return `${Math.floor(d)} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
