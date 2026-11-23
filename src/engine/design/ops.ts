/**
 * Step operations. Each takes the state after the previous step and returns a StepRecord:
 * the topology used while animating this step (with any new cuts), the state before and after,
 * and how to animate between them.
 */

import {
  EPS,
  cross2,
  dot2,
  faceSign,
  isFlatTransform,
  len2,
  mat4Apply2,
  mat4Mul,
  mat4RotateAboutLine,
  normalize2,
  sub2,
  type Mat4,
  type Vec2,
  type Vec3,
} from './math';
import { centroid, clipConvex, containsStrict, overlapArea, segmentInside, splitConvex } from './polygon';
import {
  buildTopology,
  buildTree,
  faceIndex,
  inheritAngles,
  isFlatAngle,
  lookupAbove,
  pairKey,
  resolveAncestor,
  snapAngle,
  solveTransforms,
  tearError,
  worldPolygon,
  type Face,
  type PaperState,
  type Topology,
} from './state';
import { solveLayers, type FoldedCrease } from './layers';
import type {
  CollapseAction,
  DesignAction,
  FoldAction,
  LayerSelector,
  ReverseFoldAction,
  RotateAction,
  TurnOverAction,
} from './format';

export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepError';
  }
}

export interface RootMotion {
  point: Vec3;
  axis: Vec3;
  angle: number;
}

