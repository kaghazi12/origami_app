/**
 * Paper state: the sheet as a set of convex faces joined by creases.
 *
 * - Faces live in paper space (the unfolded sheet). They only ever get cut by straight lines,
 *   so they stay convex.
 * - Every shared edge between two faces is a crease with a fold angle (radians, + valley as
 *   seen from the front of the paper, - mountain, 0 flat).
 * - Face transforms (paper -> world) follow from the crease angles by forward kinematics from
 *   one root face. Paper thickness is not part of the transforms; layer heights come from
 *   `ranks` when the state is flat.
 */

import {
  EPS,
  cross2,
  dot2,
  mat4Apply,
  mat4Apply2,
  mat4Mul,
  mat4RotateAboutLine,
  normalize2,
  sub2,
  type Mat4,
  type Vec2,
  type Vec3,
} from './math';
import { bboxOf, bboxPairs, centroid, ensureCCW } from './polygon';

export interface Face {
  /** Ancestry id: a cut of face `x` produces `x.0` and `x.1`. */
  id: string;
  /** Convex, counter-clockwise, paper coordinates. */
  poly: Vec2[];
}

export interface Crease {
  a: number;
  b: number;
  /** Shared segment in paper coordinates. */
  p0: Vec2;
  p1: Vec2;
}

export interface Topology {
  faces: Face[];
  creases: Crease[];
  /** Crease indices touching each face. */
  faceCreases: number[][];
}

export interface PaperState {
  topo: Topology;
  /** Per crease, radians. */
  angles: number[];
  /** Per face, paper -> world (zero thickness). */
  transforms: Mat4[];
  /** Per face stacking height (0 = lowest layer in its stack). */
  ranks: number[];
  /** Layer order of overlapping faces, keyed by pairKey(idA, idB): true = the first id is above. */
  above: Map<string, boolean>;
  /** All crease angles are 0 or +-180 and the paper lies in the table plane. */
  flat: boolean;
}

export const FLAT_TOL = 1e-6;

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Ancestry chain: "f.0.1" -> ["f.0.1", "f.0", "f"]. */
export function ancestry(id: string): string[] {
  const out = [id];
  let s = id;
  for (let k = s.lastIndexOf('.'); k > 0; k = s.lastIndexOf('.')) {
    s = s.slice(0, k);
    out.push(s);
  }
  return out;
}

/** Is `x` above `y` according to a pair map from an older topology (ids resolved through ancestry)? */
export function lookupAbove(above: Map<string, boolean>, x: string, y: string): boolean | undefined {
  const cx = ancestry(x);
  const cy = ancestry(y);
  for (const ax of cx) {
    for (const ay of cy) {
      if (ax === ay) return undefined;
      const v = above.get(pairKey(ax, ay));
      if (v !== undefined) return ax < ay ? v : !v;
    }
  }
  return undefined;
}

/** Find a face of an older state that `id` descends from (or is). */
export function resolveAncestor(index: Map<string, number>, id: string): number {
  for (const a of ancestry(id)) {
    const k = index.get(a);
    if (k !== undefined) return k;
  }
  return -1;
}

export function faceIndex(topo: Topology): Map<string, number> {
  const m = new Map<string, number>();
  topo.faces.forEach((f, i) => m.set(f.id, i));
  return m;
}

/** Compute the crease graph (shared edges) for a set of faces. */
export function buildTopology(faces: Face[]): Topology {
  const boxes = faces.map((f) => bboxOf(f.poly));
  const creases: Crease[] = [];
  for (const [i, j] of bboxPairs(boxes, 10 * EPS)) {
    const seg = sharedSegment(faces[i].poly, faces[j].poly);
    if (seg) creases.push({ a: i, b: j, p0: seg[0], p1: seg[1] });
  }
  creases.sort((x, y) => x.a - y.a || x.b - y.b);
  const faceCreases: number[][] = faces.map(() => []);
  creases.forEach((c, k) => {
    faceCreases[c.a].push(k);
    faceCreases[c.b].push(k);
  });
  return { faces, creases, faceCreases };
}

function sharedSegment(pa: Vec2[], pb: Vec2[]): [Vec2, Vec2] | null {
  let best: [Vec2, Vec2] | null = null;
  let bestLen = 0;
  for (let i = 0; i < pa.length; i++) {
    const a0 = pa[i];
    const a1 = pa[(i + 1) % pa.length];
    const d = sub2(a1, a0);
    const L = Math.sqrt(dot2(d, d));
    if (L < EPS) continue;
    const u: Vec2 = [d[0] / L, d[1] / L];
    for (let j = 0; j < pb.length; j++) {
      const b0 = pb[j];
      const b1 = pb[(j + 1) % pb.length];
      if (Math.abs(cross2(u, sub2(b0, a0))) > 10 * EPS || Math.abs(cross2(u, sub2(b1, a0))) > 10 * EPS) continue;
      const t0 = dot2(u, sub2(b0, a0));
      const t1 = dot2(u, sub2(b1, a0));
      if (t1 > t0) continue; // adjacent CCW faces traverse a shared edge in opposite directions
      const lo = Math.max(0, t1);
      const hi = Math.min(L, t0);
      if (hi - lo > 10 * EPS && hi - lo > bestLen) {
        bestLen = hi - lo;
        best = [
          [a0[0] + u[0] * lo, a0[1] + u[1] * lo],
          [a0[0] + u[0] * hi, a0[1] + u[1] * hi],
        ];
      }
    }
  }
  return best;
}

/**
 * Crease angles for a new topology, inherited from an older state through face ancestry.
 * Edges between two pieces of the same old face are new cuts and start flat.
 */
