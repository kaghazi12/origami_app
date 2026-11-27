/**
 * Fold a whole crease pattern (FOLD file) flat in one go, exactly.
 *
 * Every M / V crease is folded to -180 / +180 degrees, every F crease stays flat. Face
 * transforms follow by forward kinematics, the tear check proves the pattern folds as one
 * piece, and the layer solver finds a stacking with no paper passing through paper.
 *
 * This is what complex patterns need: simulating all creases at once from a flat sheet picks a
 * crumpled branch, but the folded end state itself can be computed directly.
 */

import { mat4Apply, mat4Apply2, type Vec2 } from './math';
import { signedArea } from './polygon';
import { buildTopology, buildTree, solveTransforms, tearError, worldPolygon, type Face } from './state';
import { solveLayers } from './layers';

export interface CreasePatternInput {
  vertices_coords: number[][];
  edges_vertices: [number, number][];
  edges_assignment: string[];
  /**
   * Optional fold angles in degrees (positive valley). Missing or all +-180: the pattern is folded
   * flat and its layer order is solved. Partial angles (3D models): folded to exactly those angles.
   */
  edges_foldAngle?: (number | null)[];
  /** Faces as vertex loops. Required (derive with extractPlanarFaces if the file has none). */
  faces_vertices: number[][];
}

export interface FoldedPattern {
  ok: boolean;
  reason?: string;
  /** Folded position of every input vertex, with layer offsets (gap * stacking height). */
  vertices: Float64Array;
  /** Folded position without layer offsets, and each vertex's average stacking height. */
  flatVertices: Float64Array;
  vertexRanks: Float64Array;
  /** Per input face: stacking height and whether its front faces up. */
  faceRanks: number[];
  faceFlipped: boolean[];
  /** Largest gap between faces along any crease (0 = folds as one piece). */
  tear: number;
  layerCount: number;
  timeMs: number;
}

export interface FoldPatternOptions {
  /** Height between stacked layers, in paper units. */
  layerGap?: number;
  maxConflicts?: number;
}

