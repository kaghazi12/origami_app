import { useEffect, useState } from 'react';

/**
 * The app's pages. Hash routing keeps it working on any static host.
 *
 *   #/                    home
 *   #/learn               Learn (?design=<id> opens a shared design)
 *   #/crease-pattern      Crease pattern (?pattern=<bundled id> or ?design=<id>)
 *   #/explore             designs people shared
 *   #/d/<id>              one design: viewer, likes, comments, remix
 *   #/u/<handle>          a profile
 *   #/create, #/create/<id>   the design editor (new, or a draft of yours)
 *   #/signin
 */
export type Route = 'home' | 'learn' | 'creasePattern' | 'explore' | 'design' | 'profile' | 'create' | 'signin';

export interface RouteInfo {
  name: Route;
  /** Design id (design, create) or handle (profile). */
  id?: string;
  /** The query after '?', e.g. "design=abc" (a different query is a different page). */
  search?: string;
}

export const ROUTE_HASH = {
  home: '#/',
  learn: '#/learn',
  creasePattern: '#/crease-pattern',
  explore: '#/explore',
  create: '#/create',
  signin: '#/signin',
} as const;

export const href = {
  design: (id: string) => `#/d/${encodeURIComponent(id)}`,
  profile: (handle: string) => `#/u/${encodeURIComponent(handle)}`,
  edit: (id: string) => `#/create/${encodeURIComponent(id)}`,
  learn: (designId: string) => `${ROUTE_HASH.learn}?design=${encodeURIComponent(designId)}`,
  creasePattern: (designId: string) => `${ROUTE_HASH.creasePattern}?design=${encodeURIComponent(designId)}`,
  /** Sign in, then come back here. */
  signin: (back?: string) => (back ? `${ROUTE_HASH.signin}?next=${encodeURIComponent(back)}` : ROUTE_HASH.signin),
};

export function routeFromHash(hash: string): RouteInfo {
  const r = routeName(hash);
  const search = hash.split('?')[1];
  return search ? { ...r, search } : r;
}

function routeName(hash: string): RouteInfo {
  const path = hash.replace(/^#\/?/, '').split('?')[0].replace(/\/$/, '');
  const [head, rest] = [path.split('/')[0], decodeURIComponent(path.split('/').slice(1).join('/'))];
  // older links (#learn, #crease-pattern, #modern) keep working
  if (head === 'learn') return { name: 'learn' };
  if (head === 'crease-pattern' || head === 'modern') return { name: 'creasePattern' };
  if (head === 'explore') return { name: 'explore' };
  if (head === 'signin') return { name: 'signin' };
  if (head === 'create') return { name: 'create', id: rest || undefined };
  if (head === 'd' && rest) return { name: 'design', id: rest };
  if (head === 'u' && rest) return { name: 'profile', id: rest };
  return { name: 'home' };
}

export function useRoute(): RouteInfo {
  const [route, setRoute] = useState<RouteInfo>(() =>
    typeof window === 'undefined' ? { name: 'home' } : routeFromHash(window.location.hash),
  );
  useEffect(() => {
    const onHash = () => {
      const next = routeFromHash(window.location.hash);
      setRoute((prev) => (prev.name === next.name && prev.id === next.id && prev.search === next.search ? prev : next));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

/** Go to a page (a hash from ROUTE_HASH or href). */
export function navigate(hash: string) {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

/** A query value from the hash: `#/crease-pattern?pattern=bird-base` → 'bird-base'. */
export function hashParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get(name);
}

/** A link that works on another machine's copy of this page (the design data still lives in this browser). */
export function absoluteLink(hash: string): string {
  return `${window.location.origin}${window.location.pathname}${hash}`;
}

/** Sets the page title: "Crane · Origami", or just "Origami". */
export function usePageTitle(part?: string | null) {
  useEffect(() => {
    document.title = part ? `${part} · Origami` : 'Origami';
  }, [part]);
}
