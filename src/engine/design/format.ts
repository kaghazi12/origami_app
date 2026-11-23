/**
 * Origami Design Format, version 1.
 *
 * A design is the sheet of paper plus an ordered list of steps. Each step does exactly one
 * action. Coordinates are in paper units (the sheet is `width` x `height`).
 *
 * - `fold` and `reverseFold` take coordinates in the CURRENT VIEW: the model as it lies on the
 *   table after the previous step, seen from above (x right, y up). Before any step the sheet
 *   covers [0,width] x [0,height], so authoring is "click two points on what you see".
 * - `collapse` takes coordinates on the UNFOLDED SHEET (crease-pattern coordinates), so complex
 *   moves (squash, petal, sink...) are written the way designers draw crease patterns.
 */

import type { Vec2 } from './math';

export const DESIGN_FORMAT = 'origami-design';
export const DESIGN_VERSION = 1;

export type Direction = 'valley' | 'mountain';
/** Which layers under the `moving` point to fold. A number means "the top N layers". */
export type LayerSelector = 'all' | 'top' | 'bottom' | number;

export interface FoldAction {
  type: 'fold';
  /** Two points on the fold line, current-view coordinates. */
  line: [Vec2, Vec2];
  /** A point on the paper that moves. Picks the side of the line and the flap. */
  moving: Vec2;
  /** valley: the moving part comes up toward the viewer. mountain: it goes behind. */
  direction: Direction;
  /** Default 'all': every layer under `moving`, plus all paper attached to it on that side. */
  layers?: LayerSelector;
  /** Degrees, 0 < angle <= 180. Default 180 (folded flat). Less than 180 leaves the paper in 3D. */
  angle?: number;
}

export interface ReverseFoldAction {
  type: 'reverseFold';
  line: [Vec2, Vec2];
  moving: Vec2;
  /** inside: the tip is pushed in between the flap's layers. outside: it wraps around them. */
  mode: 'inside' | 'outside';
  layers?: LayerSelector;
}

export type CreaseFold = 'valley' | 'mountain' | 'flat' | 'auto';

export interface CollapseCrease {
  /** Segment on the unfolded sheet. */
  from: Vec2;
  to: Vec2;
  /**
   * Target state of every crease on this segment: valley / mountain (folded flat, seen from the
   * front of the paper), flat (unfolded), or auto (folded flat, direction chosen by the engine).
   */
  fold: CreaseFold;
  /** Optional exact fold angle in degrees (positive valley). Overrides `fold`; leaves the paper in 3D. */
  angle?: number;
}

export interface CollapseAction {
  type: 'collapse';
  creases: CollapseCrease[];
  /** A point on the unfolded sheet whose face stays where it is. Optional. */
  fixed?: Vec2;
}

export interface UnfoldAction {
  /** Undo the previous fold, reverse fold or collapse. Its creases stay as crease lines. */
  type: 'unfold';
}

export interface TurnOverAction {
  type: 'turnOver';
  /** vertical (default): flip left to right like a page. horizontal: flip top to bottom. */
  axis?: 'vertical' | 'horizontal';
}

export interface RotateAction {
  type: 'rotate';
  /** Counter-clockwise, in the table plane. */
  degrees: number;
}

export type DesignAction =
  | FoldAction
  | ReverseFoldAction
  | CollapseAction
  | UnfoldAction
  | TurnOverAction
  | RotateAction;

export interface DesignStep {
  caption: string;
  hint?: string;
  action: DesignAction;
}

export interface DesignMeta {
  id: string;
  title: string;
  author?: string;
  description?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  tags?: string[];
}

export interface DesignPaper {
  width: number;
  height: number;
  /** CSS colours for the two sides. */
  front?: string;
  back?: string;
}

export interface OrigamiDesign {
  format: typeof DESIGN_FORMAT;
  version: typeof DESIGN_VERSION;
  meta: DesignMeta;
  paper: DesignPaper;
  steps: DesignStep[];
}

/** Limits that keep uploaded files from exhausting the engine. */
export const DESIGN_LIMITS = {
  maxSteps: 400,
  maxCollapseCreases: 200,
  maxTextLength: 2000,
};

