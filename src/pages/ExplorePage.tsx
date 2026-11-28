import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Search } from 'lucide-react';
import { TopBar } from '../components/shell/TopBar';
import { DesignCard } from '../components/community/DesignCard';
import { ButtonLink } from '../components/ui/Button';
import { InlineInput } from '../components/ui/Field';
import { FoldInText } from '../components/ui/Motion';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { useDb, type DesignKind } from '../store';
import { ROUTE_HASH, usePageTitle } from '../router';

type Feed = 'everyone' | 'following';
type Kind = 'all' | DesignKind;
type Sort = 'new' | 'popular';

/** Every published design, newest or most liked first, filtered by kind and words. */
export const ExplorePage: React.FC = () => {
  usePageTitle('Explore');
  const [feed, setFeed] = useState<Feed>('everyone');
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<Sort>('new');
  const [query, setQuery] = useState('');
  const me = useDb((d) => d.me);
  const designs = useDb((d) =>
    d.designs({
      kind: kind === 'all' ? undefined : kind,
      sort,
      query,
      followedBy: feed === 'following' && me ? me.id : undefined,
    }),
  );

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar route="explore" className="sticky top-0 z-40" />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-ink lg:text-5xl">
              <FoldInText text="Explore designs" />
            </h1>
            <p className="mt-3 max-w-lg text-ink-muted">Step-by-step models and crease patterns people have shared. Open one to fold it, like it, or remix it.</p>
          </div>
          <ButtonLink href={ROUTE_HASH.create} variant="primary" icon={Plus}>
            Share a design
          </ButtonLink>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:items-center">
          {me && (
            <SegmentedControl<Feed>
              label="Whose designs"
              value={feed}
              onChange={setFeed}
              segments={[
                { value: 'everyone', label: 'Everyone' },
                { value: 'following', label: 'Following' },
              ]}
            />
          )}
          <SegmentedControl<Kind>
            label="Kind of design"
            value={kind}
            onChange={setKind}
            segments={[
              { value: 'all', label: 'All' },
              { value: 'steps', label: 'Step by step' },
              { value: 'pattern', label: 'Crease patterns' },
            ]}
          />
          <SegmentedControl<Sort>
            label="Order"
            value={sort}
            onChange={setSort}
            segments={[
              { value: 'new', label: 'Newest' },
              { value: 'popular', label: 'Most liked' },
            ]}
          />
          <div className="relative lg:ml-auto lg:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" strokeWidth={1.75} />
            <InlineInput
              type="search"
              aria-label="Search designs"
              placeholder="Search titles, tags, people…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {designs.length === 0 ? (
          <div className="mt-16 flex flex-col items-center rounded-lg border-2 border-dashed border-line-strong px-6 py-16 text-center">
            <p className="font-display text-xl font-semibold text-ink">
              {feed === 'following' ? 'Nothing from people you follow yet.' : 'No designs match.'}
            </p>
            <p className="mt-2 max-w-sm text-sm text-ink-muted">
              {feed === 'following'
                ? 'Follow people from their profiles, and what they share shows up here.'
                : 'Try other words, or show every kind of design.'}
            </p>
          </div>
        ) : (
          <motion.ul layout className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence mode="popLayout" initial={false}>
              {designs.map((d, i) => (
                <motion.li
                  key={d.id}
                  layout
                  initial={{ opacity: 0, y: 16, rotateX: -12 }}
                  animate={{ opacity: 1, y: 0, rotateX: 0, transition: { duration: 0.4, delay: Math.min(i, 12) * 0.03, ease: [0.2, 0.8, 0.2, 1] } }}
                  exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
                  style={{ transformOrigin: 'top center', transformPerspective: 1000 }}
                >
                  <DesignCard design={d} />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </main>
    </div>
  );
};
