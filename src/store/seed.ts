/**
 * What a brand-new browser starts with, so the site isn't empty: the bundled designs, shared by the
 * site's own library account, and a few sample people (made up) who like, comment and follow.
 */
import { PATTERNS, STEP_DESIGNS, patternById } from '../designs';
import type { DbState, DesignRecord, User } from './schema';

const DAY = 24 * 3600 * 1000;

/** The file of a bundled design: "step:<id>" (Learn) or "pattern:<id>" (Crease pattern). */
export function resolveBundled(id: string): unknown {
  const [kind, key] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (kind === 'step') return STEP_DESIGNS.find((d) => d.id === key)?.json ?? null;
  if (kind === 'pattern') {
    try {
      return patternById(key)?.create() ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

const SHARED_PATTERNS: { id: string; credit?: string; description: string; tags: string[] }[] = [
  { id: 'bird-base', credit: 'Traditional', description: 'The base behind the crane and the flapping bird, as a crease pattern.', tags: ['base', 'bird'] },
  { id: 'box', credit: 'Jason Ku', description: 'A box with a wing, given as its folded form. The site unfolds it into a crease pattern and folds it back.', tags: ['box', 'folded form'] },
  { id: 'miura', credit: 'Koryo Miura', description: 'The Miura fold: a pleated map fold that opens and closes in one motion.', tags: ['tessellation', 'rigid'] },
  { id: 'waterbomb', credit: 'Traditional', description: 'The waterbomb base, one of the two classic starting points.', tags: ['base'] },
  { id: 'box-pleat', description: 'A 48 × 48 box-pleated pattern with 1,170 creases. Folds exactly into 332 layers.', tags: ['box pleating', 'complex'] },
];

export function seedState(now = Date.now()): DbState {
  const users: User[] = [
    { id: 'u-origami', handle: 'origami', name: 'Origami library', bio: 'The designs that come with the site: traditional models and classic bases.', color: '#121a30', createdAt: now - 60 * DAY },
    { id: 'u-hana', handle: 'hana', name: 'Hana', bio: 'Folds a crane a day. Sample profile.', color: '#b8232f', createdAt: now - 40 * DAY },
    { id: 'u-leo', handle: 'leo', name: 'Leo', bio: 'Tessellations and box pleating. Sample profile.', color: '#2f56c8', createdAt: now - 30 * DAY },
  ];
  const designs: DesignRecord[] = [];
  STEP_DESIGNS.forEach((d, i) => {
    const meta = (d.json as { meta: { description?: string; author?: string; tags?: string[] } }).meta;
    const t = now - (50 - i * 4) * DAY;
    designs.push({
      id: `d-${d.id}`,
      kind: 'steps',
      title: d.title,
      description: meta.description ?? '',
      authorId: 'u-origami',
      credit: meta.author,
      difficulty: d.difficulty as DesignRecord['difficulty'],
      tags: meta.tags ?? [],
      source: { type: 'bundled', id: `step:${d.id}` },
      status: 'published',
      createdAt: t,
      updatedAt: t,
      publishedAt: t,
      size: d.stepCount,
      front: d.front,
      back: d.back,
    });
  });
  SHARED_PATTERNS.forEach((p, i) => {
    const entry = PATTERNS.find((x) => x.id === p.id);
    if (!entry) return;
    const t = now - (45 - i * 5) * DAY;
    const creases = parseInt(entry.meta.replace(/[^0-9]/g, ''), 10);
    designs.push({
      id: `d-pattern-${p.id}`,
      kind: 'pattern',
      title: entry.title,
      description: p.description,
      authorId: p.id === 'miura' || p.id === 'box-pleat' ? 'u-leo' : 'u-origami',
      credit: p.credit,
      tags: p.tags,
      source: { type: 'bundled', id: `pattern:${p.id}` },
      status: 'published',
      createdAt: t,
      updatedAt: t,
      publishedAt: t,
      size: Number.isFinite(creases) ? creases : 0,
    });
  });

  // a sample remix: Hana's cup in her colours
  const cup = STEP_DESIGNS[0];
  const cupJson = JSON.parse(JSON.stringify(cup.json)) as { meta: { id: string; title: string }; paper: { front: string; back: string } };
  cupJson.meta = { ...cupJson.meta, id: 'hana-cup', title: 'Red paper cup' };
  cupJson.paper = { ...cupJson.paper, front: '#b8232f', back: '#f6efdf' };
  designs.push({
    id: 'd-hana-cup',
    kind: 'steps',
    title: 'Red paper cup',
    description: 'The paper cup in red kami. Same folds, my colours.',
    authorId: 'u-hana',
    credit: 'Traditional',
    difficulty: 'beginner',
    tags: ['cup', 'remix'],
    source: { type: 'inline', data: cupJson },
    status: 'published',
    createdAt: now - 6 * DAY,
    updatedAt: now - 6 * DAY,
    publishedAt: now - 6 * DAY,
    remixOf: `d-${cup.id}`,
    size: cup.stepCount,
    front: '#b8232f',
    back: '#f6efdf',
  });

  const like = (designId: string, userId: string, daysAgo: number) => ({ designId, userId, createdAt: now - daysAgo * DAY });
  const comment = (id: string, designId: string, authorId: string, text: string, daysAgo: number) => ({ id, designId, authorId, text, createdAt: now - daysAgo * DAY });
  return {
    version: 1,
    users: Object.fromEntries(users.map((u) => [u.id, u])),
    designs: Object.fromEntries(designs.map((d) => [d.id, d])),
    likes: [
      like('d-crane', 'u-hana', 20), like('d-crane', 'u-leo', 18), like('d-swan', 'u-hana', 12),
      like('d-paper-cup', 'u-hana', 7), like('d-pattern-box-pleat', 'u-hana', 9), like('d-hana-cup', 'u-leo', 5),
      like('d-samurai-helmet', 'u-leo', 4), like('d-pattern-miura', 'u-hana', 15),
    ],
    comments: [
      comment('c1', 'd-crane', 'u-hana', 'Step 13, the petal fold, finally made sense when I turned the model round to look at it from the side.', 19),
      comment('c2', 'd-crane', 'u-leo', 'Try it with 15 cm kami first; foil paper holds the petal folds better.', 17),
      comment('c3', 'd-pattern-box-pleat', 'u-hana', 'Watching 332 layers stack up is unreal.', 8),
      comment('c4', 'd-hana-cup', 'u-leo', 'Red suits it.', 5),
    ],
    follows: [
      { followerId: 'u-hana', followeeId: 'u-leo', createdAt: now - 14 * DAY },
      { followerId: 'u-leo', followeeId: 'u-origami', createdAt: now - 25 * DAY },
      { followerId: 'u-hana', followeeId: 'u-origami', createdAt: now - 35 * DAY },
    ],
    sessionUserId: null,
  };
}