export function foldCreasePattern(cp: CreasePatternInput, opts: FoldPatternOptions = {}): FoldedPattern {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const nV = cp.vertices_coords.length;
  const fail = (reason: string, tear = Infinity): FoldedPattern => ({
    ok: false, reason, vertices: new Float64Array(nV * 3), flatVertices: new Float64Array(nV * 3), vertexRanks: new Float64Array(nV), faceRanks: [], faceFlipped: [], tear, layerCount: 0,
    timeMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  });
  const V = cp.vertices_coords.map((p) => [p[0], p[1]] as Vec2);

  // faces, counter-clockwise; map back to the caller's face order
  const faces: Face[] = [];
  const faceLoops: number[][] = [];
  const origIndex: number[] = [];
  cp.faces_vertices.forEach((loop, i) => {
    let poly = loop.map((v) => V[v]);
    let l = loop;
    const a = signedArea(poly);
    if (Math.abs(a) < 1e-12) return;
    if (a < 0) { poly = poly.slice().reverse(); l = loop.slice().reverse(); }
    faces.push({ id: `f${i}`, poly });
    faceLoops.push(l);
    origIndex.push(i);
  });
  if (faces.length === 0) return fail('the crease pattern has no faces');
  for (const f of faces) {
    for (let i = 0; i < f.poly.length; i++) {
      const p = f.poly[(i + f.poly.length - 1) % f.poly.length], q = f.poly[i], r = f.poly[(i + 1) % f.poly.length];
      if ((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) < -1e-9) return fail('a face is not convex');
    }
  }

  const topo = buildTopology(faces);
  // fold angle of each crease, from the FOLD edge lying on it
  const edgeAt = new Map<string, number>();
  cp.edges_vertices.forEach(([a, b], e) => edgeAt.set(a < b ? `${a},${b}` : `${b},${a}`, e));
  const angleOfEdge = (e: number) => {
    const s = cp.edges_assignment[e];
    if (s !== 'M' && s !== 'V') return 0;
    const deg = cp.edges_foldAngle?.[e];
    if (deg !== null && deg !== undefined && Number.isFinite(deg)) {
      // the sign comes from the assignment, the size from the file's angle
      const mag = (Math.min(180, Math.abs(deg)) * Math.PI) / 180;
      return s === 'M' ? -mag : mag;
    }
    return s === 'M' ? -Math.PI : Math.PI;
  };
  const vertexKey = new Map<string, number>();
  V.forEach((p, i) => vertexKey.set(`${Math.round(p[0] * 1e8)},${Math.round(p[1] * 1e8)}`, i));
  const vAt = (p: Vec2) => vertexKey.get(`${Math.round(p[0] * 1e8)},${Math.round(p[1] * 1e8)}`);
  const angles = topo.creases.map((c) => {
    const a = vAt(c.p0), b = vAt(c.p1);
    if (a !== undefined && b !== undefined) {
      const e = edgeAt.get(a < b ? `${a},${b}` : `${b},${a}`);
      if (e !== undefined) return angleOfEdge(e);
    }
    // shared segment spans several edges or ends mid-edge: use the edge under its midpoint
    const mid: Vec2 = [(c.p0[0] + c.p1[0]) / 2, (c.p0[1] + c.p1[1]) / 2];
    let best = 0, bd = Infinity;
    cp.edges_vertices.forEach(([a2, b2], e) => {
      const A = V[a2], B = V[b2];
      const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
      const t = ((mid[0] - A[0]) * dx + (mid[1] - A[1]) * dy) / L2;
      if (t < 0 || t > 1) return;
      const d = Math.abs((mid[0] - A[0]) * dy - (mid[1] - A[1]) * dx) / Math.sqrt(L2);
      if (d < bd) { bd = d; best = angleOfEdge(e); }
    });
    return best;
  });
  if (cp.edges_assignment.some((s) => s === 'U')) return fail('some creases are unassigned (U); mountain/valley is needed to fold exactly');

  const tree = buildTree(topo, 0);
  const transforms = solveTransforms(tree, angles, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const tear = tearError(topo, transforms, angles).error;
  if (tear > 1e-6) return fail('the creases do not fold together at these angles (the paper would tear)', tear);

  // A 3D target (some creases only partly folded) needs no stacking order: faces are apart in space.
  const flatTarget = angles.every((a) => Math.abs(a) < 1e-9 || Math.abs(Math.abs(a) - Math.PI) < 1e-6);

  const state = { topo, transforms };
  const polys = faces.map((_, i) => worldPolygon(state, i));
  const signs = transforms.map((m) => Math.sign(m[10]) || 1);
  const folded: { a: number; b: number; sign: number; p0: Vec2; p1: Vec2 }[] = [];
  const joints: { a: number; b: number; p0: Vec2; p1: Vec2 }[] = [];
  topo.creases.forEach((c, k) => {
    const p0 = mat4Apply2(transforms[c.a], c.p0), p1 = mat4Apply2(transforms[c.a], c.p1);
    if (Math.abs(angles[k]) > 1) folded.push({ a: c.a, b: c.b, sign: Math.sign(angles[k]), p0, p1 });
    else joints.push({ a: c.a, b: c.b, p0, p1 });
  });
  const res = flatTarget
    ? solveLayers({ polys, signs, folded, joints, maxConflicts: opts.maxConflicts ?? 200000 })
    : { ok: true, ranks: new Array<number>(faces.length).fill(0) };
  if (!res.ok) return fail('no stacking order lets the paper lie flat without passing through itself', tear);

  // per-vertex folded position: rigid position, lifted by the average stacking height of its faces
  const flatVertices = new Float64Array(nV * 3);
  const vertexRanks = new Float64Array(nV);
  const cnt = new Uint16Array(nV);
  faces.forEach((_, f) => {
    const m = transforms[f];
    for (const v of faceLoops[f]) {
      const w = mat4Apply(m, [V[v][0], V[v][1], 0]);
      flatVertices[v * 3] += w[0]; flatVertices[v * 3 + 1] += w[1]; flatVertices[v * 3 + 2] += w[2];
      vertexRanks[v] += res.ranks[f];
      cnt[v]++;
    }
  });
  for (let v = 0; v < nV; v++) {
    if (!cnt[v]) continue;
    for (let k = 0; k < 3; k++) flatVertices[v * 3 + k] /= cnt[v];
    vertexRanks[v] /= cnt[v];
  }
  const out = withLayerGap(flatVertices, vertexRanks, opts.layerGap ?? 0.0008);

  const faceRanks = new Array<number>(cp.faces_vertices.length).fill(0);
  const faceFlipped = new Array<boolean>(cp.faces_vertices.length).fill(false);
  origIndex.forEach((orig, f) => { faceRanks[orig] = res.ranks[f]; faceFlipped[orig] = signs[f] < 0; });
  return {
    ok: true, vertices: out, flatVertices, vertexRanks, faceRanks, faceFlipped, tear, layerCount: Math.max(0, ...res.ranks) + 1,
    timeMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}

/** Folded positions with each vertex lifted by gap * its stacking height. */
export function withLayerGap(flatVertices: Float64Array, vertexRanks: Float64Array, gap: number): Float64Array {
  const out = Float64Array.from(flatVertices);
  for (let v = 0; v < vertexRanks.length; v++) out[v * 3 + 2] += vertexRanks[v] * gap;
  return out;
}

/**
 * Plays a crease pattern from flat (alpha 0) to its exact folded form (alpha 1).
 *
 * Complex patterns (box pleating, tessellations) have no rigid folding motion and physics picks
 * a crumpled branch, so the in-between frames are computed directly instead: every vertex moves
 * from its flat position to its exact folded position, and the pleats rise along mountain creases
 * and dip along valley creases while they collapse. The end state is exact.
 */
export class ExactFoldPlayer {
  folded: Float64Array;
  private readonly flat: Float64Array;
  private readonly lift: Float64Array;
  /** Folded positions without layer offsets (centred), and stacking height per vertex. */
  private base: Float64Array | null = null;
  private ranks: Float64Array | null = null;

  /**
   * folded: folded positions (with any layer offsets already applied). Pass ranks to be able to
   * change the spacing between layers later with setLayerGap (folded must then have gap 0).
   */
  constructor(cp: CreasePatternInput, folded: Float64Array, ranks?: Float64Array) {
    const n = cp.vertices_coords.length;
    this.flat = new Float64Array(n * 3);
    cp.vertices_coords.forEach((p, i) => { this.flat[i * 3] = p[0]; this.flat[i * 3 + 1] = p[1]; });
    // collapse in place: centre the folded model on the middle of the sheet
    const box = (a: Float64Array) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        x0 = Math.min(x0, a[i * 3]); x1 = Math.max(x1, a[i * 3]);
        y0 = Math.min(y0, a[i * 3 + 1]); y1 = Math.max(y1, a[i * 3 + 1]);
      }
      return [(x0 + x1) / 2, (y0 + y1) / 2];
    };
    const [fx, fy] = box(folded);
    const [sx, sy] = box(this.flat);
    this.folded = Float64Array.from(folded);
    for (let i = 0; i < n; i++) { this.folded[i * 3] += sx - fx; this.folded[i * 3 + 1] += sy - fy; }
    if (ranks) {
      this.base = Float64Array.from(this.folded);
      this.ranks = ranks;
    }
    // mountain/valley balance at each vertex and the local crease spacing
    const m = new Float64Array(n), v = new Float64Array(n), shortest = new Float64Array(n).fill(Infinity);
    cp.edges_vertices.forEach(([a, b], e) => {
      const s = cp.edges_assignment[e];
      const L = Math.hypot(cp.vertices_coords[a][0] - cp.vertices_coords[b][0], cp.vertices_coords[a][1] - cp.vertices_coords[b][1]);
      for (const x of [a, b]) {
        if (s === 'M') m[x]++;
        if (s === 'V') v[x]++;
        if (s === 'M' || s === 'V') shortest[x] = Math.min(shortest[x], L);
      }
    });
    this.lift = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (m[i] + v[i] === 0 || !Number.isFinite(shortest[i])) continue;
      // a pleat of width w lifted halfway rises by about 0.35 w
      this.lift[i] = ((m[i] - v[i]) / (m[i] + v[i])) * 0.35 * shortest[i];
    }
  }

  /** Relaxed folded poses (physics opened slightly from the exact form), alpha descending from 1. */
  private relaxAlphas: number[] = [];
  private relaxPoses: Float64Array[] = [];

  /**
   * Keyframes for the top of the fold range: alphas[0] must be 1 (the exact folded form) and the
   * rest descending, e.g. [1, 0.97, ..., 0.85]. Between the lowest keyframe and the flat sheet
   * the computed transition is used.
   */
  setRelaxedKeyframes(alphas: number[], poses: Float64Array[]): void {
    this.relaxAlphas = alphas.slice();
    this.relaxPoses = poses.map((p) => Float64Array.from(p));
  }

  /** Lowest fold progress covered by relaxed keyframes (1 when there are none). */
  get relaxedFrom(): number {
    return this.relaxAlphas.length > 1 ? this.relaxAlphas[this.relaxAlphas.length - 1] : 1;
  }

  /** Space between stacked layers in the folded form (paper units). Needs ranks in the constructor. */
  setLayerGap(gap: number): void {
    if (!this.base || !this.ranks) return;
    this.folded = withLayerGap(this.base, this.ranks, gap);
  }

  /** Vertex positions at fold progress alpha (0..1), written into out (3 per vertex). */
  pose(alpha: number, out: Float64Array): void {
    const a = Math.min(1, Math.max(0, alpha));
    const ks = this.relaxAlphas;
    if (ks.length > 1 && a >= this.relaxedFrom) {
      // between two relaxed keyframes (real paper shapes from the physics relaxation)
      let i = 0;
      while (i < ks.length - 2 && a < ks[i + 1]) i++;
      const hi = ks[i], lo = ks[i + 1];
      const f = hi === lo ? 0 : (hi - a) / (hi - lo);
      const A = this.relaxPoses[i], B = this.relaxPoses[i + 1];
      for (let k = 0; k < out.length; k++) out[k] = A[k] + (B[k] - A[k]) * f;
      return;
    }
    // computed transition from the flat sheet to the lowest relaxed keyframe (or the folded form)
    const end = ks.length > 1 ? this.relaxPoses[this.relaxPoses.length - 1] : this.folded;
    const s = ks.length > 1 ? a / this.relaxedFrom : a;
    const bump = Math.sin(Math.PI * s);
    const n = this.lift.length;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      out[k] = this.flat[k] + (end[k] - this.flat[k]) * s;
      out[k + 1] = this.flat[k + 1] + (end[k + 1] - this.flat[k + 1]) * s;
      out[k + 2] = this.flat[k + 2] + (end[k + 2] - this.flat[k + 2]) * s + this.lift[i] * bump;
    }
  }
}
