import React from 'react';
import { motion } from 'motion/react';
import { Heart, MessageCircle, Shuffle } from 'lucide-react';
import { db, useDb, type DesignRecord } from '../../store';
import { href, navigate } from '../../router';
import { difficultyLabel } from '../../designs';
import { useToast } from '../ui/Toast';
import { cn } from '../ui/cn';
import { DesignThumb } from './DesignThumb';
import { PersonLink } from './People';

/** What a design is, in one line: "Step by step · Beginner · 6 steps" or "Crease pattern · 175 creases". */
export function designMeta(d: DesignRecord): string {
  if (d.kind === 'steps') {
    return ['Step by step', d.difficulty ? difficultyLabel(d.difficulty) : null, d.size ? `${d.size} steps` : null].filter(Boolean).join(' · ');
  }
  return ['Crease pattern', d.size ? `${d.size.toLocaleString()} creases` : null].filter(Boolean).join(' · ');
}

/** Heart toggle with the count. Signed out, it takes you to sign in and back. */
export const LikeButton: React.FC<{ designId: string; size?: 'sm' | 'md'; className?: string }> = ({ designId, size = 'md', className }) => {
  const toast = useToast();
  const { liked, count, signedIn } = useDb((d) => ({ liked: d.likedByMe(designId), count: d.likeCount(designId), signedIn: !!d.me }));
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={liked ? `Unlike (${count} likes)` : `Like (${count} likes)`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!signedIn) {
          navigate(href.signin(window.location.hash));
          return;
        }
        try {
          db.toggleLike(designId);
        } catch (err) {
          toast.show({ tone: 'error', title: (err as Error).message });
        }
      }}
      className={cn(
        'relative z-10 inline-flex items-center gap-1.5 rounded-md font-medium tabular-nums transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
        size === 'sm' ? 'h-7 px-1.5 text-xs' : 'h-8 border border-line-strong bg-surface-raised px-3 text-sm shadow-edge hover:bg-surface',
        liked ? 'text-ink' : 'text-ink-muted hover:text-ink',
        className,
      )}
    >
      <motion.span key={String(liked)} initial={liked ? { scale: 0.5 } : false} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 15 }} className="inline-flex">
        <Heart className={size === 'sm' ? 'size-3.5' : 'size-4'} strokeWidth={liked ? 2 : 1.75} fill={liked ? 'var(--color-accent)' : 'none'} />
      </motion.span>
      {count}
    </button>
  );
};

/** A design in a grid: picture, title, who shared it, likes and comments. The whole card opens it. */
export const DesignCard: React.FC<{ design: DesignRecord; showAuthor?: boolean }> = ({ design, showAuthor = true }) => {
  const { author, comments, remixOf } = useDb((d) => ({
    author: d.user(design.authorId),
    comments: d.commentCount(design.id),
    remixOf: design.remixOf ? d.design(design.remixOf) : null,
  }));
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface-raised transition-[border-color,box-shadow,translate] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float">
      <div className="relative aspect-[4/3] bg-viewer">
        <DesignThumb design={design} className="absolute inset-0 size-full p-4 transition-transform duration-300 ease-out group-hover:scale-[1.03]" />
        {design.status === 'draft' && (
          <span className="absolute left-3 top-3 rounded-sm bg-ink px-1.5 py-0.5 text-xs font-medium text-paper">Draft</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-ink">
          <a
            href={design.status === 'draft' ? href.edit(design.id) : href.design(design.id)}
            className="after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-lg after:focus-visible:ring-2 after:focus-visible:ring-focus/60"
          >
            {design.title}
          </a>
        </h3>
        <p className="text-xs text-ink-muted">{designMeta(design)}</p>
        {remixOf && (
          <p className="inline-flex items-center gap-1 text-xs text-ink-muted">
            <Shuffle className="size-3" strokeWidth={2} /> Remix of {remixOf.title}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {showAuthor ? <PersonLink user={author} muted /> : <span />}
          <div className="flex items-center gap-1 text-ink-muted">
            {design.status === 'published' && <LikeButton designId={design.id} size="sm" />}
            {comments > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 text-xs tabular-nums" aria-label={`${comments} comments`}>
                <MessageCircle className="size-3.5" strokeWidth={1.75} />
                {comments}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};