export interface StepRecord {
  action: DesignAction['type'];
  /** Topology for the whole step (cuts made at its start). */
  topo: Topology;
  before: PaperState;
  after: PaperState;
  /** Face that drives the forward kinematics while animating. */
  root: number;
  /** Rigid motion of the root face (turn over / rotate). */
  rootMotion: RootMotion | null;
  /** Faces whose transform changes in this step. */
  moving: boolean[];
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// helpers

/** Same state, re-expressed on a topology with extra cuts (pieces inherit everything). */
function refine(old: PaperState, faces: Face[]): PaperState {
  const topo = buildTopology(faces);
  const idx = faceIndex(old.topo);
  const parents = faces.map((f) => resolveAncestor(idx, f.id));
  if (parents.some((p) => p < 0)) throw new StepError('internal: lost track of a face');
  return {
    topo,
    angles: inheritAngles(topo, old),
    transforms: parents.map((p) => old.transforms[p]),
    ranks: parents.map((p) => old.ranks[p]),
    above: old.above,
    flat: old.flat,
  };
}

/** Cut the chosen faces along a world line (signed distance via each face's transform). */
function cutByWorldLine(state: PaperState, which: Set<number>, P: Vec2, D: Vec2): Face[] {
  const out: Face[] = [];
  state.topo.faces.forEach((f, i) => {
    if (!which.has(i) || !isFlatTransform(state.transforms[i])) { out.push(f); return; }
    const m = state.transforms[i];
    const dist = f.poly.map((p) => cross2(D, sub2(mat4Apply2(m, p), P)));
    const s = splitConvex(f.poly, dist);
    if (!s) { out.push(f); return; }
    out.push({ id: `${f.id}.0`, poly: s.left }, { id: `${f.id}.1`, poly: s.right });
  });
  return out;
}

/** +1 / -1 when the whole face is on one side of the world line, 0 if it straddles or lies on it. */
function worldSide(state: PaperState, i: number, P: Vec2, D: Vec2): number {
  let lo = Infinity;
  let hi = -Infinity;
  const m = state.transforms[i];
  for (const p of state.topo.faces[i].poly) {
    const d = cross2(D, sub2(mat4Apply2(m, p), P));
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  if (lo >= -10 * EPS && hi > 10 * EPS) return 1;
  if (hi <= 10 * EPS && lo < -10 * EPS) return -1;
  return 0;
}

function onLine(state: PaperState, i: number, a: Vec2, b: Vec2, P: Vec2, D: Vec2): boolean {
  const m = state.transforms[i];
  const wa = mat4Apply2(m, a);
  const wb = mat4Apply2(m, b);
  return Math.abs(cross2(D, sub2(wa, P))) < 10 * EPS && Math.abs(cross2(D, sub2(wb, P))) < 10 * EPS;
}

function pickLayers(state: PaperState, candidates: number[], at: Vec2, sel: LayerSelector): number[] {
  const under = candidates.filter((i) => containsStrict(worldPolygon(state, i), at, 1e-6));
  if (under.length === 0) throw new StepError('there is no paper under the "moving" point');
  under.sort((a, b) => state.ranks[b] - state.ranks[a]);
  if (sel === 'all') return under;
  if (sel === 'top') return under.slice(0, 1);
  if (sel === 'bottom') return under.slice(-1);
  if (sel > under.length) throw new StepError(`asked for ${sel} layers but only ${under.length} are under the point`);
  return under.slice(0, sel);
}

/** Paper attached to the seeds on the moving side, without crossing the fold line. */
function floodFlap(state: PaperState, seeds: number[], side: Set<number>, P: Vec2, D: Vec2): Set<number> {
  const flap = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const f = queue.pop()!;
    for (const k of state.topo.faceCreases[f]) {
      const c = state.topo.creases[k];
      const g = c.a === f ? c.b : c.a;
      if (flap.has(g) || !side.has(g)) continue;
      if (onLine(state, f, c.p0, c.p1, P, D)) continue;
      flap.add(g);
      queue.push(g);
    }
  }
  return flap;
}

function largestFace(state: PaperState, among: number[]): number {
  let best = among[0];
  let bestA = -1;
  for (const i of among) {
    const p = state.topo.faces[i].poly;
    let a = 0;
    for (let k = 0; k < p.length; k++) {
      const q = p[(k + 1) % p.length];
      a += p[k][0] * q[1] - q[0] * p[k][1];
    }
    if (a > bestA) { bestA = a; best = i; }
  }
  return best;
}

function foldedCreases(state: PaperState, autoSign: Set<number> = new Set()): FoldedCrease[] {
  const out: FoldedCrease[] = [];
  state.topo.creases.forEach((c, k) => {
    const a = state.angles[k];
    if (Math.abs(Math.abs(a) - Math.PI) > 1e-6) return;
    const m = state.transforms[c.a];
    out.push({
      a: c.a,
      b: c.b,
      sign: autoSign.has(k) ? 0 : Math.sign(a),
      p0: mat4Apply2(m, c.p0),
      p1: mat4Apply2(m, c.p1),
    });
  });
  return out;
}

/**
 * Solve the layer order of a flat state. `known` / `prefer` work on face indices of `state`.
 * Fills in ranks + above (and the sign of 'auto' creases).
 */
function orderLayers(
  state: PaperState,
  known: (i: number, j: number) => boolean | undefined,
  prefer: (i: number, j: number) => boolean | undefined,
  autoSign: Set<number> = new Set(),
): { ranks: number[]; above: Map<string, boolean>; warnings: string[] } {
  const n = state.topo.faces.length;
  const polys = state.topo.faces.map((_, i) => worldPolygon(state, i));
  const signs = state.transforms.map(faceSign);
  const joints = state.topo.creases
    .map((c, k) => ({ c, k }))
    .filter(({ k }) => Math.abs(state.angles[k]) < 1e-6)
    .map(({ c }) => ({ a: c.a, b: c.b, p0: mat4Apply2(state.transforms[c.a], c.p0), p1: mat4Apply2(state.transforms[c.a], c.p1) }));
  const res = solveLayers({ polys, signs, folded: foldedCreases(state, autoSign), joints, known, prefer });
  if (!res.ok) {
    throw new StepError(
      'the paper cannot lie this way without passing through itself (no valid layer order). ' +
        'Check which layers move and the valley/mountain directions.',
    );
  }
  const above = new Map<string, boolean>();
  const ids = state.topo.faces.map((f) => f.id);
  res.above.forEach((v, key) => {
    const i = Math.floor(key / n);
    const j = key % n;
    above.set(pairKey(ids[i], ids[j]), ids[i] < ids[j] ? v : !v);
  });
  // choose directions for 'auto' creases from the solved order
  autoSign.forEach((k) => {
    const c = state.topo.creases[k];
    const i = Math.min(c.a, c.b);
    const j = Math.max(c.a, c.b);
    const v = res.above.get(i * n + j);
    if (v === undefined) return;
    const bAbove = c.b === i ? v : !v;
    state.angles[k] = (bAbove ? 1 : -1) * signs[c.a] * Math.PI;
  });
  const warnings = res.cyclic ? ['layer order has a cycle; stacking heights are approximate'] : [];
  return { ranks: res.ranks, above, warnings };
}

function sameTransform(a: Mat4, b: Mat4): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-7) return false;
  return true;
}

