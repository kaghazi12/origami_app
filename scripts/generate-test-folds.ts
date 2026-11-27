/**
 * Generates the six test FOLD files in src/designs (01_…06_) from their mathematical
 * construction, and refuses to write any file the engine can't prove correct.
 *
 * Run:  npm run generate:test-folds
 *
 * Each file is checked before it's written:
 * - prepareFold finds nothing to repair and nothing impossible (Kawasaki/Maekawa for flat folds)
 * - the exact folder folds it: flat patterns get a valid layer order; 3D targets close up with no
 *   tearing (every crease at its angle, faces rigid)
 */
import fs from 'fs';
import path from 'path';
import type { EdgeAssignment, FoldFormat } from '../src/engine/types';
import { extractPlanarFaces } from '../src/engine/fold/faces';
import { prepareFold } from '../src/engine/fold/prepare';
import { createMiuraOriPattern, computeMiuraCoupledAngles } from '../src/engine/fold/templates';
import { foldCreasePattern } from '../src/engine/design/creasePattern';

type Vec = [number, number];
/** Run from the app root (npm run generate:test-folds). */
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'src/designs');
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------- geometry: lines -> crease pattern

interface Line { id: number; a: Vec; b: Vec; }
interface BuiltEdge { u: number; v: number; line: number; mid: Vec; }

/** Clip the infinite line through p with direction d to the rectangle [0,W]x[0,H]. */
function clipLine(p: Vec, d: Vec, W: number, H: number): [Vec, Vec] | null {
  let t0 = -Infinity, t1 = Infinity;
  const lims: [number, number, number][] = [[p[0], d[0], W], [p[1], d[1], H]];
  for (const [p0, dd, max] of lims) {
    if (Math.abs(dd) < 1e-15) { if (p0 < -1e-12 || p0 > max + 1e-12) return null; continue; }
    let a = (0 - p0) / dd, b = (max - p0) / dd;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  if (t1 - t0 < 1e-9) return null;
  return [[p[0] + d[0] * t0, p[1] + d[1] * t0], [p[0] + d[0] * t1, p[1] + d[1] * t1]];
}

/** Clip the ray (t >= 0) or line through p with direction d to a convex polygon (CCW). */
function clipToConvex(p: Vec, d: Vec, poly: Vec[], ray = false): [Vec, Vec] | null {
  let t0 = ray ? 0 : -Infinity, t1 = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const n: Vec = [b[1] - a[1], a[0] - b[0]]; // outward normal for a CCW polygon
    const num = n[0] * (a[0] - p[0]) + n[1] * (a[1] - p[1]);
    const den = n[0] * d[0] + n[1] * d[1];
    if (Math.abs(den) < 1e-15) { if (num < -1e-12) return null; continue; }
    const t = num / den;
    if (den > 0) t1 = Math.min(t1, t); else t0 = Math.max(t0, t);
  }
  if (t1 - t0 < 1e-9) return null;
  return [[p[0] + d[0] * t0, p[1] + d[1] * t0], [p[0] + d[0] * t1, p[1] + d[1] * t1]];
}

/** Planar graph from line segments plus the rectangle's boundary: all crossings become vertices. */
function buildFromLines(lines: Line[], W: number, H: number) {
  return buildInPolygon(lines, [[0, 0], [W, 0], [W, H], [0, H]]);
}

/** Planar graph from line segments plus a polygon outline (the paper): all crossings become vertices. */
function buildInPolygon(lines: Line[], poly: Vec[]) {
  const segs: Line[] = [
    ...lines,
    ...poly.map((a, i): Line => ({ id: -1, a, b: poly[(i + 1) % poly.length] })),
  ];
  const verts: Vec[] = [];
  const index = new Map<string, number>();
  const vid = (p: Vec) => {
    const k = `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`;
    let i = index.get(k);
    if (i === undefined) { i = verts.length; verts.push([p[0], p[1]]); index.set(k, i); }
    return i;
  };
  const along: { t: number; v: number }[][] = segs.map((s) => [{ t: 0, v: vid(s.a) }, { t: 1, v: vid(s.b) }]);
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const p = segs[i].a, r: Vec = [segs[i].b[0] - p[0], segs[i].b[1] - p[1]];
    const q = segs[j].a, s: Vec = [segs[j].b[0] - q[0], segs[j].b[1] - q[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-14) continue;
    const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
    const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
    const e = 1e-9;
    if (t < -e || t > 1 + e || u < -e || u > 1 + e) continue;
    const v = vid([p[0] + t * r[0], p[1] + t * r[1]]);
    along[i].push({ t, v }); along[j].push({ t: u, v });
  }
  const edges: BuiltEdge[] = [];
  const seen = new Set<string>();
  segs.forEach((s, i) => {
    const pts = along[i].sort((x, y) => x.t - y.t);
    for (let k = 0; k + 1 < pts.length; k++) {
      const u = pts[k].v, v = pts[k + 1].v;
      if (u === v) continue;
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ u, v, line: s.id, mid: [(verts[u][0] + verts[v][0]) / 2, (verts[u][1] + verts[v][1]) / 2] });
    }
  });
  return { verts, edges };
}

function toFold(
  meta: Record<string, unknown>,
  verts: Vec[],
  edges: BuiltEdge[],
  assign: (e: BuiltEdge) => EdgeAssignment,
  angle: (e: BuiltEdge, a: EdgeAssignment) => number,
): FoldFormat {
  const edges_assignment = edges.map((e) => (e.line === -1 ? 'B' : assign(e)));
  const fold: FoldFormat = {
    file_spec: 1.1,
    ...(meta as object),
    vertices_coords: verts.map((p) => [round(p[0]), round(p[1])]) as [number, number][],
    edges_vertices: edges.map((e) => [e.u, e.v]),
    edges_assignment,
    edges_foldAngle: edges.map((e, i) => (edges_assignment[i] === 'M' || edges_assignment[i] === 'V' ? angle(e, edges_assignment[i]) : 0)),
  } as FoldFormat;
  fold.faces_vertices = extractPlanarFaces(fold);
  return fold;
}

