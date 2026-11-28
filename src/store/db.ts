/**
 * The site's database, kept in this browser's localStorage.
 *
 * Every page talks to the site through this class, so a real server can replace it later: the
 * method names are the API. It is synchronous (localStorage is), saves after every change, tells
 * subscribers (React re-renders through useDb), and follows changes made in other tabs.
 *
 * Rules it enforces, as a server would: you must be signed in to make or change anything, you can
 * only change or delete your own designs, comments and profile, drafts are visible only to their
 * author, and files and texts have size limits.
 */

import {
  LIMITS,
  StoreError,
  type Comment,
  type DbState,
  type DesignKind,
  type DesignRecord,
  type DesignSource,
  type Difficulty,
  type User,
} from './schema';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DbOptions {
  storage: StorageLike;
  key?: string;
  /** The content for a brand-new database (sample people and the bundled designs). */
  seed?: () => DbState;
  /** The file of a bundled design (for remixes, which need a copy they can edit). */
  resolveBundled?: (id: string) => unknown;
  now?: () => number;
}

export interface DesignQuery {
  /** Published only (default), or one person's designs including drafts when they're signed in. */
  authorId?: string;
  includeDrafts?: boolean;
  kind?: DesignKind;
  /** Words to find in the title, description, tags, credit or author. */
  query?: string;
  sort?: 'new' | 'popular';
  /** Only designs by people this user follows. */
  followedBy?: string;
  /** Only designs this user liked. */
  likedBy?: string;
}

export interface NewDesign {
  kind: DesignKind;
  title: string;
  description?: string;
  credit?: string;
  difficulty?: Difficulty;
  tags?: string[];
  source: DesignSource;
  size?: number;
  front?: string;
  back?: string;
}

export const PAPER_COLORS = ['#b8232f', '#2f56c8', '#2f7a52', '#f5b301', '#9c5a2b', '#121a30', '#d6402a', '#6b4fa0'];

const emptyState = (): DbState => ({
  version: 1,
  users: {},
  designs: {},
  comments: [],
  likes: [],
  follows: [],
  sessionUserId: null,
});

export function newId(): string {
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 9);
}

const HANDLE = /^[a-z0-9][a-z0-9._-]*$/;

export class Db {
  private state: DbState;
  private readonly storage: StorageLike;
  private readonly key: string;
  private readonly opts: DbOptions;
  private listeners = new Set<() => void>();
  /** Bumped on every change; React's useSyncExternalStore snapshot. */
  version = 0;

  constructor(opts: DbOptions) {
    this.opts = opts;
    this.storage = opts.storage;
    this.key = opts.key ?? 'origami.db.v1';
    this.state = this.load();
  }