function relativeUnchanged(b0: Mat4, b1: Mat4, a0: Mat4, a1: Mat4): boolean {
  // (a0^-1 b0) == (a1^-1 b1)  <=>  b1 == a1 a0^-1 b0 ; cheap check on the 2D part
  const inv = (m: Mat4): Mat4 => {
    const tx = m[12], ty = m[13], tz = m[14];
    return [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0,
      -(m[0] * tx + m[1] * ty + m[2] * tz), -(m[4] * tx + m[5] * ty + m[6] * tz), -(m[8] * tx + m[9] * ty + m[10] * tz), 1];
  };
  return sameTransform(mat4Mul(mat4Mul(a1, inv(a0)), b0), b1);
}

function finish(
  action: DesignAction['type'],
  before: PaperState,
  after: PaperState,
  root: number,
  rootMotion: RootMotion | null,
  warnings: string[],
): StepRecord {
  const moving = before.transforms.map((m, i) => !sameTransform(m, after.transforms[i]));
  return { action, topo: before.topo, before, after, root, rootMotion, moving, warnings };
}

function requireFlat(state: PaperState, what: string) {
  if (!state.flat) throw new StepError(`${what} needs the paper to be lying flat; the previous step left it in 3D`);
}

/** Distance within which author coordinates snap to an existing vertex (internal units). */
export const SNAP_DIST = 2e-4;
/** A vertex this close to a fold line is taken to be on it. */
export const LINE_SNAP_DIST = 5e-5;

/** Snap a current-view point to the nearest vertex of the folded paper, if one is very close. */
export function snapToWorldVertex(state: PaperState, p: Vec2): Vec2 {
  let best: Vec2 = p;
  let bestD = SNAP_DIST;
  state.topo.faces.forEach((f, i) => {
    for (const q of f.poly) {
      const w = mat4Apply2(state.transforms[i], q);
      const d = Math.hypot(w[0] - p[0], w[1] - p[1]);
      if (d < bestD) { bestD = d; best = w; }
    }
  });
  return best;
}

/** Snap a crease-pattern point to the nearest paper vertex, if one is very close. */
export function snapToPaperVertex(topo: Topology, p: Vec2): Vec2 {
  let best: Vec2 = p;
  let bestD = SNAP_DIST;
  for (const f of topo.faces) {
    for (const q of f.poly) {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bestD) { bestD = d; best = q; }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// fold / reverse fold

interface FlapSelection {
  before: PaperState;
  flap: Set<number>;
  fixed: number[];
  P: Vec2;
  D: Vec2;
  sideSign: number;
}

/** Vertices of flat-lying paper, in current-view coordinates (deduplicated). */
function worldVertices(state: PaperState): Vec2[] {
  const out: Vec2[] = [];
  const seen = new Set<string>();
  state.topo.faces.forEach((f, i) => {
    if (!isFlatTransform(state.transforms[i])) return;
    for (const q of f.poly) {
      const w = mat4Apply2(state.transforms[i], q);
      const key = `${Math.round(w[0] * 1e6)},${Math.round(w[1] * 1e6)}`;
      if (!seen.has(key)) { seen.add(key); out.push(w); }
    }
  });
  return out;
}

/**
 * Make a typed-in fold line exact: endpoints snap to nearby vertices, and if the line passes
 * within a hair of existing vertices it is moved to pass exactly through them (authors mean
 * "fold so this corner lands on that edge", not "miss it by 0.00001").
 */
export function snapFoldLine(state: PaperState, raw: [Vec2, Vec2]): [Vec2, Vec2] {
  const verts = worldVertices(state);
  const snap = (p: Vec2): { p: Vec2; hit: boolean } => {
    let best: Vec2 = p;
    let bestD = SNAP_DIST;
    for (const v of verts) {
      const d = Math.hypot(v[0] - p[0], v[1] - p[1]);
      if (d < bestD) { bestD = d; best = v; }
    }
    return { p: best, hit: best !== p };
  };
  const a = snap(raw[0]);
  const b = snap(raw[1]);
  let p0 = a.p;
  let p1 = b.p;
  if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-6) return [p0, p1];
  const D = normalize2(sub2(p1, p0));
  const near = verts
    .map((v) => ({ v, d: Math.abs(cross2(D, sub2(v, p0))) }))
    .filter(({ d }) => d < LINE_SNAP_DIST && d > 1e-12);
  if (near.length === 0) return [p0, p1];
  const far = (v: Vec2, from: Vec2) => Math.hypot(v[0] - from[0], v[1] - from[1]) > 1e-3;
  if (a.hit || b.hit) {
    const anchor = a.hit ? p0 : p1;
    const cand = near.filter(({ v }) => far(v, anchor)).sort((x, y) => x.d - y.d)[0];
    if (cand) return a.hit ? [anchor, cand.v] : [cand.v, anchor];
    return [p0, p1];
  }
  // no anchor: pass through the two vertices that are farthest apart, or shift through one
  if (near.length >= 2) {
    let best: [Vec2, Vec2] | null = null;
    let bestL = 1e-3;
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const l = Math.hypot(near[i].v[0] - near[j].v[0], near[i].v[1] - near[j].v[1]);
        if (l > bestL) { bestL = l; best = [near[i].v, near[j].v]; }
      }
    }
    if (best) return dot2(sub2(best[1], best[0]), D) >= 0 ? best : [best[1], best[0]];
  }
  const v = near.sort((x, y) => x.d - y.d)[0].v;
  return [v, [v[0] + D[0], v[1] + D[1]]];
}

