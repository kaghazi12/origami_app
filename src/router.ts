import { useEffect, useState } from 'react';

/** The app's three pages. Hash routing keeps it working on any static host. */
export type Route = 'home' | 'learn' | 'creasePattern';

export const ROUTE_HASH: Record<Route, string> = {
  home: '#/',
  learn: '#/learn',
  creasePattern: '#/crease-pattern',
};

export function routeFromHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '').replace(/\/$/, '');
  // older links (#learn, #crease-pattern, #modern) keep working
  if (h === 'learn') return 'learn';
  if (h === 'crease-pattern' || h === 'modern') return 'creasePattern';
  return 'home';
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? 'home' : routeFromHash(window.location.hash),
  );
  useEffect(() => {
    const onHash = () => {
      setRoute(routeFromHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

/** Sets the page title: "Crane · Origami", or just "Origami". */
export function usePageTitle(part?: string | null) {
  useEffect(() => {
    document.title = part ? `${part} · Origami` : 'Origami';
  }, [part]);
}
