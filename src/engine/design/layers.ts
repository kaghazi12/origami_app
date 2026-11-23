/**
 * Layer ordering for a flat-folded state.
 *
 * Every pair of faces that overlap in the folded state gets a boolean "which one is on top".
 * The rules that make an order physically possible are written as clauses and solved with a
 * small DPLL search:
 *
 *  1. Crease rule: two faces joined by a crease folded flat are stacked, and the fold direction
 *     (valley/mountain) and the face orientation say which is on top.
 *  2. Transitivity: three faces that share a common region cannot form a cycle.
 *  3. Taco-tortilla: a face that spans a folded crease cannot sit between its two faces.
 *  4. Taco-taco: two folds on the same line, opening the same way, cannot interleave.
 *  4b. Flat joints act like a face spanning the line (tortilla) for the rules above, and two
 *     flat joints on the same line cannot cross each other (tortilla-tortilla).
 *  5. Known pairs: pairs whose relationship did not change since the previous state.
 *
 * Anything still undecided is chosen with a preference (e.g. "valley folds land on top").
 */

import { AREA_EPS, EPS, cross2, dot2, normalize2, sub2, type Vec2 } from './math';
import { bboxOf, bboxPairs, centroid, clipConvex, segmentInside, signedArea } from './polygon';

export interface FoldedCrease {
  a: number;
  b: number;
  /** +1 / -1 fold sign (valley / mountain, paper front). 0 = folded flat, direction unknown. */
  sign: number;
  /** World segment. */
  p0: Vec2;
  p1: Vec2;
}

export interface FlatJoint {
  /** Two faces joined by an unfolded (flat) crease, lying side by side. */
  a: number;
  b: number;
  p0: Vec2;
  p1: Vec2;
}

export interface LayerInput {
  /** World polygons, counter-clockwise. */
  polys: Vec2[][];
  /** +1 front up, -1 flipped. */
  signs: number[];
  folded: FoldedCrease[];
  /** Flat creases. Paper continues straight across them, so other layers cannot cut between. */
  joints?: FlatJoint[];
  known?: (i: number, j: number) => boolean | undefined;
  prefer?: (i: number, j: number) => boolean | undefined;
  maxConflicts?: number;
}

export interface LayerResult {
  ok: boolean;
  reason?: string;
  /** For overlapping pairs i < j, key i * n + j: true when i is above j. */
  above: Map<number, boolean>;
  ranks: number[];
  /** Overlapping pairs considered. */
  pairCount: number;
  /** True if the order had a cycle among faces that don't share one region (ranks approximate). */
  cyclic: boolean;
}

class Clauses {
  lits: number[][] = [];
  add(...c: number[]) { this.lits.push(c); }
}

/** Solve a CNF over boolean vars 0..n-1 (literal +(v+1) / -(v+1)). */
function dpll(
  nVars: number,
  clauses: number[][],
  preferred: (v: number) => boolean,
  maxConflicts: number,
): Int8Array | null {
  const assign = new Int8Array(nVars); // 0 unassigned, 1 true, -1 false
  const occ: number[][] = Array.from({ length: 2 * nVars }, () => []);
  const litIdx = (l: number) => (l > 0 ? 2 * (l - 1) : 2 * (-l - 1) + 1);
  clauses.forEach((c, ci) => c.forEach((l) => occ[litIdx(l)].push(ci)));
  const trail: number[] = [];
  let qhead = 0;
  const valueOf = (l: number) => {
    const a = assign[Math.abs(l) - 1];
    return a === 0 ? 0 : l > 0 ? a : -a;
  };
  const set = (l: number): boolean => {
    const v = Math.abs(l) - 1;
    const want = l > 0 ? 1 : -1;
    if (assign[v] !== 0) return assign[v] === want;
    assign[v] = want;
    trail.push(l);
    return true;
  };
  const propagate = (): boolean => {
    while (qhead < trail.length) {
      const l = trail[qhead++];
      // clauses containing -l lost a literal
      for (const ci of occ[litIdx(-l)]) {
        const c = clauses[ci];
        let unassigned = 0;
        let last = 0;
        let sat = false;
        for (const x of c) {
          const val = valueOf(x);
          if (val > 0) { sat = true; break; }
          if (val === 0) { unassigned++; last = x; }
        }
        if (sat) continue;
        if (unassigned === 0) return false;
        if (unassigned === 1 && !set(last)) return false;
      }
    }
    return true;
  };

  for (const c of clauses) {
    if (c.length === 1 && !set(c[0])) return null;
    if (c.length === 0) return null;
  }
  if (!propagate()) return null;

  const stack: { lit: number; flipped: boolean; trailPos: number }[] = [];
  let next = 0;
  let conflicts = 0;
  const undo = (pos: number) => {
    while (trail.length > pos) assign[Math.abs(trail.pop()!) - 1] = 0;
    qhead = trail.length;
  };
  for (;;) {
    while (next < nVars && assign[next] !== 0) next++;
    if (next >= nVars) return assign;
    const lit = preferred(next) ? next + 1 : -(next + 1);
    stack.push({ lit, flipped: false, trailPos: trail.length });
    set(lit);
    while (!propagate()) {
      if (++conflicts > maxConflicts) return null;
      let resumed = false;
      while (stack.length) {
        const top = stack.pop()!;
        undo(top.trailPos);
        if (!top.flipped) {
          stack.push({ lit: -top.lit, flipped: true, trailPos: trail.length });
          set(-top.lit);
          resumed = true;
          break;
        }
      }
      if (!resumed) return null;
      next = 0;
    }
  }
}