function selectFlap(state: PaperState, rawLine: [Vec2, Vec2], moving: Vec2, layers: LayerSelector): FlapSelection {
  const line = snapFoldLine(state, rawLine);
  if (Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]) < 1e-6) throw new StepError('the fold line is too short');
  const P = line[0];
  const D = normalize2(sub2(line[1], line[0]));
  const sideSign = Math.sign(cross2(D, sub2(moving, P)));
  if (Math.abs(cross2(D, sub2(moving, P))) < 1e-6) throw new StepError('the "moving" point lies on the fold line');

  const run = (s: PaperState, all: boolean) => {
    // Only paper lying flat on the table takes part; flaps already lifted into 3D are left alone.
    const side = new Set<number>();
    s.topo.faces.forEach((_, i) => {
      if (isFlatTransform(s.transforms[i]) && worldSide(s, i, P, D) === sideSign) side.add(i);
    });
    const seeds = pickLayers(s, [...side], moving, layers);
    return floodFlap(s, seeds, side, P, D);
  };

  // Pass 1: cut everything, find the flap, then only keep cuts that the flap needs.
  const everything = new Set(state.topo.faces.map((_, i) => i));
  const trial = refine(state, cutByWorldLine(state, everything, P, D));
  const trialFlap = run(trial, true);
  const needCut = new Set<number>();
  const idx = faceIndex(state.topo);
  trialFlap.forEach((i) => {
    const id = trial.topo.faces[i].id;
    if (!idx.has(id)) needCut.add(resolveAncestor(idx, id));
  });
  const before = needCut.size ? refine(state, cutByWorldLine(state, needCut, P, D)) : refine(state, state.topo.faces);
  const flap = run(before, true);
  if (flap.size === 0) throw new StepError('nothing would move');
  const fixed = before.topo.faces.map((_, i) => i).filter((i) => !flap.has(i));
  if (fixed.length === 0) throw new StepError('every face would move; there is nothing to fold against (use turnOver or rotate)');
  return { before, flap, fixed, P, D, sideSign };
}

function hingeCreases(s: PaperState, flap: Set<number>): number[] {
  const out: number[] = [];
  s.topo.creases.forEach((c, k) => { if (flap.has(c.a) !== flap.has(c.b)) out.push(k); });
  return out;
}