export class DesignError extends Error {
  /** JSON path of the offending field, e.g. `steps[3].action.line`. */
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'DesignError';
    this.path = path;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec2 = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

function fail(path: string, message: string): never {
  throw new DesignError(path, message);
}

function text(v: unknown, path: string, required: boolean): string | undefined {
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || (required && v.trim() === '')) fail(path, 'must be a non-empty string');
  if (v.length > DESIGN_LIMITS.maxTextLength) fail(path, `must be at most ${DESIGN_LIMITS.maxTextLength} characters`);
  return v;
}

function vec(v: unknown, path: string): Vec2 {
  if (!isVec2(v)) fail(path, 'must be an [x, y] pair of numbers');
  return [v[0], v[1]];
}

function line(v: unknown, path: string): [Vec2, Vec2] {
  if (!Array.isArray(v) || v.length !== 2) fail(path, 'must be two points [[x1, y1], [x2, y2]]');
  const a = vec(v[0], `${path}[0]`);
  const b = vec(v[1], `${path}[1]`);
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) fail(path, 'the two points must be different');
  return [a, b];
}

function layers(v: unknown, path: string): LayerSelector | undefined {
  if (v === undefined) return undefined;
  if (v === 'all' || v === 'top' || v === 'bottom') return v;
  if (isNum(v) && Number.isInteger(v) && v >= 1) return v;
  fail(path, 'must be "all", "top", "bottom" or a positive integer');
}

function parseAction(raw: unknown, at: string): DesignAction {
  if (!isObj(raw)) fail(at, 'must be an object');
  switch (raw.type) {
    case 'fold': {
      if (raw.direction !== 'valley' && raw.direction !== 'mountain') fail(`${at}.direction`, 'must be "valley" or "mountain"');
      let angle: number | undefined;
      if (raw.angle !== undefined) {
        if (!isNum(raw.angle) || raw.angle <= 0 || raw.angle > 180) fail(`${at}.angle`, 'must be a number in (0, 180]');
        angle = raw.angle;
      }
      const l = layers(raw.layers, `${at}.layers`);
      return {
        type: 'fold',
        line: line(raw.line, `${at}.line`),
        moving: vec(raw.moving, `${at}.moving`),
        direction: raw.direction,
        ...(l !== undefined ? { layers: l } : {}),
        ...(angle !== undefined ? { angle } : {}),
      };
    }
    case 'reverseFold': {
      if (raw.mode !== 'inside' && raw.mode !== 'outside') fail(`${at}.mode`, 'must be "inside" or "outside"');
      const l = layers(raw.layers, `${at}.layers`);
      return {
        type: 'reverseFold',
        line: line(raw.line, `${at}.line`),
        moving: vec(raw.moving, `${at}.moving`),
        mode: raw.mode,
        ...(l !== undefined ? { layers: l } : {}),
      };
    }
    case 'collapse': {
      if (!Array.isArray(raw.creases) || raw.creases.length === 0) fail(`${at}.creases`, 'must be a non-empty array');
      if (raw.creases.length > DESIGN_LIMITS.maxCollapseCreases) {
        fail(`${at}.creases`, `must have at most ${DESIGN_LIMITS.maxCollapseCreases} entries`);
      }
      const creases = raw.creases.map((c, i): CollapseCrease => {
        const cp = `${at}.creases[${i}]`;
        if (!isObj(c)) fail(cp, 'must be an object');
        const [from, to] = line([c.from, c.to], cp);
        if (c.fold !== 'valley' && c.fold !== 'mountain' && c.fold !== 'flat' && c.fold !== 'auto') {
          fail(`${cp}.fold`, 'must be "valley", "mountain", "flat" or "auto"');
        }
        if (c.angle !== undefined && (!isNum(c.angle) || Math.abs(c.angle) > 180)) {
          fail(`${cp}.angle`, 'must be a number in [-180, 180]');
        }
        return { from, to, fold: c.fold, ...(c.angle !== undefined ? { angle: c.angle as number } : {}) };
      });
      return {
        type: 'collapse',
        creases,
        ...(raw.fixed !== undefined ? { fixed: vec(raw.fixed, `${at}.fixed`) } : {}),
      };
    }
    case 'unfold':
      return { type: 'unfold' };
    case 'turnOver': {
      if (raw.axis !== undefined && raw.axis !== 'vertical' && raw.axis !== 'horizontal') {
        fail(`${at}.axis`, 'must be "vertical" or "horizontal"');
      }
      return { type: 'turnOver', ...(raw.axis ? { axis: raw.axis } : {}) };
    }
    case 'rotate': {
      if (!isNum(raw.degrees)) fail(`${at}.degrees`, 'must be a number');
      return { type: 'rotate', degrees: raw.degrees };
    }
    default:
      fail(`${at}.type`, 'must be one of fold, reverseFold, collapse, unfold, turnOver, rotate');
  }
}