export function solveLayers(input: LayerInput): LayerResult {
  const n = input.polys.length;
  const boxes = input.polys.map(bboxOf);
  const varOf = new Map<number, number>();
  const pairs: [number, number][] = [];
  const overlaps: Vec2[][] = [];
  const neighbors: number[][] = Array.from({ length: n }, () => []);

  for (const [i, j] of bboxPairs(boxes, -EPS)) {
    const o = clipConvex(input.polys[i], input.polys[j]);
    if (o.length < 3 || Math.abs(signedArea(o)) < AREA_EPS) continue;
    varOf.set(i * n + j, pairs.length);
    pairs.push([i, j]);
    overlaps.push(o);
    neighbors[i].push(j);
    neighbors[j].push(i);
  }
  for (const list of neighbors) list.sort((x, y) => x - y);

  const empty: LayerResult = { ok: true, above: new Map(), ranks: new Array(n).fill(0), pairCount: 0, cyclic: false };
  if (pairs.length === 0) return empty;

  /** Literal meaning "x is above y", or 0 if they don't overlap. */
  const lit = (x: number, y: number): number => {
    const v = x < y ? varOf.get(x * n + y) : varOf.get(y * n + x);
    if (v === undefined) return 0;
    return x < y ? v + 1 : -(v + 1);
  };

  const cl = new Clauses();

  // 1. crease rule
  for (const f of input.folded) {
    if (f.sign === 0) continue;
    const l = lit(f.b, f.a);
    if (l === 0) continue;
    cl.add(input.signs[f.a] * f.sign > 0 ? l : -l);
  }

  // 5. known pairs
  if (input.known) {
    pairs.forEach(([i, j]) => {
      const k = input.known!(i, j);
      if (k !== undefined) cl.add(k ? lit(i, j) : -lit(i, j));
    });
  }

  // 2. transitivity over faces sharing a common region
  pairs.forEach(([i, j], v) => {
    const oij = overlaps[v];
    for (const k of neighbors[i]) {
      if (k <= j) continue;
      if (varOf.get(j * n + k) === undefined) continue;
      const o = clipConvex(oij, input.polys[k]);
      if (o.length < 3 || Math.abs(signedArea(o)) < AREA_EPS) continue;
      const xij = lit(i, j);
      const xjk = lit(j, k);
      const xik = lit(i, k);
      cl.add(-xij, -xjk, xik);
      cl.add(xij, xjk, -xik);
    }
  });

  // 3. taco-tortilla
  for (const f of input.folded) {
    const len = Math.hypot(f.p1[0] - f.p0[0], f.p1[1] - f.p0[1]);
    for (const c of neighbors[f.a]) {
      if (c === f.b) continue;
      const la = lit(c, f.a);
      const lb = lit(c, f.b);
      if (la === 0 || lb === 0) continue;
      const r = segmentInside(input.polys[c], f.p0, f.p1, 10 * EPS);
      if (!r || (r[1] - r[0]) * len < 10 * EPS) continue;
      cl.add(-la, lb);
      cl.add(la, -lb);
    }
  }

  // 4b. flat joints: tortilla against folds, and tortilla-tortilla
  const joints = input.joints ?? [];
  const sideOfFace = (f: number, p0: Vec2, d: Vec2) => Math.sign(cross2(d, sub2(centroid(input.polys[f]), p0)));
  for (const f of input.folded) {
    const d = normalize2(sub2(f.p1, f.p0));
    const sa = sideOfFace(f.a, f.p0, d);
    for (const j of joints) {
      if (!collinearOverlap(f.p0, f.p1, j.p0, j.p1)) continue;
      const c = sideOfFace(j.a, f.p0, d) === sa ? j.a : j.b;
      if (c === f.a || c === f.b) continue;
      const la = lit(c, f.a);
      const lb = lit(c, f.b);
      if (la === 0 || lb === 0) continue;
      cl.add(-la, lb);
      cl.add(la, -lb);
    }
  }
  for (let x = 0; x < joints.length; x++) {
    const e = joints[x];
    const d = normalize2(sub2(e.p1, e.p0));
    const se = sideOfFace(e.a, e.p0, d);
    for (let y = x + 1; y < joints.length; y++) {
      const g = joints[y];
      if (!collinearOverlap(e.p0, e.p1, g.p0, g.p1)) continue;
      const sameSide = sideOfFace(g.a, e.p0, d) === se;
      const c = sameSide ? g.a : g.b; // same side as e.a
      const dd = sameSide ? g.b : g.a; // same side as e.b
      if (new Set([e.a, e.b, c, dd]).size < 4) continue;
      const l1 = lit(e.a, c);
      const l2 = lit(e.b, dd);
      if (l1 === 0 || l2 === 0) continue;
      cl.add(-l1, l2);
      cl.add(l1, -l2);
    }
  }

  // 4. taco-taco (same side only)
  for (let x = 0; x < input.folded.length; x++) {
    const e = input.folded[x];
    const d = normalize2(sub2(e.p1, e.p0));
    const L = Math.hypot(e.p1[0] - e.p0[0], e.p1[1] - e.p0[1]);
    const sideA = Math.sign(cross2(d, sub2(centroid(input.polys[e.a]), e.p0)));
    for (let y = x + 1; y < input.folded.length; y++) {
      const g = input.folded[y];
      if (Math.abs(cross2(d, sub2(g.p0, e.p0))) > 10 * EPS || Math.abs(cross2(d, sub2(g.p1, e.p0))) > 10 * EPS) continue;
      const t0 = dot2(d, sub2(g.p0, e.p0));
      const t1 = dot2(d, sub2(g.p1, e.p0));
      if (Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) < 10 * EPS) continue;
      const sideC = Math.sign(cross2(d, sub2(centroid(input.polys[g.a]), e.p0)));
      if (sideA !== sideC) continue;
      const fs = [e.a, e.b, g.a, g.b];
      if (new Set(fs).size < 4) continue;
      const l1 = lit(g.a, e.a), l2 = lit(g.a, e.b), l3 = lit(g.b, e.a), l4 = lit(g.b, e.b);
      if (!l1 || !l2 || !l3 || !l4) continue;
      // forbid odd parity of the four
      const ls = [l1, l2, l3, l4];
      for (let mask = 0; mask < 16; mask++) {
        let parity = 0;
        for (let q = 0; q < 4; q++) parity ^= (mask >> q) & 1;
        if (parity === 0) continue;
        // assignment: bit q set => literal q true. Clause negates it.
        cl.add(...ls.map((l, q) => ((mask >> q) & 1 ? -l : l)));
      }
    }
  }

  const prefer = input.prefer;
  const assignment = dpll(
    pairs.length,
    cl.lits,
    (v) => {
      const [i, j] = pairs[v];
      const p = prefer ? prefer(i, j) : undefined;
      return p === undefined ? true : p;
    },
    input.maxConflicts ?? 20000,
  );
  if (!assignment) {
    return { ...empty, ok: false, reason: 'no physically possible layer order', pairCount: pairs.length };
  }

  const above = new Map<number, boolean>();
  const up: number[][] = Array.from({ length: n }, () => []); // lower -> upper
  const indeg = new Int32Array(n);
  pairs.forEach(([i, j], v) => {
    const iAbove = assignment[v] > 0;
    above.set(i * n + j, iAbove);
    const lo = iAbove ? j : i;
    const hi = iAbove ? i : j;
    up[lo].push(hi);
    indeg[hi]++;
  });

  // longest path ranks
  const ranks = new Array<number>(n).fill(0);
  const done = new Uint8Array(n);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  let processed = 0;
  let cyclic = false;
  for (;;) {
    while (queue.length) {
      const f = queue.shift()!;
      done[f] = 1;
      processed++;
      for (const g of up[f]) {
        ranks[g] = Math.max(ranks[g], ranks[f] + 1);
        if (--indeg[g] === 0) queue.push(g);
      }
    }
    if (processed === n) break;
    cyclic = true;
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || indeg[i] < indeg[pick])) pick = i;
    indeg[pick] = 0;
    queue.push(pick);
  }

  return { ok: true, above, ranks, pairCount: pairs.length, cyclic };
}

function collinearOverlap(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean {
  const d = normalize2(sub2(a1, a0));
  const L = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
  if (Math.abs(cross2(d, sub2(b0, a0))) > 10 * EPS || Math.abs(cross2(d, sub2(b1, a0))) > 10 * EPS) return false;
  const t0 = dot2(d, sub2(b0, a0));
  const t1 = dot2(d, sub2(b1, a0));
  return Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) > 10 * EPS;
}
