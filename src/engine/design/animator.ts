/**
 * Playback: turns a compiled design into vertex positions at any progress value.
 *
 * Progress 2.4 means step index 2 is 40% done. During a step the crease angles are
 * interpolated and the face transforms follow by forward kinematics from the step's root face,
 * so a simple fold is an exact rigid rotation, and complex moves (squash, petal...) bend the
 * paper smoothly. Shared paper vertices are welded so the sheet never shows cracks.
 */

import type { CompiledDesign } from './compile';
import { mat4Mul, mat4RotateAboutLine, type Mat4 } from './math';
import type { StepRecord } from './ops';
import { buildTree, solveTransforms, type KinematicTree, type PaperState } from './state';
import { planStepPath, sampleStepPath, type StepPath } from './kinematics';

export interface AnimatorOptions {
  /** Height between stacked layers, internal units (sheet's longest side = 1). */
  layerGap?: number;
  /** Ease each step in and out (default true). */
  ease?: boolean;
}

export interface StepGeometry {
  /** Segment index: -1 = blank sheet before any step, otherwise the step index. */
  segment: number;
  cornerCount: number;
  indices: Uint32Array;
  /** Paper coordinates normalised to [0, 1]. */
  uvs: Float32Array;
  faceOfCorner: Int32Array;
  /** Paper position of each corner (internal units). */
  paper: Float64Array;
  weld: Int32Array;
  weldCount: number;
  /** Crease endpoints (paper) and the two faces on each side. */
  creaseA: Int32Array;
  creaseB: Int32Array;
  creaseP: Float64Array;
  /** Corners of each face, for picking. */
  faceCornerStart: Int32Array;
  /** For each crease, pairs of corners (one per face) at its shared endpoints: [a0, b0, a1, b1, ...]. */
  creaseCornerPairs: Int32Array[];
}

export interface Pose {
  /** Index of the step being animated (stepCount when finished). */
  stepIndex: number;
  /** 0..1 inside that step. */
  t: number;
  geometry: StepGeometry;
  /** 3 floats per corner. */
  positions: Float32Array;
  /** Line segments (6 floats each) for creases currently folded, and for flat crease marks. */
  foldedLines: Float32Array;
  flatLines: Float32Array;
  /** Per face: is it moving in this step. */
  moving: boolean[];
}

interface Segment {
  index: number;
  record: StepRecord | null;
  state: PaperState;
  tree: KinematicTree;
  geometry: StepGeometry;
  /** Planned rigid motion (undefined = not planned yet, null = interpolate directly). */
  path?: StepPath | null;
}

const DEFAULT_GAP = 0.0025;

