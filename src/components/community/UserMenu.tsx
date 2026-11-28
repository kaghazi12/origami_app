import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LogOut, Plus, UserRound } from 'lucide-react';
import { db, useDb } from '../../store';
import { ROUTE_HASH, href, navigate } from '../../router';
import { buttonClasses } from '../ui/Button';
import { cn } from '../ui/cn';
import { Avatar } from './People';

/** Top-bar account control: "Sign in", or your avatar with a small menu. */
export const UserMenu: React.FC = () => {
  const me = useDb((d) => d.me);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!me) {
    return (
      <a href={href.signin(window.location.hash)} className={buttonClasses('ghost', 'md', 'px-2 text-ink sm:px-3')}>
        Sign in
      </a>
    );
  }

  const item = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-ink hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none';
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${me.name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
      >
        <Avatar user={me} size="sm" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ transformOrigin: 'top right' }}
            className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-line bg-surface-raised p-1 shadow-dialog"
          >
            <div className="flex items-center gap-3 px-2.5 pb-2 pt-1.5">
              <Avatar user={me} size="md" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{me.name}</div>
                <div className="truncate text-xs text-ink-muted">@{me.handle}</div>
              </div>
            </div>
            <div className="my-1 h-px bg-line" />
            <a role="menuitem" href={href.profile(me.handle)} className={item} onClick={() => setOpen(false)}>
              <UserRound className="size-4 text-ink-muted" strokeWidth={1.75} /> Your designs and profile
            </a>
            <a role="menuitem" href={ROUTE_HASH.create} className={item} onClick={() => setOpen(false)}>
              <Plus className="size-4 text-ink-muted" strokeWidth={1.75} /> New design
            </a>
            <div className="my-1 h-px bg-line" />
            <button
              role="menuitem"
              type="button"
              className={cn(item)}
              onClick={() => {
                setOpen(false);
                db.signOut();
                navigate(ROUTE_HASH.explore);
              }}
            >
              <LogOut className="size-4 text-ink-muted" strokeWidth={1.75} /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
