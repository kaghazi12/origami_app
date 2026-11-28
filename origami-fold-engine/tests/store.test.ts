/**
 * The site's browser-side database (src/store/db.ts): the rules a server would enforce
 * (sign-in, ownership, private drafts, limits) and that everything survives a reload.
 */
import { describe, expect, it } from 'vitest';
import { Db, type StorageLike } from '../../src/store/db';
import { LIMITS, StoreError } from '../../src/store/schema';

function memory(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

let clock = 1_000_000;
const make = (storage = memory()) => new Db({ storage, now: () => clock++, resolveBundled: (id) => ({ bundled: id }) });
const steps = { format: 'origami-design', version: 1, meta: { id: 'x', title: 'x' }, paper: { width: 1, height: 1 }, steps: [] };

describe('store', () => {
  it('profiles: usernames are unique, lowercase and checked; making one signs you in', () => {
    const db = make();
    const ana = db.createUser({ handle: 'Ana', name: 'Ana' });
    expect(ana.handle).toBe('ana');
    expect(db.me?.id).toBe(ana.id);
    expect(() => db.createUser({ handle: 'ana', name: 'Other' })).toThrow(/taken/);
    expect(() => db.createUser({ handle: 'a b', name: 'X' })).toThrow(StoreError);
    expect(() => db.createUser({ handle: 'ok', name: '  ' })).toThrow(/name/);
    db.signOut();
    expect(db.me).toBeNull();
    expect(() => db.createDesign({ kind: 'steps', title: 'T', source: { type: 'inline', data: steps } })).toThrow(/Sign in/);
  });

  it('drafts are private; publishing puts a design in the feed; only the author can change it', () => {
    const db = make();
    const ana = db.createUser({ handle: 'ana', name: 'Ana' });
    const d = db.createDesign({ kind: 'steps', title: 'Cup', source: { type: 'inline', data: steps } });
    expect(d.status).toBe('draft');
    expect(db.designs()).toHaveLength(0);
    expect(db.designs({ authorId: ana.id, includeDrafts: true })).toHaveLength(1);
    db.createUser({ handle: 'ben', name: 'Ben' });
    expect(db.design(d.id)).toBeNull(); // Ben can't see Ana's draft
    expect(() => db.publish(d.id)).toThrow(/Only the person/);
    db.signIn(ana.id);
    db.publish(d.id);
    expect(db.designs().map((x) => x.id)).toEqual([d.id]);
    expect(() => db.updateDesign(d.id, { title: '' })).toThrow(/title/);
    expect(() => db.updateDesign(d.id, { title: 'x'.repeat(LIMITS.titleLength + 1) })).toThrow(/at most/);
  });

  it('likes, comments and follows, with the right permissions', () => {
    const db = make();
    const ana = db.createUser({ handle: 'ana', name: 'Ana' });
    const d = db.createDesign({ kind: 'steps', title: 'Cup', source: { type: 'inline', data: steps } });
    expect(() => db.addComment(d.id, 'hi')).toThrow(/published/);
    db.publish(d.id);
    const ben = db.createUser({ handle: 'ben', name: 'Ben' });
    expect(db.toggleLike(d.id)).toBe(true);
    expect(db.likeCount(d.id)).toBe(1);
    expect(db.likesReceived(ana.id)).toBe(1);
    expect(db.toggleLike(d.id)).toBe(false);
    expect(db.likeCount(d.id)).toBe(0);
    const c = db.addComment(d.id, '  Nice cup  ');
    expect(c.text).toBe('Nice cup');
    expect(() => db.addComment(d.id, ' ')).toThrow(/Write something/);
    expect(db.toggleFollow(ana.id)).toBe(true);
    expect(db.designs({ followedBy: ben.id }).map((x) => x.id)).toEqual([d.id]);
    expect(() => db.toggleFollow(ben.id)).toThrow(/yourself/);
    // the design's author may delete comments on it; others only their own
    db.signIn(ana.id);
    db.deleteComment(c.id);
    expect(db.comments(d.id)).toHaveLength(0);
  });

  it('remix copies the file into your drafts and remembers the original', () => {
    const db = make();
    db.createUser({ handle: 'ana', name: 'Ana' });
    const d = db.createDesign({ kind: 'pattern', title: 'Base', source: { type: 'bundled', id: 'pattern:bird-base' } });
    db.publish(d.id);
    const ben = db.createUser({ handle: 'ben', name: 'Ben' });
    const r = db.remix(d.id);
    expect(r.authorId).toBe(ben.id);
    expect(r.status).toBe('draft');
    expect(r.remixOf).toBe(d.id);
    expect(r.title).toBe('Base (remix)');
    expect(r.source).toEqual({ type: 'inline', data: { bundled: 'pattern:bird-base' } });
  });

  it('sorts by likes for "Most liked" and finds designs by words', () => {
    const db = make();
    db.createUser({ handle: 'ana', name: 'Ana' });
    const a = db.publish(db.createDesign({ kind: 'steps', title: 'Paper crane', tags: ['bird'], source: { type: 'inline', data: steps } }).id);
    const b = db.publish(db.createDesign({ kind: 'steps', title: 'Cup', source: { type: 'inline', data: steps } }).id);
    db.createUser({ handle: 'ben', name: 'Ben' });
    db.toggleLike(a.id);
    expect(db.designs({ sort: 'new' })[0].id).toBe(b.id);
    expect(db.designs({ sort: 'popular' })[0].id).toBe(a.id);
    expect(db.designs({ query: 'BIRD' }).map((x) => x.id)).toEqual([a.id]);
    expect(db.designs({ query: 'ana cup' }).map((x) => x.id)).toEqual([b.id]);
  });

  it('keeps everything across a reload, and a failed save changes nothing', () => {
    const storage = memory();
    const db = make(storage);
    db.createUser({ handle: 'ana', name: 'Ana' });
    const d = db.createDesign({ kind: 'steps', title: 'Cup', source: { type: 'inline', data: steps } });
    const again = make(storage);
    expect(again.me?.handle).toBe('ana');
    expect(again.design(d.id)?.title).toBe('Cup');
    // storage full
    const full: StorageLike = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error('QuotaExceededError'); } };
    const db2 = new Db({ storage: full, now: () => clock++ });
    expect(() => db2.createUser({ handle: 'x1', name: 'X' })).toThrow(/storage .* is full/);
    expect(db2.users()).toHaveLength(0);
  });

  it('refuses files over the size limit', () => {
    const db = make();
    db.createUser({ handle: 'ana', name: 'Ana' });
    const big = { blob: 'x'.repeat(LIMITS.designBytes + 10) };
    expect(() => db.createDesign({ kind: 'pattern', title: 'Huge', source: { type: 'inline', data: big } })).toThrow(/KB/);
  });
});