const round = (x: number) => Math.round(x * 1e12) / 1e12;

// ---------------------------------------------------------------- checks

function exactFold(fold: FoldFormat) {
  return foldCreasePattern({
    vertices_coords: fold.vertices_coords as number[][],
    edges_vertices: fold.edges_vertices,
    edges_assignment: fold.edges_assignment,
    edges_foldAngle: fold.edges_foldAngle,
    faces_vertices: fold.faces_vertices!,
  }, { layerGap: 0 });
}

function verify(name: string, fold: FoldFormat) {
  const { report } = prepareFold(JSON.parse(JSON.stringify(fold)));
  const problems = report.issues.filter((i) => i.kind !== 'note');
  if (problems.length) throw new Error(`${name}: prepareFold found ${problems.map((p) => p.title).join('; ')}`);
  const ex = exactFold(fold);
  if (!ex.ok) throw new Error(`${name}: the exact folder rejects it: ${ex.reason} (tear ${ex.tear})`);
  return ex;
}

function write(file: string, fold: FoldFormat) {
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(fold, null, 1) + '\n');
}

// ---------------------------------------------------------------- 01 Miura-ori

function miura(): FoldFormat {
  // 6x6 parallelograms, 70° acute angle. In a rigid Miura fold the zigzag creases and the straight
  // creases have different angles: tan(H/2) = cos(gamma) * tan(V/2). Zigzag creases at 150°.
  const gamma = 70 / DEG;
  const base = createMiuraOriPattern(6, 6, 6, 6, 70);
  const thetaV = 150 / DEG;
  const { thetaH } = computeMiuraCoupledAngles(gamma, thetaV);
  // the template marks which creases are zigzag (vertical) and which straight (horizontal)
  const V = base.vertices_coords as number[][];
  const angles = base.edges_vertices.map(([a, b], e) => {
    const s = base.edges_assignment[e];
    if (s !== 'M' && s !== 'V') return 0;
    const horizontal = Math.abs(V[a][1] - V[b][1]) < 1e-9;
    const mag = (horizontal ? Math.abs(thetaH) : thetaV) * DEG;
    return s === 'V' ? mag : -mag;
  });
  const fold: FoldFormat = {
    ...base,
    vertices_coords: (base.vertices_coords as number[][]).map((p) => [round(p[0]), round(p[1])]) as [number, number][],
    edges_foldAngle: angles.map((x) => round(x)),
  };
  // the template's two variants of the coupling formula (which family is which) are tried, and the
  // one the exact folder accepts (no tearing) is kept
  for (const swap of [false, true]) {
    const f: FoldFormat = swap ? {
      ...fold,
      edges_foldAngle: fold.edges_vertices.map(([a, b], e) => {
        const s = fold.edges_assignment[e];
        if (s !== 'M' && s !== 'V') return 0;
        const horizontal = Math.abs(V[a][1] - V[b][1]) < 1e-9;
        const mag = (horizontal ? thetaV : Math.abs(thetaH)) * DEG;
        return round(s === 'V' ? mag : -mag);
      }),
    } : fold;
    f.faces_vertices = extractPlanarFaces(f);
    if (exactFold(f).ok) {
      return {
        ...f,
        file_creator: 'origami_app scripts/generate-test-folds.ts',
        file_title: '6x6 Miura-ori Tessellation',
        file_description: `Rigid-foldable 6x6 Miura-ori with a 70-degree parallelogram angle, partly folded: one crease family at ${(swap ? Math.abs(thetaH) : thetaV) * DEG > 149.9 ? '150' : (Math.abs(thetaH) * DEG).toFixed(1)} degrees and the other at ${(swap ? thetaV : Math.abs(thetaH)) * DEG > 149.9 ? '150' : (Math.abs(thetaH) * DEG).toFixed(1)} degrees, related by tan(a/2) = cos(70) tan(b/2), so every crease reaches its angle at once with rigid faces.`,
        file_classes: ['singleModel'],
        frame_title: 'Crease pattern, partly folded target',
        frame_classes: ['creasePattern'],
        frame_attributes: ['2D'],
      } as FoldFormat;
    }
  }
  throw new Error('01: no Miura angle assignment closes up');
}

// ---------------------------------------------------------------- 02 waterbomb tessellation

function waterbomb(): FoldFormat {
  // Waterbomb bases in offset rows on an 8x4 sheet: horizontal lines every 1, and 45° lines
  // through every lattice point with x+y even. Every inner corner is a waterbomb-base centre:
  // 2 mountain (horizontal) + 4 valley (diagonal) creases.
  const W = 8, H = 4;
  const lines: Line[] = [];
  let id = 0;
  for (let y = 1; y < H; y++) lines.push({ id: id++, a: [0, y], b: [W, y] });
  for (let c = -H; c <= W + H; c += 2) {
    for (const d of [[1, 1], [1, -1]] as Vec[]) {
      const seg = clipLine([c, 0], d, W, H);
      if (seg) lines.push({ id: id++, a: seg[0], b: seg[1] });
    }
  }
  const { verts, edges } = buildFromLines(lines, W, H);
  const horizontal = (e: BuiltEdge) => Math.abs(verts[e.u][1] - verts[e.v][1]) < 1e-9;
  const fold = toFold({
    file_creator: 'origami_app scripts/generate-test-folds.ts',
    file_title: 'Waterbomb Tessellation',
    file_description: 'Flat-foldable waterbomb tessellation: waterbomb bases in offset rows on an 8x4 sheet. Every inner corner has 6 creases (2 mountain, 4 valley) at 45/90-degree spacing.',
    file_classes: ['singleModel'],
    frame_title: 'Crease pattern',
    frame_classes: ['creasePattern'],
    frame_attributes: ['2D'],
  }, verts, edges, (e) => (horizontal(e) ? 'M' : 'V'), (_e, a) => (a === 'V' ? 180 : -180));
  return fold;
}

