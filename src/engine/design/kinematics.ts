/**
 * Motion planning for steps that change several creases at once (squash, petal, reverse folds).
 *
 * Interpolating every crease angle in a straight line does not keep the paper in one piece:
 * halfway through, the faces no longer meet along their shared creases. Here we instead walk
 * from the start angles to the end angles in small steps and, at each step, solve for the
 * angles closest to the straight-line guess that DO close every loop of faces (rigid origami
 * kinematics). The result is a list of angle samples the animator plays back.
 */

import { centroid } from './polygon';
import { mat4Mul, mat4RotateAboutLine, type Mat4 } from './math';
import { buildTree, creaseAxis, solveTransforms, type KinematicTree } from './state';
import type { StepRecord } from './ops';

export interface StepPath {
  /** Progress values (0..1) of the samples. */
  t: Float64Array;
  /** Crease angles at each sample. */
  angles: Float64Array[];
  /** Largest gap between faces along any crease over the whole path (0 = perfectly rigid). */
  maxGap: number;
}

interface Closure {
  a: number;
  b: number;
  axisPoint: [number, number, number];
  axisDir: [number, number, number];
  pts: [number, number][];
}

function closures(rec: StepRecord, tree: KinematicTree): Closure[] {
  const out: Closure[] = [];
  rec.topo.creases.forEach((c, k) => {
    if (tree.via[c.b] === k || tree.via[c.a] === k) return; // tree edges close by construction
    const ax = creaseAxis(rec.topo, k, c.b);
    out.push({ a: c.a, b: c.b, axisPoint: ax.point, axisDir: ax.dir, pts: [c.p0, c.p1, centroid(rec.topo.faces[c.b].poly)] });
  });
  return out;
}

function gaps(tr: Mat4[], cls: Closure[], angles: ArrayLike<number>, creaseOf: Map<string, number>, out: number[]): void {
  out.length = 0;
  for (const c of cls) {
    const k = creaseOf.get(`${c.a}|${c.b}`)!;
    const pred = mat4Mul(tr[c.a], mat4RotateAboutLine(c.axisPoint, c.axisDir, angles[k]));
    const mb = tr[c.b];
    for (const p of c.pts) {
      for (let r = 0; r < 3; r++) {
        const x = pred[r] * p[0] + pred[4 + r] * p[1] + pred[12 + r];
        const y = mb[r] * p[0] + mb[4 + r] * p[1] + mb[12 + r];
        out.push(x - y);
      }
    }
  }
}

