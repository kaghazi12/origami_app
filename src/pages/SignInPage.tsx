import React, { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { TopBar } from '../components/shell/TopBar';
import { Avatar } from '../components/community/People';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { Reveal } from '../components/ui/Motion';
import { useToast } from '../components/ui/Toast';
import { cn } from '../components/ui/cn';
import { db, useDb, LIMITS, PAPER_COLORS, StoreError } from '../store';
import { ROUTE_HASH, hashParam, navigate, usePageTitle } from '../router';

/** Where to go after signing in: the page that sent you here, or Explore. */
function next(): string {
  const n = hashParam('next');
  return n && n.startsWith('#/') && !n.startsWith('#/signin') ? n : ROUTE_HASH.explore;
}

export const SignInPage: React.FC = () => {
  usePageTitle('Sign in');
  const toast = useToast();
  const users = useDb((d) => d.users());
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleTouched, setHandleTouched] = useState(false);
  const [color, setColor] = useState(PAPER_COLORS[users.length % PAPER_COLORS.length]);
  const [error, setError] = useState<string | null>(null);

  const suggested = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, LIMITS.handleLength);
  const handleValue = handleTouched ? handle : suggested;

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const u = db.createUser({ name, handle: handleValue, color });
      toast.show({ title: `Welcome, ${u.name}` });
      navigate(next());
    } catch (err) {
      if (err instanceof StoreError) setError(err.message);
      else throw err;
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <TopBar route="signin" className="sticky top-0 z-40" />
      <main className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-12 px-6 py-16 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">Make a profile</h1>
          <p className="mt-3 max-w-md text-ink-muted">
            Share your designs, like and comment on others, and remix them. Profiles are kept in this browser for now.
          </p>
          <form onSubmit={create} className="mt-8 space-y-5 rounded-lg border border-line bg-surface-raised p-6">
            <TextField label="Name" value={name} maxCount={LIMITS.nameLength} onChange={(e) => { setName(e.target.value); setError(null); }} autoComplete="name" placeholder="Your name" />
            <TextField
              label="Username"
              prefix="@"
              value={handleValue}
              maxCount={LIMITS.handleLength}
              onChange={(e) => { setHandleTouched(true); setHandle(e.target.value.toLowerCase()); setError(null); }}
              hint="Lowercase letters, numbers, dots and dashes. It’s in your profile link."
            />
            <fieldset>
              <legend className="text-sm font-medium text-ink">Your paper colour</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {PAPER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Colour ${c}`}
                    aria-pressed={c === color}
                    onClick={() => setColor(c)}
                    className={cn(
                      'grid size-8 place-items-center rounded-sm transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60 focus-visible:ring-offset-2',
                      c === color ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface-raised' : 'hover:-translate-y-0.5',
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {c === color && <Check className="size-4 text-paper" strokeWidth={2.5} />}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex items-center gap-3 border-t border-line pt-5">
              <Avatar user={{ name: name || '?', color }} size="md" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium text-ink">{name || 'Your name'}</div>
                <div className="truncate text-ink-muted">@{handleValue || 'username'}</div>
              </div>
              <Button type="submit" variant="primary" disabled={!name.trim()}>
                Create profile
              </Button>
            </div>
            {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          </form>
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">Or continue as</h2>
          <p className="mt-2 text-sm text-ink-muted">Profiles made in this browser, including the sample ones.</p>
          <ul className="mt-6 space-y-2">
            {users.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => {
                    db.signIn(u.id);
                    navigate(next());
                  }}
                  className="group flex w-full items-center gap-3 rounded-lg border border-line bg-surface-raised p-3 text-left transition-[border-color,box-shadow,translate] duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
                >
                  <Avatar user={u} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{u.name}</span>
                    <span className="block truncate text-xs text-ink-muted">@{u.handle}{u.bio ? ` · ${u.bio}` : ''}</span>
                  </span>
                  <ArrowRight className="size-4 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        </Reveal>
      </main>
    </div>
  );
};