// ---------------------------------------------------------------- 03 Yoshimura

function yoshimura(): FoldFormat {
  // Equilateral triangles: horizontal lines every sqrt(3)/2 and lines at ±60°. Horizontal creases
  // mountain, slanted creases valley: every inner corner has 6 creases 60° apart (2 M, 4 V).
  const h = Math.sqrt(3) / 2;
  const W = 6, rows = 5, H = rows * h;
  const lines: Line[] = [];
  let id = 0;
  for (let k = 1; k < rows; k++) lines.push({ id: id++, a: [0, k * h], b: [W, k * h] });
  for (let c = -rows; c <= W + rows; c++) {
    for (const d of [[0.5, h], [-0.5, h]] as Vec[]) {
      const seg = clipLine([c, 0], d, W, H);
      if (seg) lines.push({ id: id++, a: seg[0], b: seg[1] });
    }
  }
  const { verts, edges } = buildFromLines(lines, W, H);
  const horizontal = (e: BuiltEdge) => Math.abs(verts[e.u][1] - verts[e.v][1]) < 1e-9;
  return toFold({
    file_creator: 'origami_app scripts/generate-test-folds.ts',
    file_title: '6x5 Yoshimura Pattern',
    file_description: 'Yoshimura (diamond) pattern of equilateral triangles, 6 wide and 5 rows: horizontal creases mountain, slanted creases valley. Collapses flat; not rigid-foldable, so the faces bend on the way.',
    file_classes: ['singleModel'],
    frame_title: 'Crease pattern',
    frame_classes: ['creasePattern'],
    frame_attributes: ['2D'],
  }, verts, edges, (e) => (horizontal(e) ? 'M' : 'V'), (_e, a) => (a === 'V' ? 180 : -180));
}

// ---------------------------------------------------------------- 04 square twist tessellation

function squareTwist(alphaDeg = 22.5, side = 1.2): FoldFormat {
  // Four square twists in a 2x2 grid. Each twist is a small square rotated by ALPHA relative to
  // its four pleats; the pleats run along the axes. Every corner of a square sends out one
  // horizontal and one vertical crease, so it has four creases with sectors (90-a, 90, 90+a, 90):
  // Kawasaki holds for any twist angle. Neighbouring twists turn opposite ways so their pleats
  // line up. (Pleats crossing square-on, without a twist, can't fold flat.)
  const N = 2, P = 4, W = P * N, H = P * N, s = side, ALPHA = alphaDeg / DEG;
  type T = { i: number; j: number; c: Vec; corners: Vec[] };
  const twists: T[] = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    // all twists turn the same way; each is shifted by s·sin(alpha) so its pleats meet the next
    // twist's (east neighbour at (P, s·sin a), north neighbour at (-s·sin a, P))
    // neighbouring twists turn opposite ways, so their pleats meet on straight lines
    const c: Vec = [W / 2 + (i - (N - 1) / 2) * P, H / 2 + (j - (N - 1) / 2) * P];
    const a = (i + j) % 2 ? -ALPHA : ALPHA;
    const corners = ([[1, -1], [1, 1], [-1, 1], [-1, -1]] as Vec[]).map(([x, y]): Vec => [
      c[0] + (s / 2) * (x * Math.cos(a) - y * Math.sin(a)),
      c[1] + (s / 2) * (x * Math.sin(a) + y * Math.cos(a)),
    ]);
    twists.push({ i, j, c, corners });
  }
  const at = (i: number, j: number) => twists.find((t) => t.i === i && t.j === j);
  const lines: Line[] = [];
  /** line id -> twist index, for the sides of each twist's square */
  const sideLine = new Map<number, number>();
  let id = 0;
  for (const t of twists) {
    for (let k = 0; k < 4; k++) {
      sideLine.set(id, twists.indexOf(t));
      lines.push({ id: id++, a: t.corners[k], b: t.corners[(k + 1) % 4] });
    }
    // each pleat: the two corners furthest in that direction send a ray that way
    const dirs: [Vec, number, number][] = [[[1, 0], 1, 0], [[-1, 0], -1, 0], [[0, 1], 0, 1], [[0, -1], 0, -1]];
    for (const [d, di, dj] of dirs) {
      const proj = (p: Vec) => p[0] * d[0] + p[1] * d[1];
      const two = [...t.corners].sort((p, q) => proj(q) - proj(p)).slice(0, 2);
      const next = at(t.i + di, t.j + dj);
      for (const p of two) {
        if (next) {
          // ends at the neighbour's corner on the same line (the pleats line up)
          const q = next.corners.find((x) => (d[0] ? Math.abs(x[1] - p[1]) : Math.abs(x[0] - p[0])) < 1e-9);
          if (!q) throw new Error('04: pleats of neighbouring twists do not line up');
          // add each shared pleat stretch once (from the twist with the smaller index)
          if (di + dj > 0) lines.push({ id: id++, a: p, b: q });
        } else {
          const end: Vec = d[0] ? [d[0] > 0 ? W : 0, p[1]] : [p[0], d[1] > 0 ? H : 0];
          lines.push({ id: id++, a: p, b: end });
        }
      }
    }
  }
  const { verts, edges } = buildFromLines(lines, W, H);
  const meta = {
    file_creator: 'origami_app scripts/generate-test-folds.ts',
    file_title: '2x2 Square Twist Tessellation',
    file_description: 'Four square twists in a 2x2 grid on an 8x8 sheet, each square turned 22.5 degrees against its pleats; neighbouring twists turn opposite ways, joined by straight pleats. Every inner corner has four creases (3 of one kind, 1 of the other) and the whole sheet folds flat.',
    file_classes: ['singleModel'],
    frame_title: 'Crease pattern',
    frame_classes: ['creasePattern'],
    frame_attributes: ['2D'],
  };
  const reasons = new Map<string, number>();
  // inner corners and their creases
  const isBoundaryV = new Set<number>();
  edges.forEach((e) => { if (e.line === -1) { isBoundaryV.add(e.u); isBoundaryV.add(e.v); } });
  const atV = new Map<number, number[]>();
  edges.forEach((e, i) => {
    if (e.line === -1) return;
    for (const x of [e.u, e.v]) if (!isBoundaryV.has(x)) atV.set(x, [...(atV.get(x) ?? []), i]);
  });
  // Mountain/valley, by exhaustive search. At every corner: 3 creases of one kind and 1 of the
  // other (Maekawa), and the two creases around the strictly smallest angle must differ
  // (big-little-big lemma). That leaves 4 options per corner; backtracking over the corners
  // enumerates every assignment satisfying both everywhere, and the exact folder checks each
  // for a layer order (no paper through paper).
  const corners = [...atV.entries()].map(([v, list]) => {
    const sorted = list.map((i) => {
      const e = edges[i], o = e.u === v ? e.v : e.u;
      return { i, ang: Math.atan2(verts[o][1] - verts[v][1], verts[o][0] - verts[v][0]) };
    }).sort((x, y) => x.ang - y.ang);
    const sec = sorted.map((c, k) => { let d = sorted[(k + 1) % sorted.length].ang - c.ang; if (d <= 0) d += 2 * Math.PI; return d; });
    const options: Map<number, EdgeAssignment>[] = [];
    for (const maj of ['M', 'V'] as EdgeAssignment[]) for (let odd = 0; odd < sorted.length; odd++) {
      const o = new Map<number, EdgeAssignment>();
      sorted.forEach((c, k) => o.set(c.i, k === odd ? (maj === 'M' ? 'V' : 'M') : maj));
      // big-little-big: a sector strictly smaller than both neighbours has opposite creases around it
      let ok = true;
      for (let k = 0; k < sorted.length && ok; k++) {
        const prev = sec[(k + sorted.length - 1) % sorted.length], next = sec[(k + 1) % sorted.length];
        if (sec[k] < prev - 1e-9 && sec[k] < next - 1e-9) {
          if (o.get(sorted[k].i) === o.get(sorted[(k + 1) % sorted.length].i)) ok = false;
        }
      }
      if (ok) options.push(o);
    }
    return { v, options };
  });
  const idxOf = new Map(edges.map((e, i) => [e, i]));
  const val = new Map<number, EdgeAssignment>();
  let tested = 0;
  const limit = 20000;
  const search = (k: number): FoldFormat | null => {
    if (tested >= limit) return null;
    if (k === corners.length) {
      tested++;
      const fold = toFold(meta, verts, edges, (e) => val.get(idxOf.get(e)!) ?? 'V', (_e, a) => (a === 'V' ? 180 : -180));
      const ex = exactFold(fold);
      if (ex.ok) return fold;
      reasons.set(ex.reason ?? '?', (reasons.get(ex.reason ?? '?') ?? 0) + 1);
      return null;
    }
    for (const o of corners[k].options) {
      const added: number[] = [];
      let ok = true;
      for (const [i, a] of o) {
        if (val.has(i)) { if (val.get(i) !== a) { ok = false; break; } } else { val.set(i, a); added.push(i); }
      }
      if (ok) { const r = search(k + 1); if (r) return r; }
      for (const i of added) val.delete(i);
    }
    return null;
  };
  const found = search(0);
  if (found) return found;

  throw new Error(`04: no flat-foldable assignment found (${[...reasons].map(([k, n]) => `${n}x ${k}`).join('; ')}; ${verts.length} vertices, ${edges.length} edges)`);
}