export function applyFold(state: PaperState, action: FoldAction): StepRecord {
  const sel = selectFlap(state, action.line, action.moving, action.layers ?? 'all');
  const { before, flap, fixed } = sel;
  const valley = action.direction === 'valley';
  const theta = ((action.angle ?? 180) * Math.PI) / 180;
  const flatFold = Math.abs(theta - Math.PI) < 1e-9;
  const warnings: string[] = [];

  // Blocking: a layer that is not folding but covers the flap (valley) or lies under it (mountain).
  // Layers that straddle the fold line count too: they were simply not cut.
  const polys = before.topo.faces.map((_, i) => worldPolygon(before, i));
  for (const m of flap) {
    for (const g of fixed) {
      if (!isFlatTransform(before.transforms[g])) continue;
      if (overlapArea(polys[m], polys[g]) < 1e-8) continue;
      const gAbove = lookupAbove(before.above, before.topo.faces[g].id, before.topo.faces[m].id);
      if (gAbove === undefined) continue;
      if (valley ? gAbove : !gAbove) {
        const ov = centroid(clipConvex(polys[m], polys[g]));
        throw new StepError(
          `the flap is ${valley ? 'covered by' : 'resting on'} a layer that is not folding with it ` +
            `(near ${ov[0].toFixed(3)}, ${ov[1].toFixed(3)}). ` +
            `Fold more layers ("layers": "all" or a larger number) or fold the ${valley ? 'covering' : 'lower'} layer first.`,
        );
      }
    }
  }

  // New crease angles on the hinge.
  const angles = before.angles.slice();
  for (const k of hingeCreases(before, flap)) {
    const c = before.topo.creases[k];
    const f = flap.has(c.a) ? c.b : c.a;
    const sF = faceSign(before.transforms[f]);
    // +1 when the fixed face lies on the far side of the line (the usual case); -1 when it is
    // tucked under the flap on the moving side, joined to it along the fold line.
    const fc = centroid(worldPolygon(before, f));
    const sigma = Math.sign(cross2(sel.D, sub2(fc, sel.P))) === sel.sideSign ? -1 : 1;
    const next = angles[k] + (valley ? 1 : -1) * sigma * sF * theta;
    if (Math.abs(next) > Math.PI + 1e-6) {
      const m = before.transforms[f];
      const mid = mat4Apply2(m, [(c.p0[0] + c.p1[0]) / 2, (c.p0[1] + c.p1[1]) / 2]);
      throw new StepError(
        `the paper is already folded the other way along this line near (${mid[0].toFixed(3)}, ${mid[1].toFixed(3)}), ` +
          'so it would pass through itself',
      );
    }
    angles[k] = snapAngle(next);
  }

  const root = largestFace(before, fixed);
  const tree = buildTree(before.topo, root);
  const transforms = solveTransforms(tree, angles, before.transforms[root]);
  const tear = tearError(before.topo, transforms, angles);
  if (tear.error > 1e-6) {
    const c = before.topo.creases[tear.crease];
    const mid = mat4Apply2(before.transforms[c.a], [(c.p0[0] + c.p1[0]) / 2, (c.p0[1] + c.p1[1]) / 2]);
    throw new StepError(
      `this fold would tear the paper near (${mid[0].toFixed(3)}, ${mid[1].toFixed(3)}): the flap is attached there to paper that does not move`,

    );
  }

  const after: PaperState = {
    topo: before.topo,
    angles,
    transforms,
    ranks: before.ranks.slice(),
    above: before.above,
    flat: flatFold && before.flat,
  };

  if (after.flat) {
    const ids = before.topo.faces.map((f) => f.id);
    const known = (i: number, j: number) => {
      const iIn = flap.has(i);
      if (iIn !== flap.has(j)) return undefined;
      const prev = lookupAbove(before.above, ids[i], ids[j]);
      if (prev === undefined) return undefined;
      return iIn ? !prev : prev; // the flap turned over as a rigid body
    };
    const prefer = (i: number, j: number) => {
      const iIn = flap.has(i);
      if (iIn === flap.has(j)) return undefined;
      return iIn === valley;
    };
    const o = orderLayers(after, known, prefer);
    after.ranks = o.ranks;
    after.above = o.above;
    warnings.push(...o.warnings);
  }
  return finish('fold', before, after, root, null, warnings);
}