function buildGeometry(segment: number, state: PaperState, width: number, height: number): StepGeometry {
  const faces = state.topo.faces;
  let cornerCount = 0;
  for (const f of faces) cornerCount += f.poly.length;
  const uvs = new Float32Array(cornerCount * 2);
  const paper = new Float64Array(cornerCount * 2);
  const faceOfCorner = new Int32Array(cornerCount);
  const faceCornerStart = new Int32Array(faces.length + 1);
  const weld = new Int32Array(cornerCount);
  const weldMap = new Map<string, number>();
  const tris: number[] = [];
  let c = 0;
  faces.forEach((f, fi) => {
    faceCornerStart[fi] = c;
    const start = c;
    for (const p of f.poly) {
      uvs[c * 2] = p[0] / width;
      uvs[c * 2 + 1] = p[1] / height;
      paper[c * 2] = p[0];
      paper[c * 2 + 1] = p[1];
      faceOfCorner[c] = fi;
      const key = `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
      let w = weldMap.get(key);
      if (w === undefined) { w = weldMap.size; weldMap.set(key, w); }
      weld[c] = w;
      c++;
    }
    for (let k = 1; k < f.poly.length - 1; k++) tris.push(start, start + k, start + k + 1);
  });
  faceCornerStart[faces.length] = c;
  const creases = state.topo.creases;
  const creaseA = new Int32Array(creases.length);
  const creaseB = new Int32Array(creases.length);
  const creaseP = new Float64Array(creases.length * 4);
  creases.forEach((cr, k) => {
    creaseA[k] = cr.a;
    creaseB[k] = cr.b;
    creaseP.set([cr.p0[0], cr.p0[1], cr.p1[0], cr.p1[1]], k * 4);
  });
  // corners of the two faces of each crease that sit on the same paper point
  const cornerAt = (f: number, p: [number, number]) => {
    for (let c = faceCornerStart[f]; c < faceCornerStart[f + 1]; c++) {
      if (Math.abs(paper[c * 2] - p[0]) < 1e-9 && Math.abs(paper[c * 2 + 1] - p[1]) < 1e-9) return c;
    }
    return -1;
  };
  const creaseCornerPairs = creases.map((cr) => {
    const pairs: number[] = [];
    for (const p of [cr.p0, cr.p1]) {
      const ca = cornerAt(cr.a, p);
      const cb = cornerAt(cr.b, p);
      if (ca >= 0 && cb >= 0) pairs.push(ca, cb);
    }
    return new Int32Array(pairs);
  });
  return {
    creaseCornerPairs,
    segment,
    cornerCount,
    indices: new Uint32Array(tris),
    uvs,
    faceOfCorner,
    paper,
    weld,
    weldCount: weldMap.size,
    creaseA,
    creaseB,
    creaseP,
    faceCornerStart,
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export class DesignAnimator {
  readonly compiled: CompiledDesign;
  readonly layerGap: number;
  private readonly ease: boolean;
  private readonly segments: Segment[] = [];
  private blank: Segment;

  constructor(compiled: CompiledDesign, options: AnimatorOptions = {}) {
    this.compiled = compiled;
    this.layerGap = options.layerGap ?? DEFAULT_GAP;
    this.ease = options.ease ?? true;
    const w = compiled.design.paper.width * compiled.scale;
    const h = compiled.design.paper.height * compiled.scale;
    this.blank = {
      index: -1,
      record: null,
      state: compiled.initial,
      tree: buildTree(compiled.initial.topo, 0),
      geometry: buildGeometry(-1, compiled.initial, w, h),
    };
    compiled.steps.forEach((s, i) => {
      this.segments.push({
        index: i,
        record: s.record,
        state: s.record.before,
        tree: buildTree(s.record.topo, s.record.root),
        geometry: buildGeometry(i, s.record.before, w, h),
      });
    });
  }

  get stepCount(): number {
    return this.segments.length;
  }

  /** Clamp + split a progress value. */
  locate(progress: number): { stepIndex: number; t: number } {
    const n = this.segments.length;
    const p = Math.min(Math.max(progress, 0), n);
    if (p >= n) return { stepIndex: n, t: 0 };
    const i = Math.floor(p);
    return { stepIndex: i, t: p - i };
  }

  pose(progress: number): Pose {
    const { stepIndex, t } = this.locate(progress);
    const n = this.segments.length;
    let seg: Segment;
    let tt: number;
    if (n === 0) { seg = this.blank; tt = 0; }
    else if (stepIndex >= n) { seg = this.segments[n - 1]; tt = 1; }
    else { seg = this.segments[stepIndex]; tt = this.ease ? smooth(t) : t; }

    const r = seg.record;
    const before = r ? r.before : seg.state;
    const after = r ? r.after : seg.state;
    const nc = before.angles.length;
    const angles = new Float64Array(nc);
    if (r && seg.path === undefined) seg.path = planStepPath(r);
    if (seg.path && tt > 0 && tt < 1) sampleStepPath(seg.path, tt, angles);
    else for (let k = 0; k < nc; k++) angles[k] = before.angles[k] + (after.angles[k] - before.angles[k]) * tt;
    const root = seg.tree.root;
    let rootM: Mat4 = before.transforms[root];
    if (r?.rootMotion) {
      const m = r.rootMotion;
      rootM = mat4Mul(mat4RotateAboutLine(m.point, m.axis, m.angle * tt), rootM);
    }
    const transforms = solveTransforms(seg.tree, angles, rootM);

    const g = seg.geometry;
    const nf = transforms.length;
    // per-face offset along the face normal: interpolate the signed stacking height
    const offsets = new Float64Array(nf * 3);
    for (let f = 0; f < nf; f++) {
      const m = transforms[f];
      const sb = Math.sign(before.transforms[f][10]) || 1;
      const sa = Math.sign(after.transforms[f][10]) || 1;
      const h = (sb * before.ranks[f] + (sa * after.ranks[f] - sb * before.ranks[f]) * tt) * this.layerGap;
      offsets[f * 3] = m[8] * h;
      offsets[f * 3 + 1] = m[9] * h;
      offsets[f * 3 + 2] = m[10] * h;
    }

    // Rigid position of every corner (without and with its layer offset).
    const raw = new Float64Array(g.cornerCount * 3);
    const corner = new Float64Array(g.cornerCount * 3);
    for (let c = 0; c < g.cornerCount; c++) {
      const f = g.faceOfCorner[c];
      const m = transforms[f];
      const u = g.paper[c * 2];
      const v = g.paper[c * 2 + 1];
      raw[c * 3] = m[0] * u + m[4] * v + m[12];
      raw[c * 3 + 1] = m[1] * u + m[5] * v + m[13];
      raw[c * 3 + 2] = m[2] * u + m[6] * v + m[14];
      corner[c * 3] = raw[c * 3] + offsets[f * 3];
      corner[c * 3 + 1] = raw[c * 3 + 1] + offsets[f * 3 + 1];
      corner[c * 3 + 2] = raw[c * 3 + 2] + offsets[f * 3 + 2];
    }
    // Join corners only across creases whose two faces actually meet in this frame. Where the
    // motion is not rigid the paper opens along that crease for a moment instead of being
    // dragged through itself.
    const parent = new Int32Array(g.cornerCount);
    for (let c = 0; c < g.cornerCount; c++) parent[c] = c;
    const find = (x: number): number => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const JOIN = 2e-3;
    for (const pairs of g.creaseCornerPairs) {
      let ok = true;
      for (let q = 0; q < pairs.length && ok; q += 2) {
        const a = pairs[q] * 3;
        const b = pairs[q + 1] * 3;
        ok = Math.hypot(raw[a] - raw[b], raw[a + 1] - raw[b + 1], raw[a + 2] - raw[b + 2]) < JOIN;
      }
      if (!ok) continue;
      for (let q = 0; q < pairs.length; q += 2) {
        const ra = find(pairs[q]);
        const rb = find(pairs[q + 1]);
        if (ra !== rb) parent[ra] = rb;
      }
    }
    const acc = new Float64Array(g.cornerCount * 3);
    const cnt = new Uint16Array(g.cornerCount);
    for (let c = 0; c < g.cornerCount; c++) {
      const root = find(c);
      acc[root * 3] += corner[c * 3];
      acc[root * 3 + 1] += corner[c * 3 + 1];
      acc[root * 3 + 2] += corner[c * 3 + 2];
      cnt[root]++;
    }
    const positions = new Float32Array(g.cornerCount * 3);
    for (let c = 0; c < g.cornerCount; c++) {
      const root = find(c);
      positions[c * 3] = acc[root * 3] / cnt[root];
      positions[c * 3 + 1] = acc[root * 3 + 1] / cnt[root];
      positions[c * 3 + 2] = acc[root * 3 + 2] / cnt[root];
    }

    const folded: number[] = [];
    const flat: number[] = [];
    const nk = g.creaseA.length;
    const lift = this.layerGap * 0.3;
    for (let k = 0; k < nk; k++) {
      const a = g.creaseA[k];
      const b = g.creaseB[k];
      const out = Math.abs(angles[k]) > 1e-3 ? folded : flat;
      for (let e = 0; e < 2; e++) {
        const u = g.creaseP[k * 4 + e * 2];
        const v = g.creaseP[k * 4 + e * 2 + 1];
        const pa = point(transforms[a], u, v, offsets, a);
        const pb = point(transforms[b], u, v, offsets, b);
        // flat creases: draw slightly above the face so they are visible on both sides is not
        // possible; lift toward the viewer side of the upper face instead
        const ma = transforms[a];
        out.push((pa[0] + pb[0]) / 2 + ma[8] * lift, (pa[1] + pb[1]) / 2 + ma[9] * lift, (pa[2] + pb[2]) / 2 + ma[10] * lift);
      }
    }
    return {
      stepIndex,
      t,
      geometry: g,
      positions,
      foldedLines: new Float32Array(folded),
      flatLines: new Float32Array(flat),
      moving: r ? r.moving : new Array(nf).fill(false),
    };
  }

  /** Bounding box of the model at the end of each step (for camera framing). */
  boundsAt(progress: number): { min: [number, number, number]; max: [number, number, number] } {
    const p = this.pose(progress);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], p.positions[i + a]);
        max[a] = Math.max(max[a], p.positions[i + a]);
      }
    }
    return { min, max };
  }
}

function point(m: Mat4, u: number, v: number, offsets: Float64Array, f: number): [number, number, number] {
  return [
    m[0] * u + m[4] * v + m[12] + offsets[f * 3],
    m[1] * u + m[5] * v + m[13] + offsets[f * 3 + 1],
    m[2] * u + m[6] * v + m[14] + offsets[f * 3 + 2],
  ];
}