// ---------------------------------------------------------------- 05 bird base (multi-frame)

function birdBase(): FoldFormat {
  // The verified bird base (crease pattern + folded frame with face orders), on a 2x2 sheet.
  const src = JSON.parse(fs.readFileSync(path.join(OUT, 'bird-base.fold'), 'utf8'));
  const k = 2;
  const scale = (vs: number[][]) => vs.map((p) => p.map((x) => round(x * k)));
  return {
    ...src,
    file_creator: 'origami_app scripts/generate-test-folds.ts',
    file_title: 'Bird Base Multi-Frame Model',
    file_description: 'Multi-frame FOLD file: frame 0 is the bird base crease pattern (a preliminary base with a petal fold on each side; F = precreases), frame 1 the folded bird base in 3D with faceOrders. The centre has 3 mountain and 5 valley creases, as a flat fold needs.',
    vertices_coords: scale(src.vertices_coords),
    file_frames: src.file_frames.map((f: Record<string, unknown>) => ({ ...f, vertices_coords: scale(f.vertices_coords as number[][]) })),
  };
}

// ---------------------------------------------------------------- 06 hyperbolic paraboloid

/** Rotation about x by r, then about z by a (3x3, row-major). */
function rotXZ(r: number, a: number): number[] {
  const cr = Math.cos(r), sr = Math.sin(r), ca = Math.cos(a), sa = Math.sin(a);
  // Rx(r) * Rz(a)
  return [ca, -sa, 0, cr * sa, cr * ca, -sr, sr * sa, sr * ca, cr];
}
const mul3 = (A: number[], B: number[]) => {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
  return C;
};

/** Solve a dense linear system (Gaussian elimination with partial pivoting). */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-30;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-30));
}

/**
 * Rigid folding: find fold angles so the paper closes up around every inner corner
 * (product of the rotations about its creases = identity; Belcastro & Hull), with one crease
 * held at a given angle. Levenberg–Marquardt with a numerical Jacobian.
 */
