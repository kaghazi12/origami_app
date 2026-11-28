import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, Pencil, Plus, UserPlus } from 'lucide-react';
import { TopBar } from '../components/shell/TopBar';
import { DesignCard } from '../components/community/DesignCard';
import { Avatar } from '../components/community/People';
import { Button, ButtonLink } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { TextArea, TextField } from '../components/ui/Field';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { useToast } from '../components/ui/Toast';
import { cn } from '../components/ui/cn';
import { db, useDb, LIMITS, PAPER_COLORS, StoreError, type User } from '../store';
import { ROUTE_HASH, href, navigate, usePageTitle } from '../router';

type Tab = 'designs' | 'drafts' | 'liked';

const EditProfile: React.FC<{ user: User; open: boolean; onClose: () => void }> = ({ user, open, onClose }) => {
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [handle, setHandle] = useState(user.handle);
  const [bio, setBio] = useState(user.bio);
  const [color, setColor] = useState(user.color);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    try {
      const u = db.updateProfile({ name, handle, bio, color });
      toast.show({ title: 'Profile saved' });
      onClose();
      if (u.handle !== user.handle) navigate(href.profile(u.handle));
    } catch (e) {
      if (e instanceof StoreError) setError(e.message);
      else throw e;
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit profile"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Name" value={name} maxCount={LIMITS.nameLength} onChange={(e) => { setName(e.target.value); setError(null); }} />
        <TextField label="Username" prefix="@" value={handle} maxCount={LIMITS.handleLength} onChange={(e) => { setHandle(e.target.value.toLowerCase()); setError(null); }} />
        <TextArea label="Bio" value={bio} maxCount={LIMITS.bioLength} onChange={(e) => setBio(e.target.value)} placeholder="What do you like to fold?" />
        <fieldset>
          <legend className="text-sm font-medium text-ink">Paper colour</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PAPER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={c === color}
                onClick={() => setColor(c)}
                className={cn('grid size-7 place-items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60', c === color && 'ring-2 ring-ink ring-offset-2 ring-offset-surface-raised')}
                style={{ backgroundColor: c }}
              >
                {c === color && <Check className="size-3.5 text-paper" strokeWidth={2.5} />}
              </button>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      </div>
    </Dialog>
  );
};

const Stat: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div>
    <div className="font-display text-2xl font-semibold tabular-nums text-ink">{value.toLocaleString()}</div>
    <div className="text-xs text-ink-muted">{label}</div>
  </div>
);

export const ProfilePage: React.FC<{ handle: string }> = ({ handle }) => {
  const toast = useToast();
  const user = useDb((d) => d.userByHandle(handle));
  const me = useDb((d) => d.me);
  const own = !!me && !!user && me.id === user.id;
  const [tab, setTab] = useState<Tab>('designs');
  const [editing, setEditing] = useState(false);
  usePageTitle(user ? `${user.name} (@${user.handle})` : 'Profile');

  const stats = useDb((d) =>
    user
      ? {
          designs: d.designs({ authorId: user.id }).length,
          likes: d.likesReceived(user.id),
          followers: d.followerCount(user.id),
          following: d.followingCount(user.id),
          isFollowing: d.isFollowing(user.id),
        }
      : null,
  );
  const list = useDb((d) => {
    if (!user) return [];
    if (tab === 'liked') return d.designs({ likedBy: user.id });
    if (tab === 'drafts') return own ? d.designs({ authorId: user.id, includeDrafts: true }).filter((x) => x.status === 'draft') : [];
    return d.designs({ authorId: user.id });
  });

  if (!user || !stats) {
    return (
      <div className="min-h-dvh bg-canvas">
        <TopBar route="profile" className="sticky top-0 z-40" />
        <main className="mx-auto max-w-xl px-6 py-24 text-center">
          <h1 className="font-display text-3xl font-semibold text-ink">No one is called @{handle}</h1>
          <p className="mt-3 text-ink-muted">The profile may have changed its username.</p>
          <ButtonLink href={ROUTE_HASH.explore} className="mt-6">
            Explore designs
          </ButtonLink>
        </main>
      </div>
    );
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: 'designs', label: 'Designs' },
    ...(own ? [{ value: 'drafts' as Tab, label: 'Drafts' }] : []),
    { value: 'liked', label: 'Liked' },
  ];

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar route="profile" className="sticky top-0 z-40" />
      {/* a band in their paper colour */}
      <motion.div
        aria-hidden="true"
        className="h-28 origin-left"
        style={{ backgroundColor: user.color }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, ease: [0.65, 0, 0.35, 1] }}
      />
      <main className="mx-auto max-w-6xl px-6 pb-24">
        <div className="-mt-12 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="flex items-start gap-5">
            <motion.div initial={{ rotate: -8, y: 12, opacity: 0 }} animate={{ rotate: 0, y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.2 }}>
              <Avatar user={user} size="xl" className="ring-4 ring-canvas" />
            </motion.div>
            <div className="pt-14">
              <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{user.name}</h1>
              <p className="text-sm text-ink-muted">
                @{user.handle} · joined {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {own ? (
              <>
                <Button icon={Pencil} onClick={() => setEditing(true)}>
                  Edit profile
                </Button>
                <ButtonLink href={ROUTE_HASH.create} variant="primary" icon={Plus}>
                  New design
                </ButtonLink>
              </>
            ) : (
              <Button
                variant={stats.isFollowing ? 'secondary' : 'primary'}
                icon={stats.isFollowing ? Check : UserPlus}
                onClick={() => {
                  if (!me) return navigate(href.signin(window.location.hash));
                  try {
                    db.toggleFollow(user.id);
                  } catch (e) {
                    toast.show({ tone: 'error', title: (e as Error).message });
                  }
                }}
              >
                {stats.isFollowing ? 'Following' : 'Follow'}
              </Button>
            )}
          </div>
        </div>

        {user.bio && <p className="mt-5 max-w-xl text-ink-muted">{user.bio}</p>}
        <div className="mt-6 flex gap-10">
          <Stat value={stats.designs} label="designs" />
          <Stat value={stats.likes} label="likes received" />
          <Stat value={stats.followers} label="followers" />
          <Stat value={stats.following} label="following" />
        </div>

        <div className="mt-10 border-b border-line pb-4">
          <SegmentedControl<Tab> label="Show" value={tab} onChange={setTab} segments={tabs} />
        </div>

        {list.length === 0 ? (
          <div className="mt-12 rounded-lg border-2 border-dashed border-line-strong px-6 py-14 text-center">
            <p className="font-display text-lg font-semibold text-ink">
              {tab === 'liked' ? 'No likes yet.' : tab === 'drafts' ? 'No drafts.' : own ? 'You haven’t shared anything yet.' : 'Nothing shared yet.'}
            </p>
            {own && tab !== 'liked' && (
              <ButtonLink href={ROUTE_HASH.create} variant="primary" icon={Plus} className="mt-5">
                Make a design
              </ButtonLink>
            )}
          </div>
        ) : (
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((d, i) => (
              <motion.li key={d.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.04, duration: 0.35 }}>
                <DesignCard design={d} showAuthor={tab === 'liked'} />
              </motion.li>
            ))}
          </ul>
        )}
      </main>
      {own && me && editing && <EditProfile user={me} open={editing} onClose={() => setEditing(false)} />}
    </div>
  );
};