  private now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private load(): DbState {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      /* storage blocked (private mode): run in memory */
    }
    if (raw) {
      try {
        const s = JSON.parse(raw) as DbState;
        if (s && s.version === 1 && s.users && s.designs) return { ...emptyState(), ...s };
      } catch {
        /* unreadable: start again below */
      }
    }
    const fresh = this.opts.seed ? this.opts.seed() : emptyState();
    this.persist(fresh, true);
    return fresh;
  }

  private persist(s: DbState, quiet = false) {
    try {
      this.storage.setItem(this.key, JSON.stringify(s));
    } catch (e) {
      if (quiet) return;
      throw new StoreError('Your browser’s storage for this site is full. Delete some drafts or large files and try again.');
    }
  }

  /** Apply a change, save it, and tell subscribers. A failed save leaves everything as it was. */
  private commit(next: DbState) {
    this.persist(next);
    this.state = next;
    this.emit();
  }

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Another tab changed the data: pick it up. */
  reloadFromStorage() {
    this.state = this.load();
    this.emit();
  }

  /** Start again from the sample content (sign-in page, "Reset this browser's data"). */
  reset() {
    const fresh = this.opts.seed ? this.opts.seed() : emptyState();
    this.commit(fresh);
  }

  // ------------------------------------------------------------------------------------------
  // people and sign-in

  get me(): User | null {
    const id = this.state.sessionUserId;
    return id ? this.state.users[id] ?? null : null;
  }

  private requireMe(): User {
    const me = this.me;
    if (!me) throw new StoreError('Sign in first.');
    return me;
  }

  users(): User[] {
    return Object.values(this.state.users).sort((a, b) => a.createdAt - b.createdAt);
  }

  user(id: string | undefined | null): User | null {
    return id ? this.state.users[id] ?? null : null;
  }

  userByHandle(handle: string): User | null {
    const h = handle.toLowerCase();
    return Object.values(this.state.users).find((u) => u.handle === h) ?? null;
  }

  signIn(userId: string) {
    if (!this.state.users[userId]) throw new StoreError('That profile doesn’t exist any more.');
    this.commit({ ...this.state, sessionUserId: userId });
  }

  signOut() {
    this.commit({ ...this.state, sessionUserId: null });
  }

  private checkProfile(p: { handle?: string; name?: string; bio?: string }, selfId?: string) {
    if (p.handle !== undefined) {
      const h = p.handle.trim().toLowerCase();
      if (h.length < 2) throw new StoreError('Your username needs at least 2 characters.');
      if (h.length > LIMITS.handleLength) throw new StoreError(`Your username can be at most ${LIMITS.handleLength} characters.`);
      if (!HANDLE.test(h)) throw new StoreError('Use only lowercase letters, numbers, dots, dashes and underscores in your username.');
      const taken = this.userByHandle(h);
      if (taken && taken.id !== selfId) throw new StoreError(`@${h} is taken. Try another username.`);
    }
    if (p.name !== undefined) {
      if (!p.name.trim()) throw new StoreError('Add your name.');
      if (p.name.length > LIMITS.nameLength) throw new StoreError(`Your name can be at most ${LIMITS.nameLength} characters.`);
    }
    if (p.bio !== undefined && p.bio.length > LIMITS.bioLength) throw new StoreError(`Your bio can be at most ${LIMITS.bioLength} characters.`);
  }

  /** Make a profile and sign in with it. */
  createUser(p: { handle: string; name: string; bio?: string; color?: string }): User {
    this.checkProfile(p);
    const users = Object.values(this.state.users);
    const u: User = {
      id: newId(),
      handle: p.handle.trim().toLowerCase(),
      name: p.name.trim(),
      bio: (p.bio ?? '').trim(),
      color: p.color ?? PAPER_COLORS[users.length % PAPER_COLORS.length],
      createdAt: this.now(),
    };
    this.commit({ ...this.state, users: { ...this.state.users, [u.id]: u }, sessionUserId: u.id });
    return u;
  }

  updateProfile(patch: Partial<Pick<User, 'handle' | 'name' | 'bio' | 'color'>>): User {
    const me = this.requireMe();
    this.checkProfile(patch, me.id);
    const next: User = {
      ...me,
      ...patch,
      handle: patch.handle !== undefined ? patch.handle.trim().toLowerCase() : me.handle,
      name: patch.name !== undefined ? patch.name.trim() : me.name,
      bio: patch.bio !== undefined ? patch.bio.trim() : me.bio,
    };
    this.commit({ ...this.state, users: { ...this.state.users, [me.id]: next } });
    return next;
  }

  // ------------------------------------------------------------------------------------------
  // designs

  design(id: string | undefined | null): DesignRecord | null {
    if (!id) return null;
    const d = this.state.designs[id];
    if (!d) return null;
    // drafts are private
    if (d.status === 'draft' && d.authorId !== this.state.sessionUserId) return null;
    return d;
  }

  /** The file of a design (resolving bundled ones). */
  fileOf(d: DesignRecord): unknown {
    return d.source.type === 'inline' ? d.source.data : this.opts.resolveBundled?.(d.source.id) ?? null;
  }

  designs(q: DesignQuery = {}): DesignRecord[] {
    const meId = this.state.sessionUserId;
    let list = Object.values(this.state.designs).filter((d) => {
      if (d.status === 'draft') return !!(q.includeDrafts && d.authorId === meId && q.authorId === meId);
      return true;
    });
    if (q.authorId) list = list.filter((d) => d.authorId === q.authorId);
    if (q.kind) list = list.filter((d) => d.kind === q.kind);
    if (q.followedBy) {
      const following = new Set(this.state.follows.filter((f) => f.followerId === q.followedBy).map((f) => f.followeeId));
      list = list.filter((d) => following.has(d.authorId));
    }
    if (q.likedBy) {
      const liked = new Set(this.state.likes.filter((l) => l.userId === q.likedBy).map((l) => l.designId));
      list = list.filter((d) => liked.has(d.id));
    }
    if (q.query?.trim()) {
      const words = q.query.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((d) => {
        const author = this.state.users[d.authorId];
        const hay = [d.title, d.description, d.credit ?? '', d.tags.join(' '), author?.name ?? '', author?.handle ?? ''].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }
    const likes = this.likeCounts();
    const time = (d: DesignRecord) => d.publishedAt ?? d.updatedAt;
    list.sort((a, b) =>
      q.sort === 'popular' ? (likes.get(b.id) ?? 0) - (likes.get(a.id) ?? 0) || time(b) - time(a) : time(b) - time(a),
    );
    return list;
  }

  private checkDesign(p: Partial<NewDesign>) {
    if (p.title !== undefined) {
      if (!p.title.trim()) throw new StoreError('Give your design a title.');
      if (p.title.length > LIMITS.titleLength) throw new StoreError(`Titles can be at most ${LIMITS.titleLength} characters.`);
    }
    if (p.description !== undefined && p.description.length > LIMITS.descriptionLength) {
      throw new StoreError(`Descriptions can be at most ${LIMITS.descriptionLength} characters.`);
    }
    if (p.tags && p.tags.length > LIMITS.tags) throw new StoreError(`Use at most ${LIMITS.tags} tags.`);
    if (p.source?.type === 'inline') {
      const bytes = JSON.stringify(p.source.data ?? null).length;
      if (bytes > LIMITS.designBytes) {
        throw new StoreError(`This file is ${Math.round(bytes / 1000)} KB; designs can be at most ${LIMITS.designBytes / 1000} KB here.`);
      }
    }
  }

  private requireOwn(id: string): DesignRecord {
    const me = this.requireMe();
    const d = this.state.designs[id];
    if (!d) throw new StoreError('That design doesn’t exist any more.');
    if (d.authorId !== me.id) throw new StoreError('Only the person who made this design can change it.');
    return d;
  }

  /** A new draft, owned by whoever is signed in. */
  createDesign(p: NewDesign): DesignRecord {
    const me = this.requireMe();
    this.checkDesign(p);
    const t = this.now();
    const d: DesignRecord = {
      id: newId(),
      kind: p.kind,
      title: p.title.trim(),
      description: (p.description ?? '').trim(),
      authorId: me.id,
      credit: p.credit,
      difficulty: p.difficulty,
      tags: p.tags ?? [],
      source: p.source,
      status: 'draft',
      createdAt: t,
      updatedAt: t,
      size: p.size ?? 0,
      front: p.front,
      back: p.back,
    };
    this.commit({ ...this.state, designs: { ...this.state.designs, [d.id]: d } });
    return d;
  }

  updateDesign(id: string, patch: Partial<NewDesign>): DesignRecord {
    const d = this.requireOwn(id);
    this.checkDesign(patch);
    const next: DesignRecord = {
      ...d,
      ...patch,
      title: patch.title !== undefined ? patch.title.trim() : d.title,
      description: patch.description !== undefined ? patch.description.trim() : d.description,
      updatedAt: this.now(),
    };
    this.commit({ ...this.state, designs: { ...this.state.designs, [id]: next } });
    return next;
  }

  publish(id: string): DesignRecord {
    const d = this.requireOwn(id);
    const next: DesignRecord = { ...d, status: 'published', publishedAt: d.publishedAt ?? this.now(), updatedAt: this.now() };
    this.commit({ ...this.state, designs: { ...this.state.designs, [id]: next } });
    return next;
  }

  unpublish(id: string): DesignRecord {
    const d = this.requireOwn(id);
    const next: DesignRecord = { ...d, status: 'draft', updatedAt: this.now() };
    this.commit({ ...this.state, designs: { ...this.state.designs, [id]: next } });
    return next;
  }

  deleteDesign(id: string) {
    this.requireOwn(id);
    const designs = { ...this.state.designs };
    delete designs[id];
    this.commit({
      ...this.state,
      designs,
      likes: this.state.likes.filter((l) => l.designId !== id),
      comments: this.state.comments.filter((c) => c.designId !== id),
    });
  }

  /** Copy someone's design into your drafts to change it. */
  remix(id: string): DesignRecord {
    const me = this.requireMe();
    const src = this.design(id);
    if (!src) throw new StoreError('That design doesn’t exist any more.');
    const data = this.fileOf(src);
    if (data === null || data === undefined) throw new StoreError('This design’s file can’t be copied.');
    const t = this.now();
    const d: DesignRecord = {
      ...src,
      id: newId(),
      title: src.title.endsWith('(remix)') ? src.title : `${src.title} (remix)`.slice(0, LIMITS.titleLength),
      authorId: me.id,
      source: { type: 'inline', data: JSON.parse(JSON.stringify(data)) },
      status: 'draft',
      createdAt: t,
      updatedAt: t,
      publishedAt: undefined,
      remixOf: src.id,
    };
    this.commit({ ...this.state, designs: { ...this.state.designs, [d.id]: d } });
    return d;
  }

  remixesOf(id: string): DesignRecord[] {
    return this.designs().filter((d) => d.remixOf === id);
  }

  // ------------------------------------------------------------------------------------------
  // likes

  private likeCounts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const l of this.state.likes) m.set(l.designId, (m.get(l.designId) ?? 0) + 1);
    return m;
  }

  likeCount(designId: string): number {
    let n = 0;
    for (const l of this.state.likes) if (l.designId === designId) n++;
    return n;
  }

  likedByMe(designId: string): boolean {
    const me = this.state.sessionUserId;
    return !!me && this.state.likes.some((l) => l.designId === designId && l.userId === me);
  }

  toggleLike(designId: string): boolean {
    const me = this.requireMe();
    if (!this.design(designId)) throw new StoreError('That design doesn’t exist any more.');
    const has = this.likedByMe(designId);
    const likes = has
      ? this.state.likes.filter((l) => !(l.designId === designId && l.userId === me.id))
      : [...this.state.likes, { designId, userId: me.id, createdAt: this.now() }];
    this.commit({ ...this.state, likes });
    return !has;
  }

  /** Likes on everything a person has published. */
  likesReceived(userId: string): number {
    const mine = new Set(Object.values(this.state.designs).filter((d) => d.authorId === userId && d.status === 'published').map((d) => d.id));
    return this.state.likes.filter((l) => mine.has(l.designId)).length;
  }

  // ------------------------------------------------------------------------------------------
  // comments

  comments(designId: string): Comment[] {
    return this.state.comments.filter((c) => c.designId === designId).sort((a, b) => a.createdAt - b.createdAt);
  }

  commentCount(designId: string): number {
    let n = 0;
    for (const c of this.state.comments) if (c.designId === designId) n++;
    return n;
  }

  addComment(designId: string, text: string): Comment {
    const me = this.requireMe();
    const d = this.design(designId);
    if (!d || d.status !== 'published') throw new StoreError('You can comment once the design is published.');
    const t = text.trim();
    if (!t) throw new StoreError('Write something first.');
    if (t.length > LIMITS.commentLength) throw new StoreError(`Comments can be at most ${LIMITS.commentLength} characters.`);
    const c: Comment = { id: newId(), designId, authorId: me.id, text: t, createdAt: this.now() };
    this.commit({ ...this.state, comments: [...this.state.comments, c] });
    return c;
  }

  /** Your own comments, or any comment on your own design. */
  deleteComment(id: string) {
    const me = this.requireMe();
    const c = this.state.comments.find((x) => x.id === id);
    if (!c) return;
    const d = this.state.designs[c.designId];
    if (c.authorId !== me.id && d?.authorId !== me.id) throw new StoreError('You can only delete your own comments.');
    this.commit({ ...this.state, comments: this.state.comments.filter((x) => x.id !== id) });
  }

  // ------------------------------------------------------------------------------------------
  // follows

  isFollowing(userId: string): boolean {
    const me = this.state.sessionUserId;
    return !!me && this.state.follows.some((f) => f.followerId === me && f.followeeId === userId);
  }

  toggleFollow(userId: string): boolean {
    const me = this.requireMe();
    if (userId === me.id) throw new StoreError('You can’t follow yourself.');
    if (!this.state.users[userId]) throw new StoreError('That profile doesn’t exist any more.');
    const has = this.isFollowing(userId);
    const follows = has
      ? this.state.follows.filter((f) => !(f.followerId === me.id && f.followeeId === userId))
      : [...this.state.follows, { followerId: me.id, followeeId: userId, createdAt: this.now() }];
    this.commit({ ...this.state, follows });
    return !has;
  }

  followerCount(userId: string): number {
    return this.state.follows.filter((f) => f.followeeId === userId).length;
  }

  followingCount(userId: string): number {
    return this.state.follows.filter((f) => f.followerId === userId).length;
  }

  /** Bytes this site uses in the browser's storage. */
  storageUsed(): number {
    return JSON.stringify(this.state).length;
  }
}