function closeUp(fold: FoldFormat, free: number[], held: number, heldAngle: number, start: number[]): { angles: number[]; residual: number } {
  const V = fold.vertices_coords as number[][];
  const E = fold.edges_vertices;
  const A = fold.edges_assignment;
  const corners: { e: number; phi: number }[][] = [];
  const inc: { e: number; phi: number }[][] = V.map(() => []);
  let boundary = new Set<number>();
  E.forEach(([a, b], e) => {
    if (A[e] === 'B') { boundary.add(a); boundary.add(b); return; }
    inc[a].push({ e, phi: Math.atan2(V[b][1] - V[a][1], V[b][0] - V[a][0]) });
    inc[b].push({ e, phi: Math.atan2(V[a][1] - V[b][1], V[a][0] - V[b][0]) });
  });
  inc.forEach((l, i) => { if (!boundary.has(i) && l.length) corners.push(l.sort((x, y) => x.phi - y.phi)); });
  const residual = (ang: number[]) => {
    const r: number[] = [];
    for (const c of corners) {
      let M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      for (let k = 0; k < c.length; k++) {
        let a = c[(k + 1) % c.length].phi - c[k].phi;
        if (a <= 0) a += 2 * Math.PI;
        M = mul3(M, rotXZ(ang[c[k].e], a));
      }
      r.push(M[0] - 1, M[1], M[2], M[3], M[4] - 1, M[5], M[6], M[7], M[8] - 1);
    }
    return r;
  };
  const ang = start.slice();
  ang[held] = heldAngle;
  let lambda = 1e-3;
  const norm = (r: number[]) => Math.sqrt(r.reduce((s, x) => s + x * x, 0));
  let r = residual(ang);
  for (let it = 0; it < 200 && norm(r) > 1e-13; it++) {
    const J: number[][] = r.map(() => new Array(free.length).fill(0));
    free.forEach((e, j) => {
      const h = 1e-7, save = ang[e];
      ang[e] = save + h; const rp = residual(ang);
      ang[e] = save - h; const rm = residual(ang);
      ang[e] = save;
      for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - rm[i]) / (2 * h);
    });
    const JtJ = free.map((_, a) => free.map((_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const Jtr = free.map((_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    for (;;) {
      const lhs = JtJ.map((row, a) => row.map((x, b) => x + (a === b ? lambda * (1 + x) : 0)));
      const step = solveLinear(lhs, Jtr.map((x) => -x));
      const trial = ang.slice();
      free.forEach((e, j) => (trial[e] += step[j]));
      const rt = residual(trial);
      if (norm(rt) < norm(r)) { free.forEach((e) => (ang[e] = trial[e])); r = rt; lambda = Math.max(1e-12, lambda / 3); break; }
      lambda *= 4;
      if (lambda > 1e8) return { angles: ang, residual: norm(r) };
    }
  }
  return { angles: ang, residual: norm(r) };
}

function hypar(): FoldFormat {
  // Concentric squares (alternating mountain/valley) plus both diagonals, on a 10x10 sheet. The
  // classic hypar can't fold without bending its faces, so each trapezoid gets one more crease
  // (the triangulated hypar). The fold angles are then solved so every corner closes up exactly:
  // a real rigid folded state, not a guess.
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'origami-fold-engine/fixtures/invalid/06_hypar_concentric_5ring.fold'), 'utf8'));
  const V = (src.vertices_coords as number[][]).map((p) => [p[0] + 5, p[1] + 5]); // corner at the origin
  for (const variant of [0, 1, 2, 3]) {
    const edges_vertices: [number, number][] = src.edges_vertices.map((e: number[]) => [e[0], e[1]]);
    const edges_assignment: EdgeAssignment[] = [...src.edges_assignment];
    // triangulate each quad: faces are [inner a, inner b, outer b, outer a]
    (src.faces_vertices as number[][]).forEach((f, fi) => {
      if (f.length !== 4) return;
      const ring = Math.floor(fi / 4), side = fi % 4;
      // variant: which diagonal of the trapezoid, alternating by ring and/or side
      const flip = variant === 0 ? 0 : variant === 1 ? ring % 2 : variant === 2 ? side % 2 : (ring + side) % 2;
      edges_vertices.push(flip ? [f[0], f[2]] : [f[1], f[3]]);
      edges_assignment.push('F');
    });
    const base: FoldFormat = { file_spec: 1.1, vertices_coords: V as [number, number][], edges_vertices, edges_assignment } as FoldFormat;
    base.faces_vertices = extractPlanarFaces(base);
    const n = edges_vertices.length;
    const free = [...Array(n).keys()].filter((e) => edges_assignment[e] !== 'B');
    // the innermost square's crease is the driver; fold it gradually and let the rest follow
    const held = edges_vertices.findIndex(([a, b]) => (a === 1 && b === 2) || (a === 2 && b === 1));
    let angles = edges_assignment.map((a, e) => (a === 'M' ? -1 : a === 'V' ? 1 : 0) * 0.02 * (e === held ? 1 : 1));
    let ok = true;
    const sign = edges_assignment[held] === 'M' ? -1 : 1;
    for (let deg = 2; deg <= 100; deg += 2) {
      const res = closeUp(base, free.filter((e) => e !== held), held, (sign * deg) / DEG, angles);
      if (res.residual > 1e-10) { ok = false; break; }
      // predictor: extrapolate along the path
      const prev = angles;
      angles = res.angles.map((x, i) => x + (x - prev[i]) * 0.0);
    }
    if (!ok) continue;
    // mountain/valley from the solved angles; creases that stay flat in the rigid fold are F
    const asg = edges_assignment.map((a, e) => {
      if (a === 'B') return 'B';
      const d = angles[e] * DEG;
      if (Math.abs(d) < 0.5) return 'F';
      return d > 0 ? 'V' : 'M';
    }) as EdgeAssignment[];
    const fold: FoldFormat = {
      file_spec: 1.1,
      file_creator: 'origami_app scripts/generate-test-folds.ts',
      file_title: 'Concentric Hyperbolic Paraboloid (Hypar)',
      file_description: 'Triangulated hypar: 5 concentric squares (alternating mountain and valley) and both diagonals, with one extra crease across each trapezoid so it can fold without bending. The fold angles are solved so every corner closes up exactly (a real rigid folded state); creases that stay flat in that state are F.',
      file_classes: ['singleModel'],
      frame_title: 'Crease pattern, partly folded target',
      frame_classes: ['creasePattern'],
      frame_attributes: ['2D'],
      vertices_coords: V.map((p) => [round(p[0]), round(p[1])]) as [number, number][],
      edges_vertices,
      edges_assignment: asg,
      edges_foldAngle: angles.map((x, e) => (asg[e] === 'M' || asg[e] === 'V' ? round(x * DEG) : 0)),
    } as FoldFormat;
    fold.faces_vertices = extractPlanarFaces(fold);
    if (exactFold(fold).ok) return fold;
  }
  throw new Error('06: no triangulation of the hypar folds rigidly');
}

// ---------------------------------------------------------------- shared: flat-fold assignment search

/**
 * Find a mountain/valley assignment that folds flat. At every inner corner: |M − V| = 2
 * (Maekawa) and the creases around any sector strictly smaller than both neighbours differ
 * (big-little-big). Backtracking over corners enumerates every such assignment; the exact folder
 * must find a layer order for the one that is kept.
 */
function searchFlat(meta: Record<string, unknown>, verts: Vec[], edges: BuiltEdge[], limit = 20000): FoldFormat {
  const isBoundaryV = new Set<number>();
  edges.forEach((e) => { if (e.line === -1) { isBoundaryV.add(e.u); isBoundaryV.add(e.v); } });
  const atV = new Map<number, number[]>();
  edges.forEach((e, i) => {
    if (e.line === -1) return;
    for (const x of [e.u, e.v]) if (!isBoundaryV.has(x)) atV.set(x, [...(atV.get(x) ?? []), i]);
  });
  const corners = [...atV.entries()].map(([v, list]) => {
    const sorted = list.map((i) => {
      const e = edges[i], o = e.u === v ? e.v : e.u;
      return { i, ang: Math.atan2(verts[o][1] - verts[v][1], verts[o][0] - verts[v][0]) };
    }).sort((x, y) => x.ang - y.ang);
    const n = sorted.length;
    const sec = sorted.map((c, k) => { let d = sorted[(k + 1) % n].ang - c.ang; if (d <= 0) d += 2 * Math.PI; return d; });
    const options: Map<number, EdgeAssignment>[] = [];
    for (let mask = 0; mask < 1 << n; mask++) {
      let m = 0;
      for (let k = 0; k < n; k++) if ((mask >> k) & 1) m++;
      if (Math.abs(m - (n - m)) !== 2) continue;
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        if (sec[k] < sec[(k + n - 1) % n] - 1e-9 && sec[k] < sec[(k + 1) % n] - 1e-9) {
          if (((mask >> k) & 1) === ((mask >> ((k + 1) % n)) & 1)) ok = false;
        }
      }
      if (!ok) continue;
      const o = new Map<number, EdgeAssignment>();
      sorted.forEach((c, k) => o.set(c.i, (mask >> k) & 1 ? 'M' : 'V'));
      options.push(o);
    }
    return options;
  });
  const idxOf = new Map(edges.map((e, i) => [e, i]));
  const val = new Map<number, EdgeAssignment>();
  const reasons = new Map<string, number>();
  let tested = 0;
  const search = (k: number): FoldFormat | null => {
    if (tested >= limit) return null;
    if (k === corners.length) {
      tested++;
      // creases touching no inner corner (edge to edge) are free: try valley
      const fold = toFold(meta, verts, edges, (e) => val.get(idxOf.get(e)!) ?? 'V', (_e, a) => (a === 'V' ? 180 : -180));
      const ex = exactFold(fold);
      if (ex.ok) return fold;
      reasons.set(ex.reason ?? '?', (reasons.get(ex.reason ?? '?') ?? 0) + 1);
      return null;
    }
    for (const o of corners[k]) {
      const added: number[] = [];
      let ok = true;
      for (const [i, a] of o) {
        if (val.has(i)) { if (val.get(i) !== a) { ok = false; break; } } else { val.set(i, a); added.push(i); }
      }
      if (ok) { const r = search(k + 1); if (r) return r; }
      for (const i of added) val.delete(i);
    }
    return null;
  };
  const found = search(0);
  if (found) return found;
  const dead = [...atV.keys()].filter((_, k) => corners[k].length === 0).map((v) => {
    const list = atV.get(v)!.map((i) => { const e = edges[i], o = e.u === v ? e.v : e.u; return Math.atan2(verts[o][1] - verts[v][1], verts[o][0] - verts[v][0]) * DEG; }).sort((x, y) => x - y);
    return `(${verts[v].map((x) => x.toFixed(3)).join(',')}) creases at ${list.map((x) => x.toFixed(1)).join('/')}`;
  });
  throw new Error(`no flat-foldable assignment (${tested} tried: ${[...reasons].map(([r, n]) => `${n}x ${r}`).join('; ')})${dead.length ? `; corners with no option: ${dead.join('; ')}` : ''}`);
}