/**
 * Validate untrusted JSON (an upload, the database, the editor) and return a typed design.
 * Throws DesignError naming the first bad field.
 */
export function parseDesign(input: unknown): OrigamiDesign {
  if (!isObj(input)) fail('design', 'must be a JSON object');
  if (input.format !== DESIGN_FORMAT) fail('format', `must be "${DESIGN_FORMAT}"`);
  if (input.version !== DESIGN_VERSION) fail('version', `must be ${DESIGN_VERSION}`);

  const m = input.meta;
  if (!isObj(m)) fail('meta', 'must be an object');
  const difficulty = m.difficulty;
  if (
    difficulty !== undefined &&
    difficulty !== 'beginner' && difficulty !== 'intermediate' && difficulty !== 'advanced' && difficulty !== 'expert'
  ) {
    fail('meta.difficulty', 'must be beginner, intermediate, advanced or expert');
  }
  if (m.tags !== undefined && (!Array.isArray(m.tags) || !m.tags.every((t) => typeof t === 'string'))) {
    fail('meta.tags', 'must be an array of strings');
  }
  const meta: DesignMeta = {
    id: text(m.id, 'meta.id', true)!,
    title: text(m.title, 'meta.title', true)!,
    ...(m.author !== undefined ? { author: text(m.author, 'meta.author', false) } : {}),
    ...(m.description !== undefined ? { description: text(m.description, 'meta.description', false) } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(m.tags ? { tags: [...(m.tags as string[])] } : {}),
  };

  const p = input.paper;
  if (!isObj(p)) fail('paper', 'must be an object');
  if (!isNum(p.width) || p.width <= 0) fail('paper.width', 'must be a positive number');
  if (!isNum(p.height) || p.height <= 0) fail('paper.height', 'must be a positive number');
  const ratio = p.width / p.height;
  if (ratio > 100 || ratio < 0.01) fail('paper', 'aspect ratio must be between 1:100 and 100:1');
  const paper: DesignPaper = {
    width: p.width,
    height: p.height,
    ...(p.front !== undefined ? { front: text(p.front, 'paper.front', false) } : {}),
    ...(p.back !== undefined ? { back: text(p.back, 'paper.back', false) } : {}),
  };

  if (!Array.isArray(input.steps)) fail('steps', 'must be an array');
  if (input.steps.length > DESIGN_LIMITS.maxSteps) fail('steps', `must have at most ${DESIGN_LIMITS.maxSteps} steps`);
  const steps = input.steps.map((s, i): DesignStep => {
    const at = `steps[${i}]`;
    if (!isObj(s)) fail(at, 'must be an object');
    return {
      caption: text(s.caption, `${at}.caption`, true)!,
      ...(s.hint !== undefined ? { hint: text(s.hint, `${at}.hint`, false) } : {}),
      action: parseAction(s.action, `${at}.action`),
    };
  });

  return { format: DESIGN_FORMAT, version: DESIGN_VERSION, meta, paper, steps };
}

/** Plain JSON for saving / uploading. */
export function serializeDesign(design: OrigamiDesign): string {
  return JSON.stringify(design, null, 2);
}
