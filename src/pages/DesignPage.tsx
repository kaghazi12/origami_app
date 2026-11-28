import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, EyeOff, FolderOpen, Link2, Pencil, Send, Shuffle, Trash2, Upload } from 'lucide-react';
import { TopBar } from '../components/shell/TopBar';
import { StepPlayer } from '../components/community/StepPlayer';
import { DesignCard, LikeButton, designMeta } from '../components/community/DesignCard';
import { Avatar, PersonLink, timeAgo } from '../components/community/People';
import { loadDesign } from '../components/community/designFiles';
import { Button, ButtonLink } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { ConfirmDialog } from '../components/ui/Dialog';
import { TextArea } from '../components/ui/Field';
import { CreaseThumbnail } from '../components/ui/Thumbnails';
import { useToast } from '../components/ui/Toast';
import { db, useDb, LIMITS, type DesignRecord } from '../store';
import { ROUTE_HASH, absoluteLink, href, navigate, usePageTitle } from '../router';

/** Save a design's file to disk (.json for step designs, .fold for crease patterns). */
export function downloadDesign(d: DesignRecord) {
  const data = db.fileOf(d);
  const name = `${d.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'design'}.${d.kind === 'steps' ? 'json' : 'fold'}`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const Comments: React.FC<{ design: DesignRecord }> = ({ design }) => {
  const toast = useToast();
  const { comments, me } = useDb((d) => ({ comments: d.comments(design.id), me: d.me }));
  const users = useDb((d) => d);
  const [text, setText] = useState('');
  const post = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      db.addComment(design.id, text);
      setText('');
    } catch (err) {
      toast.show({ tone: 'error', title: (err as Error).message });
    }
  };
  return (
    <section aria-labelledby="comments" className="mt-12">
      <h2 id="comments" className="font-display text-2xl font-semibold tracking-tight text-ink">
        Comments <span className="text-ink-faint">{comments.length || ''}</span>
      </h2>
      <ul className="mt-6 space-y-5">
        <AnimatePresence initial={false}>
          {comments.map((c) => {
            const author = users.user(c.authorId);
            const canDelete = !!me && (c.authorId === me.id || design.authorId === me.id);
            return (
              <motion.li
                key={c.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.25 }}
                className="group flex gap-3"
              >
                <Avatar user={author} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-sm">
                    {author ? (
                      <a href={href.profile(author.handle)} className="font-semibold text-ink hover:underline">
                        {author.name}
                      </a>
                    ) : (
                      <span className="font-semibold text-ink-muted">Someone</span>
                    )}
                    {author?.id === design.authorId && <span className="text-xs font-medium text-accent-ink">Designer</span>}
                    <span className="text-xs text-ink-faint">{timeAgo(c.createdAt)}</span>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => db.deleteComment(c.id)}
                        className="ml-auto rounded-sm text-xs text-ink-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 group-hover:opacity-100"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{c.text}</p>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      {design.status !== 'published' ? (
        <p className="mt-6 text-sm text-ink-muted">Comments open once the design is published.</p>
      ) : me ? (
        <form onSubmit={post} className="mt-6 flex gap-3">
          <Avatar user={me} size="sm" />
          <div className="flex-1 space-y-2">
            <TextArea label="Add a comment" value={text} onChange={(e) => setText(e.target.value)} maxCount={LIMITS.commentLength} rows={2} placeholder="Tips, questions, or what you made with it" />
            <div className="flex justify-end">
              <Button type="submit" variant="primary" size="sm" icon={Send} disabled={!text.trim()}>
                Post
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <p className="mt-6 text-sm text-ink-muted">
          <a href={href.signin(window.location.hash)} className="font-semibold text-ink underline underline-offset-2">
            Sign in
          </a>{' '}
          to comment.
        </p>
      )}
    </section>
  );
};

export const DesignPage: React.FC<{ id: string }> = ({ id }) => {
  const toast = useToast();
  const design = useDb((d) => d.design(id));
  const { author, me, remixOf, remixes } = useDb((d) => ({
    author: design ? d.user(design.authorId) : null,
    me: d.me,
    remixOf: design?.remixOf ? d.design(design.remixOf) : null,
    remixes: design ? d.remixesOf(design.id) : [],
  }));
  const remixOfAuthor = useDb((d) => (remixOf ? d.user(remixOf.authorId) : null));
  const loaded = useMemo(() => (design ? loadDesign(design) : null), [design]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  usePageTitle(design?.title ?? 'Design');
  const own = !!me && !!design && me.id === design.authorId;

  if (!design || !loaded) {
    return (
      <div className="min-h-dvh bg-canvas">
        <TopBar route="design" className="sticky top-0 z-40" />
        <main className="mx-auto max-w-xl px-6 py-24 text-center">
          <h1 className="font-display text-3xl font-semibold text-ink">This design isn’t here</h1>
          <p className="mt-3 text-ink-muted">
            It may have been deleted or unpublished. Designs are stored in the browser they were made in, so a link from someone else’s browser won’t open here yet.
          </p>
          <ButtonLink href={ROUTE_HASH.explore} className="mt-6">
            Explore designs
          </ButtonLink>
        </main>
      </div>
    );
  }

  const act = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      toast.show({ tone: 'error', title: (e as Error).message });
    }
  };
  const openHref = design.kind === 'steps' ? href.learn(design.id) : href.creasePattern(design.id);

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar route="design" className="sticky top-0 z-40" />
      <main className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-6 pb-24 pt-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* the model */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          {loaded.kind === 'steps' && loaded.compiled ? (
            <StepPlayer compiled={loaded.compiled} autoPlay className="flex h-[30rem] flex-col lg:h-[36rem]" />
          ) : loaded.kind === 'pattern' && loaded.fold ? (
            <div className="flex h-[30rem] items-center justify-center rounded-lg bg-viewer p-8 lg:h-[36rem]">
              <CreaseThumbnail fold={loaded.fold} className="max-h-full w-full max-w-lg" weight={1} title={`${design.title}, crease pattern`} />
            </div>
          ) : (
            <Callout tone="danger" title="This design’s file can’t be opened">
              {loaded.error}
            </Callout>
          )}
          {loaded.kind === 'steps' && loaded.error && (
            <Callout className="mt-3" title="Part of this design can’t be folded">
              {loaded.error} The steps before it still play.
            </Callout>
          )}
        </motion.div>

        {/* about it */}
        <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.08 }}>
          {design.status === 'draft' && (
            <Callout tone="info" title="Draft: only you can see this" className="mb-5">
              Publish it to show it in Explore and on your profile.
            </Callout>
          )}
          <p className="text-sm text-ink-muted">{designMeta(design)}</p>
          <h1 className="mt-1 font-display text-4xl font-semibold leading-tight tracking-tight text-ink">{design.title}</h1>
          {design.credit && <p className="mt-1 text-sm text-ink-muted">Design: {design.credit}</p>}
          {remixOf && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-ink-muted">
              <Shuffle className="size-3.5" strokeWidth={2} />
              Remix of{' '}
              <a href={href.design(remixOf.id)} className="font-medium text-ink underline underline-offset-2">
                {remixOf.title}
              </a>
              {remixOfAuthor && <> by {remixOfAuthor.name}</>}
            </p>
          )}

          <div className="mt-5 flex items-center justify-between gap-3 border-y border-line py-3">
            <PersonLink user={author} size="sm" />
            <span className="text-xs text-ink-faint">{timeAgo(design.publishedAt ?? design.updatedAt)}</span>
          </div>

          {design.description && <p className="mt-5 whitespace-pre-wrap leading-relaxed text-ink">{design.description}</p>}
          {design.tags.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Tags">
              {design.tags.map((t) => (
                <li key={t} className="rounded-sm bg-sunken px-2 py-0.5 text-xs font-medium text-ink-muted">
                  {t}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink href={openHref} variant="primary" icon={FolderOpen}>
              {design.kind === 'steps' ? 'Fold it step by step' : 'Fold it'}
            </ButtonLink>
            {design.status === 'published' && <LikeButton designId={design.id} />}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              icon={Shuffle}
              onClick={() => {
                if (!me) return navigate(href.signin(window.location.hash));
                act(() => {
                  const r = db.remix(design.id);
                  toast.show({ title: 'Copied to your drafts', detail: 'Change anything; publish it when you’re ready.' });
                  navigate(href.edit(r.id));
                });
              }}
            >
              Remix
            </Button>
            {design.status === 'published' && (
              <Button
                icon={Link2}
                onClick={() => {
                  const link = absoluteLink(href.design(design.id));
                  navigator.clipboard?.writeText(link).then(
                    () => toast.show({ title: 'Link copied' }),
                    () => toast.show({ title: 'Copy this link', detail: link }),
                  );
                }}
              >
                Copy link
              </Button>
            )}
            <Button icon={Download} onClick={() => downloadDesign(design)}>
              Download
            </Button>
          </div>

          {own && (
            <div className="mt-6 rounded-lg border border-line bg-surface p-4">
              <p className="text-sm font-semibold text-ink">Your design</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ButtonLink href={href.edit(design.id)} size="sm" icon={Pencil}>
                  Edit
                </ButtonLink>
                {design.status === 'published' ? (
                  <Button
                    size="sm"
                    icon={EyeOff}
                    onClick={() => {
                      act(() => db.unpublish(design.id));
                      toast.show({ title: 'Unpublished', detail: 'It’s a draft again, visible only to you.' });
                    }}
                  >
                    Unpublish
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={Upload}
                    onClick={() => {
                      act(() => db.publish(design.id));
                      toast.show({ title: 'Published', detail: 'It’s in Explore now.' });
                    }}
                  >
                    Publish
                  </Button>
                )}
                <Button size="sm" icon={Trash2} className="text-danger" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </div>
            </div>
          )}

          <Comments design={design} />
        </motion.div>

        {remixes.length > 0 && (
          <section aria-labelledby="remixes" className="lg:col-span-2">
            <h2 id="remixes" className="font-display text-2xl font-semibold tracking-tight text-ink">
              Remixes
            </h2>
            <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {remixes.map((r) => (
                <li key={r.id}>
                  <DesignCard design={r} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${design.title}”?`}
        description="Its likes and comments go with it. This can’t be undone."
        confirmLabel="Delete design"
        danger
        onConfirm={() =>
          act(() => {
            db.deleteDesign(design.id);
            toast.show({ title: 'Design deleted' });
            navigate(me ? href.profile(me.handle) : ROUTE_HASH.explore);
          })
        }
      />
    </div>
  );
};