/** Solve a partial rigid fold: hold one crease at `targetDeg` (ramped up from 2°) and close up every corner. */
function rigidPartial(base: FoldFormat, held: number, targetDeg: number): number[] {
  const n = base.edges_vertices.length;
  const free = [...Array(n).keys()].filter((e) => base.edges_assignment[e] !== 'B' && e !== held);
  const sign = base.edges_assignment[held] === 'M' ? -1 : 1;
  let angles = base.edges_assignment.map((a) => (a === 'M' ? -0.02 : a === 'V' ? 0.02 : 0));
  const steps = Math.ceil(Math.abs(targetDeg) / 2);
  for (let k = 1; k <= steps; k++) {
    const deg = (Math.abs(targetDeg) * k) / steps;
    const res = closeUp(base, free, held, (sign * deg) / DEG, angles);
    if (res.residual > 1e-10) throw new Error(`the corners don't close up at ${deg.toFixed(1)} degrees`);
    angles = res.angles;
  }
  return angles;
}

const meta0 = (title: string, description: string, frameTitle = 'Crease pattern') => ({
  file_creator: 'origami_app scripts/generate-test-folds.ts',
  file_title: title,
  file_description: description,
  file_classes: ['singleModel'],
  frame_title: frameTitle,
  frame_classes: ['creasePattern'],
  frame_attributes: ['2D'],
});