/** Solve (A + lambda I) x = b for a small dense symmetric system. */
function solveDense(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** True when straight-line interpolation already keeps the paper in one piece. */
function linearIsRigid(rec: StepRecord, tree: KinematicTree, cls: Closure[], creaseOf: Map<string, number>): boolean {
  if (cls.length === 0) return true;
  const g: number[] = [];
  for (const t of [0.25, 0.5, 0.75]) {
    const a = rec.before.angles.map((x, k) => x + (rec.after.angles[k] - x) * t);
    gaps(solveTransforms(tree, a, rec.before.transforms[tree.root]), cls, a, creaseOf, g);
    if (g.some((v) => Math.abs(v) > 1e-6)) return false;
  }
  return true;
}

/**
 * Plan the motion for one step. Returns null when straight-line interpolation is already exact
 * (single folds, turn over, rotate), or when no smooth rigid motion was found; the animator then
 * interpolates angles directly and only joins faces along creases that still meet.
 */
export function planStepPath(rec: StepRecord, samples = 64): StepPath | null {
  if (rec.rootMotion) return null;
  const tree = buildTree(rec.topo, rec.root);
  const cls = closures(rec, tree);
  const creaseOf = new Map<string, number>();
  rec.topo.creases.forEach((c, k) => creaseOf.set(`${c.a}|${c.b}`, k));
  if (linearIsRigid(rec, tree, cls, creaseOf)) return null;

  const a0 = rec.before.angles;
  const a1 = rec.after.angles;
  const changed = new Set<number>();
  a0.forEach((x, k) => { if (Math.abs(x - a1[k]) > 1e-9) changed.add(k); });
  const vars = [...changed];
  const n = vars.length;
  const root = rec.before.transforms[tree.root];
  // Each crease moves within the range between its start and end angle: going past it means
  // swinging the paper the wrong way round, through itself.
  const SLACK = 0.02;
  const lo = vars.map((k) => Math.max(-Math.PI, Math.min(a0[k], a1[k]) - SLACK));
  const hi = vars.map((k) => Math.min(Math.PI, Math.max(a0[k], a1[k]) + SLACK));
  const clampVars = () => vars.forEach((k, i) => { angles[k] = Math.min(hi[i], Math.max(lo[i], angles[k])); });

  const angles = Float64Array.from(a0);
  const ts = new Float64Array(samples + 1);
  const path: Float64Array[] = [];
  // pull toward the straight-line guess: strong first (keeps the motion progressing on the right
  // branch), then weak (lets closure win)
  const SCHEDULE = [0.1, 0.01, 0.0005];
  let w = SCHEDULE[0];
  let maxGap = 0;
  const g: number[] = [];
  const g2: number[] = [];

  const residual = (target: Float64Array, out: number[]) => {
    gaps(solveTransforms(tree, angles, root), cls, angles, creaseOf, out);
    for (let i = 0; i < n; i++) out.push(w * (angles[vars[i]] - target[i]));
  };

  for (let s = 0; s <= samples; s++) {
    const t = s / samples;
    ts[s] = t;
    if (s === 0) { path.push(Float64Array.from(a0)); continue; }
    if (s === samples) { path.push(Float64Array.from(a1)); continue; }
    const target = Float64Array.from(vars, (k) => a0[k] + (a1[k] - a0[k]) * t);
    // warm start: previous solution shifted by the straight-line increment
    for (let i = 0; i < n; i++) angles[vars[i]] += (a1[vars[i]] - a0[vars[i]]) / samples;

    for (const wk of SCHEDULE) {
    w = wk;
    let lambda = 1e-3;
    residual(target, g);
    let cost = g.reduce((acc, v) => acc + v * v, 0);
    for (let iter = 0; iter < 30 && cost > 1e-20; iter++) {
      // numeric Jacobian
      const J: number[][] = [];
      const h = 1e-6;
      for (let i = 0; i < n; i++) {
        const k = vars[i];
        const save = angles[k];
        angles[k] = save + h;
        residual(target, g2);
        angles[k] = save;
        J.push(g2.map((v, r) => (v - g[r]) / h));
      }
      const JtJ = J.map((ri) => J.map((rj) => ri.reduce((acc, v, r) => acc + v * rj[r], 0)));
      const Jtg = J.map((ri) => ri.reduce((acc, v, r) => acc + v * g[r], 0));
      let improved = false;
      for (let tries = 0; tries < 8; tries++) {
        const A = JtJ.map((row, i) => row.map((v, j) => (i === j ? v + lambda * (1 + v) : v)));
        const d = solveDense(A, Jtg.map((v) => -v));
        if (!d) { lambda *= 10; continue; }
        const save = vars.map((k) => angles[k]);
        // trust region: no crease turns more than ~10 degrees per iteration
        const big = Math.max(...d.map(Math.abs));
        const scale = big > 0.18 ? 0.18 / big : 1;
        vars.forEach((k, i) => { angles[k] += d[i] * scale; });
        clampVars();
        residual(target, g2);
        const c2 = g2.reduce((acc, v) => acc + v * v, 0);
        if (c2 < cost) {
          cost = c2;
          g.length = 0;
          g.push(...g2);
          lambda = Math.max(lambda / 3, 1e-9);
          improved = true;
          break;
        }
        vars.forEach((k, i) => { angles[k] = save[i]; });
        lambda *= 10;
      }
      if (!improved) break;
    }
    }
    clampVars();
    gaps(solveTransforms(tree, angles, root), cls, angles, creaseOf, g);
    for (const v of g) maxGap = Math.max(maxGap, Math.abs(v));
    path.push(Float64Array.from(angles));
  }
  // Accept only a smooth, closed path. A jump between samples means the solver switched to a
  // different way of folding (through the paper); a gap means no rigid motion was found.
  let maxJump = 0;
  let straight = 0;
  for (const k of vars) straight = Math.max(straight, Math.abs(a1[k] - a0[k]) / samples);
  for (let i = 1; i < path.length; i++) {
    for (const k of vars) maxJump = Math.max(maxJump, Math.abs(path[i][k] - path[i - 1][k]));
  }
  if (maxGap > 2e-3 || maxJump > 4 * straight + 0.02) return null;
  return { t: ts, angles: path, maxGap };
}

/** Angles at progress t along a planned path (piecewise linear between samples). */
export function sampleStepPath(path: StepPath, t: number, out: Float64Array): void {
  const n = path.t.length - 1;
  const x = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  const A = path.angles[i];
  const B = path.angles[i + 1];
  for (let k = 0; k < out.length; k++) out[k] = A[k] + (B[k] - A[k]) * f;
}