export function applyReverseFold(state: PaperState, action: ReverseFoldAction): StepRecord {
  requireFlat(state, 'a reverse fold');
  const sel = selectFlap(state, action.line, action.moving, action.layers ?? 'all');
  const { before, flap, fixed } = sel;
  const inside = action.mode === 'inside';
  const ids = before.topo.faces.map((f) => f.id);

  const hinges = hingeCreases(before, flap);
  const hingeFixed = [...new Set(hinges.map((k) => {
    const c = before.topo.creases[k];
    return flap.has(c.a) ? c.b : c.a;
  }))].sort((a, b) => before.ranks[a] - before.ranks[b]);
  if (hingeFixed.length < 2) throw new StepError('a reverse fold needs a flap with at least two layers at the fold line');
  const ranksAtLine = hingeFixed.map((i) => before.ranks[i]);
  const median = (ranksAtLine[0] + ranksAtLine[ranksAtLine.length - 1]) / 2;
  if (hingeFixed.some((i) => Math.abs(before.ranks[i] - median) < 1e-9)) {
    throw new StepError('a reverse fold needs the flap\'s layers to split evenly into a front half and a back half');
  }
  const upper = (i: number) => before.ranks[i] > median;

  const angles = before.angles.slice();
  // hinge creases: the tip of each layer folds toward the middle (inside) or away from it (outside)
  for (const k of hinges) {
    const c = before.topo.creases[k];
    const f = flap.has(c.a) ? c.b : c.a;
    const sF = faceSign(before.transforms[f]);
    const tipAbove = inside ? !upper(f) : upper(f);
    angles[k] = (tipAbove ? 1 : -1) * sF * Math.PI;
  }
  // Creases inside the tip: between the two halves the tip is mirrored (order kept, so the fold
  // direction flips); within one half the layers turn over together (order reversed, direction kept).
  before.topo.creases.forEach((c, k) => {
    if (flap.has(c.a) && flap.has(c.b) && upper(c.a) !== upper(c.b)) angles[k] = -angles[k];
  });

  const root = largestFace(before, fixed);
  const tree = buildTree(before.topo, root);
  const transforms = solveTransforms(tree, angles, before.transforms[root]);
  const tear = tearError(before.topo, transforms, angles);
  if (tear.error > 1e-6) throw new StepError('this reverse fold would tear the paper; check the fold line and the flap');

  const after: PaperState = { topo: before.topo, angles, transforms, ranks: before.ranks.slice(), above: before.above, flat: true };
  const known = (i: number, j: number) => {
    const iIn = flap.has(i);
    if (iIn !== flap.has(j)) return undefined;
    const prev = lookupAbove(before.above, ids[i], ids[j]);
    if (prev === undefined || !iIn) return prev; // fixed part unchanged
    return upper(i) === upper(j) ? !prev : prev;
  };
  // Which side of the flap every other layer is on: walk the "is above" relation up from the
  // flap's front half and down from its back half (stacking heights from different regions are
  // not comparable, the relation is).
  const n = before.topo.faces.length;
  const upAdj: number[][] = Array.from({ length: n }, () => []);
  const downAdj: number[][] = Array.from({ length: n }, () => []);
  const polysB = before.topo.faces.map((_, i) => worldPolygon(before, i));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = lookupAbove(before.above, ids[i], ids[j]);
      if (v === undefined || overlapArea(polysB[i], polysB[j]) < 1e-8) continue;
      const hi = v ? i : j;
      const lo = v ? j : i;
      upAdj[lo].push(hi);
      downAdj[hi].push(lo);
    }
  }
  const reach = (starts: number[], adj: number[][]) => {
    const seen = new Set<number>(starts);
    const q = [...starts];
    while (q.length) for (const g of adj[q.pop()!]) if (!seen.has(g)) { seen.add(g); q.push(g); }
    return seen;
  };
  const frontSet = reach(hingeFixed.filter(upper), upAdj);
  const backSet = reach(hingeFixed.filter((i) => !upper(i)), downAdj);
  const prefer = (i: number, j: number) => {
    const iIn = flap.has(i);
    if (iIn === flap.has(j)) return undefined;
    const m = iIn ? i : j;
    const g = iIn ? j : i;
    const front = frontSet.has(g) && !backSet.has(g);
    const back = backSet.has(g) && !frontSet.has(g);
    let mAbove: boolean;
    if (inside) {
      // the tip ends up between the front and back halves
      if (front) mAbove = false;
      else if (back) mAbove = true;
      else mAbove = !upper(m);
    } else {
      // the tip wraps around the outside of its own half
      mAbove = upper(m);
    }
    return iIn ? mAbove : !mAbove;
  };
  const o = orderLayers(after, known, prefer);
  after.ranks = o.ranks;
  after.above = o.above;
  return finish('reverseFold', before, after, root, null, o.warnings);
}

// ---------------------------------------------------------------------------------------------
// collapse (crease-pattern coordinates)