export function inheritAngles(topo: Topology, old: PaperState): number[] {
  const oldMap = new Map<string, number>();
  old.topo.creases.forEach((c, k) => {
    oldMap.set(pairKey(old.topo.faces[c.a].id, old.topo.faces[c.b].id), old.angles[k]);
  });
  return topo.creases.map((c) => {
    const ca = ancestry(topo.faces[c.a].id);
    const cb = ancestry(topo.faces[c.b].id);
    for (const x of ca) {
      for (const y of cb) {
        if (x === y) return 0;
        const v = oldMap.get(pairKey(x, y));
        if (v !== undefined) return v;
      }
    }
    return 0;
  });
}

/** Spanning tree used for forward kinematics. */
export interface KinematicTree {
  root: number;
  /** Faces in BFS order (root first). */
  order: number[];
  parent: Int32Array;
  /** Crease connecting each face to its parent (-1 for root). */
  via: Int32Array;
  /** Rotation axis (in paper space) for each face relative to its parent. */
  axisPoint: Vec3[];
  axisDir: Vec3[];
}

/** Axis for rotating face `child` about crease k relative to the face on the other side. */
export function creaseAxis(topo: Topology, k: number, child: number): { point: Vec3; dir: Vec3 } {
  const c = topo.creases[k];
  const d = normalize2(sub2(c.p1, c.p0));
  let n: Vec2 = [-d[1], d[0]];
  const cc = centroid(topo.faces[child].poly);
  if (dot2(n, sub2(cc, c.p0)) < 0) n = [-n[0], -n[1]];
  // Positive angle lifts the child toward +z of the other face's paper frame.
  return { point: [c.p0[0], c.p0[1], 0], dir: [n[1], -n[0], 0] };
}

export function buildTree(topo: Topology, root: number): KinematicTree {
  const n = topo.faces.length;
  const parent = new Int32Array(n).fill(-1);
  const via = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const order: number[] = [root];
  const axisPoint: Vec3[] = new Array(n);
  const axisDir: Vec3[] = new Array(n);
  axisPoint[root] = [0, 0, 0];
  axisDir[root] = [0, 0, 1];
  seen[root] = 1;
  for (let h = 0; h < order.length; h++) {
    const f = order[h];
    for (const k of topo.faceCreases[f]) {
      const c = topo.creases[k];
      const g = c.a === f ? c.b : c.a;
      if (seen[g]) continue;
      seen[g] = 1;
      parent[g] = f;
      via[g] = k;
      const ax = creaseAxis(topo, k, g);
      axisPoint[g] = ax.point;
      axisDir[g] = ax.dir;
      order.push(g);
    }
  }
  if (order.length !== n) throw new Error('paper is not connected');
  return { root, order, parent, via, axisPoint, axisDir };
}

export function solveTransforms(tree: KinematicTree, angles: ArrayLike<number>, rootTransform: Mat4): Mat4[] {
  const out: Mat4[] = new Array(tree.order.length);
  out[tree.root] = rootTransform;
  for (let h = 1; h < tree.order.length; h++) {
    const f = tree.order[h];
    out[f] = mat4Mul(out[tree.parent[f]], mat4RotateAboutLine(tree.axisPoint[f], tree.axisDir[f], angles[tree.via[f]]));
  }
  return out;
}

/**
 * How far the faces drift apart across creases that are not in the tree. Zero means the
 * crease angles fit together; a large value means the paper would have to tear.
 */
export function tearError(topo: Topology, transforms: Mat4[], angles: ArrayLike<number>): { error: number; crease: number } {
  let worst = 0;
  let worstK = -1;
  topo.creases.forEach((c, k) => {
    const ax = creaseAxis(topo, k, c.b);
    const predicted = mat4Mul(transforms[c.a], mat4RotateAboutLine(ax.point, ax.dir, angles[k]));
    const cc = centroid(topo.faces[c.b].poly);
    for (const p of [cc, c.p0, c.p1]) {
      const q: Vec3 = [p[0], p[1], 0];
      const x = mat4Apply(predicted, q);
      const y = mat4Apply(transforms[c.b], q);
      const e = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
      if (e > worst) { worst = e; worstK = k; }
    }
  });
  return { error: worst, crease: worstK };
}

export function isFlatAngle(a: number): boolean {
  return Math.abs(a) < FLAT_TOL || Math.abs(Math.abs(a) - Math.PI) < FLAT_TOL;
}

export function snapAngle(a: number): number {
  if (Math.abs(a) < FLAT_TOL) return 0;
  if (Math.abs(a - Math.PI) < FLAT_TOL) return Math.PI;
  if (Math.abs(a + Math.PI) < FLAT_TOL) return -Math.PI;
  return a;
}

export function worldPolygon(state: Pick<PaperState, 'topo' | 'transforms'>, i: number): Vec2[] {
  const m = state.transforms[i];
  return ensureCCW(state.topo.faces[i].poly.map((p) => mat4Apply2(m, p)));
}

export function worldPoint(m: Mat4, p: Vec2): Vec2 {
  return mat4Apply2(m, p);
}

export function initialState(width: number, height: number): PaperState {
  const face: Face = { id: 'f', poly: [[0, 0], [width, 0], [width, height], [0, height]] };
  return {
    topo: buildTopology([face]),
    angles: [],
    transforms: [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
    ranks: [0],
    above: new Map(),
    flat: true,
  };
}

export function paperArea(topo: Topology): number {
  let s = 0;
  for (const f of topo.faces) {
    for (let i = 0; i < f.poly.length; i++) {
      const a = f.poly[i];
      const b = f.poly[(i + 1) % f.poly.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
  }
  return s / 2;
}
