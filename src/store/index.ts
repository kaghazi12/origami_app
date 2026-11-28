/**
 * The site's data for the pages: one database for this browser, and a hook that re-renders when
 * it changes (here or in another tab).
 */
import { useCallback, useSyncExternalStore } from 'react';
import { Db, type StorageLike } from './db';
import { resolveBundled, seedState } from './seed';

export * from './schema';
export { Db, PAPER_COLORS, type DesignQuery, type NewDesign } from './db';
export { resolveBundled } from './seed';

const KEY = 'origami.db.v1';

/** localStorage, or memory when the browser blocks it (private windows, file previews). */
function browserStorage(): StorageLike {
  try {
    const s = window.localStorage;
    s.setItem('origami.probe', '1');
    s.removeItem('origami.probe');
    return s;
  } catch {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
  }
}

export const db = new Db({ storage: browserStorage(), key: KEY, seed: () => seedState(), resolveBundled });

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) db.reloadFromStorage();
  });
}

/**
 * Read from the database and re-render when it changes:
 *   const me = useDb((db) => db.me);
 * The selector runs on every render, so keep it cheap or memoise what you derive from it.
 */
export function useDb<T>(select: (d: Db) => T): T {
  const version = useSyncExternalStore(
    useCallback((fn: () => void) => db.subscribe(fn), []),
    () => db.version,
    () => db.version,
  );
  void version;
  return select(db);
}