export function applyCollapse(state: PaperState, action: CollapseAction, scale: number): StepRecord {
  const segs = action.creases.map((c) => ({
    from: snapToPaperVertex(state.topo, [c.from[0] * scale, c.from[1] * scale]),
    to: snapToPaperVertex(state.topo, [c.to[0] * scale, c.to[1] * scale]),
    fold: c.fold,
    angle: c.angle,
  }));

  // Cut faces that a crease segment crosses.
  let faces = state.topo.faces;
  for (const s of segs) {
    const D = normalize2(sub2(s.to, s.from));
    const L = len2(sub2(s.to, s.from));
    const next: Face[] = [];
    for (const f of faces) {
      const r = segmentInside(f.poly, s.from, s.to, 10 * EPS);
      if (!r || (r[1] - r[0]) * L < 10 * EPS) { next.push(f); continue; }
      // the segment must run edge to edge across the face
      const dist = f.poly.map((p) => cross2(D, sub2(p, s.from)));
      const cut = splitConvex(f.poly, dist);
      if (!cut) { next.push(f); continue; }
      const enters = r[0] > 1e-9;
      const exits = r[1] < 1 - 1e-9;
      if (!enters || !exits) {
        // an end of the segment is inside this face: only allowed if the line beyond it misses the face
        const ext = segmentInside(f.poly, [s.from[0] - D[0] * 10, s.from[1] - D[1] * 10], [s.to[0] + D[0] * 10, s.to[1] + D[1] * 10], 10 * EPS);
        if (ext && Math.abs((ext[1] - ext[0]) * (L + 20) - (r[1] - r[0]) * L) > 1e-6) {
          throw new StepError(
            `the crease from (${(s.from[0] / scale).toFixed(3)}, ${(s.from[1] / scale).toFixed(3)}) to ` +
              `(${(s.to[0] / scale).toFixed(3)}, ${(s.to[1] / scale).toFixed(3)}) stops in the middle of the paper; ` +
              'creases must run to an edge or to another crease',
          );
        }
      }
      next.push({ id: `${f.id}.0`, poly: cut.left }, { id: `${f.id}.1`, poly: cut.right });
    }
    faces = next;
  }
  const before = refine(state, faces);
  const topo = before.topo;

  // Target angles.
  const angles = before.angles.slice();
  const touched = new Set<number>();
  const autoSign = new Set<number>();
  topo.creases.forEach((c, k) => {
    for (const s of segs) {
      const D = normalize2(sub2(s.to, s.from));
      const L = len2(sub2(s.to, s.from));
      if (Math.abs(cross2(D, sub2(c.p0, s.from))) > 10 * EPS || Math.abs(cross2(D, sub2(c.p1, s.from))) > 10 * EPS) continue;
      const t0 = dot2(D, sub2(c.p0, s.from));
      const t1 = dot2(D, sub2(c.p1, s.from));
      if (Math.min(t0, t1) < -10 * EPS || Math.max(t0, t1) > L + 10 * EPS) continue;
      touched.add(k);
      if (s.angle !== undefined) angles[k] = (s.angle * Math.PI) / 180;
      else if (s.fold === 'flat') angles[k] = 0;
      else if (s.fold === 'valley') angles[k] = Math.PI;
      else if (s.fold === 'mountain') angles[k] = -Math.PI;
      else { angles[k] = Math.PI; autoSign.add(k); }
    }
  });
  if (touched.size === 0) throw new StepError('none of the creases lie on the paper');

  // Root: the face containing `fixed`, else the largest face not touching a changed crease.
  let root = -1;
  if (action.fixed) {
    const p: Vec2 = [action.fixed[0] * scale, action.fixed[1] * scale];
    root = topo.faces.findIndex((f) => containsStrict(f.poly, p, 1e-9));
    if (root < 0) throw new StepError('the "fixed" point is not inside a face (it may lie on a crease)');
  } else {
    const calm = topo.faces.map((_, i) => i).filter((i) => topo.faceCreases[i].every((k) => !touched.has(k) || Math.abs(angles[k] - before.angles[k]) < 1e-9));
    root = largestFace(before, calm.length ? calm : topo.faces.map((_, i) => i));
  }

  const tree = buildTree(topo, root);
  const transforms = solveTransforms(tree, angles, before.transforms[root]);
  const tear = tearError(topo, transforms, angles);
  if (tear.error > 1e-6) {
    const c = topo.creases[tear.crease];
    const mid: Vec2 = [((c.p0[0] + c.p1[0]) / 2) / scale, ((c.p0[1] + c.p1[1]) / 2) / scale];
    throw new StepError(
      `these creases do not fold together: the paper would tear near (${mid[0].toFixed(3)}, ${mid[1].toFixed(3)}) ` +
        'on the crease pattern. A crease is missing or one is folded that should be flat.',
    );
  }
  const flat = angles.every(isFlatAngle);
  const after: PaperState = { topo, angles, transforms, ranks: before.ranks.slice(), above: before.above, flat };
  const warnings: string[] = [];
  if (flat) {
    const ids = topo.faces.map((f) => f.id);
    const moved = transforms.map((m, i) => !sameTransform(m, before.transforms[i]));
    const known = (i: number, j: number) => {
      if (moved[i] || moved[j]) return undefined;
      return lookupAbove(before.above, ids[i], ids[j]);
    };
    const prefer = (i: number, j: number) => {
      if (before.flat && relativeUnchanged(before.transforms[j], transforms[j], before.transforms[i], transforms[i])) {
        const prev = lookupAbove(before.above, ids[i], ids[j]);
        if (prev !== undefined) {
          const flipped = faceSign(transforms[i]) !== faceSign(before.transforms[i]);
          return flipped ? !prev : prev;
        }
      }
      if (moved[i] !== moved[j]) return moved[i];
      return undefined;
    };
    const o = orderLayers(after, known, prefer, autoSign);
    after.ranks = o.ranks;
    after.above = o.above;
    warnings.push(...o.warnings);
  }
  return finish('collapse', before, after, root, null, warnings);
}