// ---------------------------------------------------------------- 07 generic degree-4 vertex, partly folded

function genericVertex(): FoldFormat {
  // One corner off the middle of a square sheet, four creases with sectors 37°, 101°, 143°, 79°
  // (37 + 143 = 101 + 79 = 180: Kawasaki). A degree-4 corner folds rigidly with one degree of
  // freedom: the creases' angles are solved with one held at 63.7°.
  const c: Vec = [0.43, 0.56];
  const start = 17, sectors = [37, 101, 143, 79];
  const lines: Line[] = [];
  let phi = start;
  sectors.forEach((sct, k) => {
    const d: Vec = [Math.cos(phi / DEG), Math.sin(phi / DEG)];
    const seg = clipToConvex(c, d, [[0, 0], [1, 0], [1, 1], [0, 1]], true)!;
    lines.push({ id: k, a: seg[0], b: seg[1] });
    phi += sct;
  });
  const { verts, edges } = buildFromLines(lines, 1, 1);
  // M/V for this corner: the smallest sector (37°) has opposite creases around it, 3 + 1
  const asg0: EdgeAssignment[] = ['M', 'V', 'V', 'V'];
  const meta = meta0(
    'Generic Degree-4 Vertex',
    'One corner with four creases at irregular angles (sectors 37, 101, 143 and 79 degrees; 37 + 143 = 101 + 79 = 180). Partly folded rigidly: one crease held at 63.7 degrees and the other three solved so the corner closes up exactly.',
    'Crease pattern, partly folded target',
  );
  let base = toFold(meta, verts, edges, (e) => asg0[e.line], (_e, a) => (a === 'V' ? 180 : -180));
  const held = base.edges_assignment.findIndex((a, e) => a !== 'B' && edges[e].line === 0);
  const angles = rigidPartial(base, held, 63.7);
  base = { ...base, edges_foldAngle: angles.map((x, e) => (base.edges_assignment[e] === 'B' ? 0 : round(x * DEG))) };
  return base;
}

// ---------------------------------------------------------------- 08 slanted pleats at an odd angle

function slantedPleats(): FoldFormat {
  // Seven parallel creases slanted 17° off vertical on a 1 x 0.7 sheet, alternating mountain and
  // valley, each folded to 72.5°: a pleat (accordion) at an angle that isn't 45 or 90.
  const W = 1, H = 0.7, tilt = 17 / DEG;
  const d: Vec = [Math.sin(tilt), Math.cos(tilt)];
  const lines: Line[] = [];
  for (let k = 0; k < 7; k++) {
    const x = 0.14 + k * 0.12;
    const seg = clipLine([x, H / 2], d, W, H)!;
    lines.push({ id: k, a: seg[0], b: seg[1] });
  }
  const { verts, edges } = buildFromLines(lines, W, H);
  return toFold(
    meta0('Slanted Pleats', 'Seven parallel creases slanted 17 degrees off vertical on a 1 x 0.7 sheet, alternating mountain and valley, each folded to 72.5 degrees.', 'Crease pattern, partly folded target'),
    verts, edges, (e) => (e.line % 2 ? 'M' : 'V'), (_e, a) => (a === 'V' ? 72.5 : -72.5),
  );
}

// ---------------------------------------------------------------- 09 Miura-ori with a 57.3° parallelogram

function miuraOdd(): FoldFormat {
  // 5x4 Miura-ori with a 57.3° parallelogram angle, partly folded: one crease family at 37.1°, the
  // other at the coupled angle (tan(a/2) = cos(gamma) tan(b/2)), so every crease reaches its angle.
  const gammaDeg = 57.3, gamma = gammaDeg / DEG, thetaV = 37.1 / DEG;
  const base = createMiuraOriPattern(5, 4, 5, 4, gammaDeg);
  const { thetaH } = computeMiuraCoupledAngles(gamma, thetaV);
  const V = base.vertices_coords as number[][];
  for (const swap of [false, true]) {
    const f: FoldFormat = {
      ...base,
      vertices_coords: V.map((p) => [round(p[0]), round(p[1])]) as [number, number][],
      edges_foldAngle: base.edges_vertices.map(([a, b], e) => {
        const s = base.edges_assignment[e];
        if (s !== 'M' && s !== 'V') return 0;
        const horizontal = Math.abs(V[a][1] - V[b][1]) < 1e-9;
        const mag = (horizontal !== swap ? Math.abs(thetaH) : thetaV) * DEG;
        return round(s === 'V' ? mag : -mag);
      }),
    };
    f.faces_vertices = extractPlanarFaces(f);
    if (exactFold(f).ok) {
      const a = (horizontal: boolean) => ((horizontal !== swap ? Math.abs(thetaH) : thetaV) * DEG).toFixed(2);
      return {
        ...f,
        ...meta0(
          'Miura-ori, 57.3 Degree Parallelogram',
          `5x4 Miura-ori with a 57.3-degree parallelogram angle, partly folded: straight creases at ${a(true)} degrees and zigzag creases at ${a(false)} degrees (tan(a/2) = cos(57.3) tan(b/2)), so every crease reaches its angle with rigid faces.`,
          'Crease pattern, partly folded target',
        ),
      } as FoldFormat;
    }
  }
  throw new Error('no Miura angle assignment closes up');
}

// ---------------------------------------------------------------- 10 square twists at 31.7°

function squareTwistOdd(): FoldFormat {
  const f = squareTwist(31.7, 1.0);
  return {
    ...f,
    file_title: '2x2 Square Twist Tessellation, 31.7 Degrees',
    file_description: 'Four square twists in a 2x2 grid on an 8x8 sheet, each square turned 31.7 degrees against its pleats (squares 1.0 wide); neighbouring twists turn opposite ways. Every inner corner has sectors 58.3, 90, 121.7 and 90 degrees and the sheet folds flat.',
  };
}

