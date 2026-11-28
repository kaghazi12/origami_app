/**
 * The site's data: people, designs, likes, comments, follows.
 *
 * Today everything lives in this browser (localStorage, see db.ts). The shapes are what a server
 * would store, so the pages won't change when one exists: only db.ts gets swapped.
 */

export type DesignKind = 'steps' | 'pattern';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface User {
  id: string;
  /** Unique, lowercase, used in links: #/u/<handle>. */
  handle: string;
  name: string;
  bio: string;
  /** The colour of their paper (avatar). */
  color: string;
  createdAt: number;
}

/**
 * Where a design's file comes from: one of the designs that ship with the app (kept small in
 * storage), or the file itself.
 */
export type DesignSource =
  | { type: 'bundled'; id: string }
  | { type: 'inline'; data: unknown };

export interface DesignRecord {
  id: string;
  kind: DesignKind;
  title: string;
  description: string;
  authorId: string;
  /** Who designed the model, when it isn't the person who shared it ("Traditional", "Jason Ku"). */
  credit?: string;
  difficulty?: Difficulty;
  tags: string[];
  source: DesignSource;
  status: 'draft' | 'published';
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  /** The design this one was copied from. */
  remixOf?: string;
  /** Step count (steps) or crease count (pattern), for cards. */
  size: number;
  /** Paper colours, for thumbnails of step designs. */
  front?: string;
  back?: string;
}

export interface Comment {
  id: string;
  designId: string;
  authorId: string;
  text: string;
  createdAt: number;
}

export interface Like {
  designId: string;
  userId: string;
  createdAt: number;
}

export interface Follow {
  followerId: string;
  followeeId: string;
  createdAt: number;
}

export interface DbState {
  version: 1;
  users: Record<string, User>;
  designs: Record<string, DesignRecord>;
  comments: Comment[];
  likes: Like[];
  follows: Follow[];
  /** Who is signed in on this browser. */
  sessionUserId: string | null;
}

/** Limits that keep one design or comment from filling the browser's storage. */
export const LIMITS = {
  /** Bytes of JSON per uploaded or authored file. */
  designBytes: 600_000,
  titleLength: 80,
  descriptionLength: 1000,
  commentLength: 1000,
  bioLength: 280,
  nameLength: 40,
  handleLength: 24,
  tags: 8,
};

/** A readable error for the person using the site (not a bug). */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}