// ---------------------------------------------------------------------------------------------
// unfold, turn over, rotate

export function applyUnfold(state: PaperState, previous: StepRecord | undefined): StepRecord {
  if (!previous || (previous.action !== 'fold' && previous.action !== 'reverseFold' && previous.action !== 'collapse')) {
    throw new StepError('unfold must come right after a fold, reverse fold or collapse');
  }
  const before = state;
  const after: PaperState = {
    topo: state.topo,
    angles: previous.before.angles.slice(),
    transforms: previous.before.transforms.slice(),
    ranks: previous.before.ranks.slice(),
    above: previous.before.above,
    flat: previous.before.flat,
  };
  return finish('unfold', before, after, previous.root, null, []);
}

function modelCenter(state: PaperState): Vec2 {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.topo.faces.forEach((f, i) => {
    for (const p of f.poly) {
      const w = mat4Apply2(state.transforms[i], p);
      minX = Math.min(minX, w[0]); maxX = Math.max(maxX, w[0]);
      minY = Math.min(minY, w[1]); maxY = Math.max(maxY, w[1]);
    }
  });
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function rigidStep(state: PaperState, motion: RootMotion, action: 'turnOver' | 'rotate', reverseLayers: boolean): StepRecord {
  const R = mat4RotateAboutLine(motion.point, motion.axis, motion.angle);
  const transforms = state.transforms.map((m) => mat4Mul(R, m));
  const maxRank = Math.max(0, ...state.ranks);
  const above = new Map<string, boolean>();
  state.above.forEach((v, k) => above.set(k, reverseLayers ? !v : v));
  const after: PaperState = {
    topo: state.topo,
    angles: state.angles.slice(),
    transforms,
    ranks: reverseLayers ? state.ranks.map((r) => maxRank - r) : state.ranks.slice(),
    above,
    flat: state.flat,
  };
  if (reverseLayers && state.flat) {
    // ranks were per-stack heights; recompute compactly from the flipped order
    const ids = state.topo.faces.map((f) => f.id);
    const o = orderLayers(after, (i, j) => lookupAbove(above, ids[i], ids[j]), () => undefined);
    after.ranks = o.ranks;
  }
  return finish(action, state, after, largestFace(state, state.topo.faces.map((_, i) => i)), motion, []);
}

export function applyTurnOver(state: PaperState, action: TurnOverAction): StepRecord {
  const c = modelCenter(state);
  const axis: Vec3 = action.axis === 'horizontal' ? [1, 0, 0] : [0, 1, 0];
  return rigidStep(state, { point: [c[0], c[1], 0], axis, angle: Math.PI }, 'turnOver', true);
}

export function applyRotate(state: PaperState, action: RotateAction): StepRecord {
  const c = modelCenter(state);
  return rigidStep(state, { point: [c[0], c[1], 0], axis: [0, 0, 1], angle: (action.degrees * Math.PI) / 180 }, 'rotate', false);
}