// ---------------------------------------------------------------- 11 rabbit ear on a scalene triangle

function rabbitEar(): FoldFormat {
  // A triangle of paper with angles 47°, 61°, 72°. The three angle bisectors meet at the incentre;
  // a fourth crease runs from the incentre at right angles to the side P0–P1. Going round the
  // incentre the sectors are 90 − A/2, 90 − B/2, 90 + A/2, 90 + B/2, so Kawasaki holds for any
  // triangle.
  const A = 47 / DEG, B = 61 / DEG;
  const P0: Vec = [0, 0], P1: Vec = [1, 0];
  // third corner from the angles at P0 and P1
  const t = Math.sin(B) / Math.sin(Math.PI - A - B); // |P0 P2| by the sine rule (|P0 P1| = 1)
  const P2: Vec = [t * Math.cos(A), t * Math.sin(A)];
  const la = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]), lb = t, lc = 1; // opposite P0, P1, P2
  const I: Vec = [(la * P0[0] + lb * P1[0] + lc * P2[0]) / (la + lb + lc), (la * P0[1] + lb * P1[1] + lc * P2[1]) / (la + lb + lc)];
  const foot: Vec = [I[0], 0]; // perpendicular to the side P0 P1
  const lines: Line[] = [
    { id: 0, a: I, b: P0 }, { id: 1, a: I, b: P1 }, { id: 2, a: I, b: P2 }, { id: 3, a: I, b: foot },
  ];
  const { verts, edges } = buildInPolygon(lines, [P0, P1, P2]);
  return searchFlat(
    meta0('Rabbit Ear on a Scalene Triangle', 'A triangle of paper with angles 47, 61 and 72 degrees: the three angle bisectors meet at the incentre, and a fourth crease runs from there at right angles to one side. Folds flat into the classic rabbit ear.'),
    verts, edges,
  );
}

// ---------------------------------------------------------------- 12 triangle twist on a hexagon

function triangleTwist(): FoldFormat {
  // An equilateral triangle turned 41.3° against its three pleats, on a regular hexagon of paper.
  // Each triangle corner sends out two creases 120° apart, so its sectors are 60, 90 − a, 120,
  // 90 + a: Kawasaki holds for any twist angle. It must be over 30°: below that the 60° sector
  // is the smallest at every corner, so (big-little-big) the two triangle sides at each corner
  // would have to differ, which three sides can't do.
  const R = 1, r = 0.22, alpha = 41.3 / DEG;
  const hex: Vec[] = [...Array(6).keys()].map((k) => [R * Math.cos((k * 60) / DEG), R * Math.sin((k * 60) / DEG)]);
  const tri: Vec[] = [90, 210, 330].map((a) => [r * Math.cos(a / DEG + alpha), r * Math.sin(a / DEG + alpha)]);
  const lines: Line[] = [];
  let id = 0;
  for (let k = 0; k < 3; k++) lines.push({ id: id++, a: tri[k], b: tri[(k + 1) % 3] });
  // pleats point along the side normals of the untwisted triangle; the two corners furthest
  // along each one send a crease that way
  for (const deg of [30, 150, 270]) {
    const d: Vec = [Math.cos(deg / DEG), Math.sin(deg / DEG)];
    const two = [...tri].sort((p, q) => (q[0] * d[0] + q[1] * d[1]) - (p[0] * d[0] + p[1] * d[1])).slice(0, 2);
    for (const p of two) {
      const seg = clipToConvex(p, d, hex, true)!;
      lines.push({ id: id++, a: seg[0], b: seg[1] });
    }
  }
  const { verts, edges } = buildInPolygon(lines, hex);
  // move the hexagon so its corner box starts at the origin
  const minX = Math.min(...verts.map((p) => p[0])), minY = Math.min(...verts.map((p) => p[1]));
  const shifted = verts.map((p): Vec => [p[0] - minX, p[1] - minY]);
  return searchFlat(
    meta0('Triangle Twist on a Hexagon', 'An equilateral triangle turned 41.3 degrees against its three pleats, on a regular hexagon of paper. Each corner of the triangle has sectors of 60, 48.7, 120 and 131.3 degrees, and the sheet folds flat.'),
    shifted, edges,
  );
}

// ---------------------------------------------------------------- main

const builders: [string, () => FoldFormat][] = [
  ['01_miura_ori_6x6.fold', miura],
  ['02_waterbomb_tessellation_4x4.fold', waterbomb],
  ['03_yoshimura_buckling_6x5.fold', yoshimura],
  ['04_square_twist_2x2.fold', squareTwist],
  ['05_bird_base_multiframe.fold', birdBase],
  ['06_hypar_concentric_5ring.fold', hypar],
  ['07_generic_degree4_vertex.fold', genericVertex],
  ['08_slanted_pleats_72deg.fold', slantedPleats],
  ['09_miura_ori_57deg.fold', miuraOdd],
  ['10_square_twist_31deg.fold', squareTwistOdd],
  ['11_rabbit_ear_scalene.fold', rabbitEar],
  ['12_triangle_twist_hexagon.fold', triangleTwist],
];
const only = process.argv[2];
let failed = 0;
for (const [file, build] of builders) {
  if (only && !file.startsWith(only)) continue;
  try {
    const fold = build();
    const ex = verify(file, fold);
    write(file, fold);
    const creases = fold.edges_assignment.filter((a) => a === 'M' || a === 'V').length;
    console.log(`ok   ${file}: ${fold.vertices_coords.length} vertices, ${creases} creases, ${fold.faces_vertices!.length} faces, ${ex.layerCount > 1 ? `${ex.layerCount} layers flat` : 'closes up in 3D'} (tear ${ex.tear.toExponential(1)})`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${file}: ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
