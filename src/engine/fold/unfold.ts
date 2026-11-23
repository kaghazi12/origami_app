import { FoldError, FoldFormat, EdgeAssignment } from '../types';

/**
 * FOLD files can describe either the crease pattern (flat sheet, 2D coordinates) or the folded
 * form (3D coordinates of the finished model, e.g. frame_classes ["foldedForm"]). The simulator
 * needs the crease pattern plus a fold angle per crease, so a folded form is unfolded first.
 */

type V3 = [number, number, number];
type V2 = [number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.sqrt(dot(a, a));
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];

/** True when the file gives folded (3D, not flat) coordinates rather than a crease pattern. */
export function isFoldedForm(fold: FoldFormat): boolean {
  const classes = fold.frame_classes ?? [];
  if (classes.includes('creasePattern')) return false;
  const coords = fold.vertices_coords as number[][];
  const has3D = coords.some((v) => v.length > 2 && Math.abs(v[2]) > 1e-9);
  return classes.includes('foldedForm') || has3D;
}

function faceNormal(pts: V3[]): V3 {
  // Newell's method: robust for any planar polygon
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = len(n);
  return l < 1e-15 ? [0, 0, 1] : scale(n, 1 / l);
}

export interface UnfoldResult {
  fold: FoldFormat;
  /** Largest disagreement (paper units) when a vertex is placed from different faces; ~0 for a valid folded form. */
  mismatch: number;
}

/**
 * Unfold a folded form into its crease pattern. Faces are laid out flat one by one across shared
 * edges (an isometric net), so lengths and angles inside every face are preserved. Fold angles
 * come from the dihedral angles of the folded form; the sign follows the file's M/V assignment.
 */
export function unfoldFoldedForm(fold: FoldFormat): UnfoldResult {
  const faces = fold.faces_vertices;
  if (!faces || faces.length === 0) {
    throw new FoldError('This FOLD file gives a folded (3D) form but no faces_vertices, so it cannot be unfolded into a crease pattern.');
  }
  const P = (fold.vertices_coords as number[][]).map((v) => [v[0], v[1], v.length > 2 ? v[2] : 0] as V3);
  const nV = P.length;

  // face adjacency through shared edges (two consecutive vertices)
  const edgeFaces = new Map<string, number[]>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  faces.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const k = key(f[i], f[(i + 1) % f.length]);
      const list = edgeFaces.get(k) ?? [];
      list.push(fi);
      edgeFaces.set(k, list);
    }
  });

  const normals = faces.map((f) => faceNormal(f.map((v) => P[v])));
  const flat: (V2 | null)[] = new Array(nV).fill(null);
  const placedFace = new Uint8Array(faces.length);
  let mismatch = 0;

  const place = (v: number, p: V2) => {
    const q = flat[v];
    if (q) mismatch = Math.max(mismatch, Math.hypot(q[0] - p[0], q[1] - p[1]));
    else flat[v] = p;
  };

  // lay the first face flat in its own plane
  {
    const f = faces[0];
    const o = P[f[0]];
    const ex0 = sub(P[f[1]], o);
    const ex = scale(ex0, 1 / (len(ex0) || 1));
    const ey = cross(normals[0], ex);
    for (const v of f) place(v, [dot(sub(P[v], o), ex), dot(sub(P[v], o), ey)]);
    placedFace[0] = 1;
  }

  const queue = [0];
  while (queue.length) {
    const fi = queue.shift()!;
    const f = faces[fi];
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      for (const gi of edgeFaces.get(key(a, b)) ?? []) {
        if (placedFace[gi]) continue;
        // The neighbour is laid out on the far side of edge a-b in the plane. Map each 3D point
        // of the neighbour by its distance along the edge and away from it.
        const A3 = P[a], B3 = P[b];
        const e3 = sub(B3, A3);
        const eLen = len(e3);
        if (eLen < 1e-12) continue;
        const u3 = scale(e3, 1 / eLen);
        const A2 = flat[a]!, B2 = flat[b]!;
        const e2: V2 = [(B2[0] - A2[0]) / eLen, (B2[1] - A2[1]) / eLen];
        // in-plane normal of the edge pointing away from face fi (its interior lies on the other side)
        const cf = f.reduce<V2>((s, v) => [s[0] + flat[v]![0] / f.length, s[1] + flat[v]![1] / f.length], [0, 0]);
        let n2: V2 = [-e2[1], e2[0]];
        if ((cf[0] - A2[0]) * n2[0] + (cf[1] - A2[1]) * n2[1] > 0) n2 = [-n2[0], -n2[1]];
        // in 3D: direction inside face gi perpendicular to the edge
        const g = faces[gi];
        const inPlane = cross(normals[gi], u3);
        const gc = g.reduce<V3>((s, v) => [s[0] + P[v][0] / g.length, s[1] + P[v][1] / g.length, s[2] + P[v][2] / g.length], [0, 0, 0]);
        const w3 = dot(sub(gc, A3), inPlane) >= 0 ? inPlane : scale(inPlane, -1);
        for (const v of g) {
          const d = sub(P[v], A3);
          const t = dot(d, u3);
          const h = dot(d, w3);
          place(v, [A2[0] + e2[0] * t + n2[0] * h, A2[1] + e2[1] * t + n2[1] * h]);
        }
        placedFace[gi] = 1;
        queue.push(gi);
      }
    }
  }
  if (placedFace.some((p) => !p)) {
    throw new FoldError('The faces of this folded form are not all connected, so it cannot be unfolded into one sheet.');
  }

  // crease pattern coordinates, moved so the sheet starts at the origin
  let minX = Infinity, minY = Infinity;
  for (const p of flat) if (p) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); }
  const coords2: [number, number][] = flat.map((p) => (p ? [p[0] - minX, p[1] - minY] : [0, 0]));

  // make every face counter-clockwise in the crease pattern (front side up)
  const area2 = (f: number[]) => f.reduce((s, v, i) => {
    const a = coords2[v], b = coords2[f[(i + 1) % f.length]];
    return s + a[0] * b[1] - b[0] * a[1];
  }, 0);
  const facesCP = faces.map((f) => (area2(f) < 0 ? f.slice().reverse() : f.slice()));

  // fold angle of each edge from the folded form's dihedral angle; sign from the assignment
  const assignments = fold.edges_assignment;
  const edges_foldAngle = fold.edges_vertices.map(([a, b], e) => {
    const asg = assignments[e] as EdgeAssignment;
    if (asg !== 'M' && asg !== 'V') return 0;
    const fs = edgeFaces.get(key(a, b)) ?? [];
    if (fs.length < 2) return asg === 'V' ? 180 : -180;
    // Angle between the two faces themselves: from the crease, each face extends in some direction
    // perpendicular to it. Flat sheet: opposite directions (180 apart); folded flat: the same (0).
    // The fold angle is 180 minus that, independent of how the file orders face corners.
    const A = P[a], u = sub(P[b], A);
    const uu = scale(u, 1 / (len(u) || 1));
    const away = (fi: number): V3 => {
      const f = faces[fi];
      const c = f.reduce<V3>((s2, v) => [s2[0] + P[v][0] / f.length, s2[1] + P[v][1] / f.length, s2[2] + P[v][2] / f.length], [0, 0, 0]);
      const d = sub(c, A);
      const perp = sub(d, scale(uu, dot(d, uu)));
      return scale(perp, 1 / (len(perp) || 1));
    };
    const between = (Math.acos(Math.max(-1, Math.min(1, dot(away(fs[0]), away(fs[1]))))) * 180) / Math.PI;
    const ang = Math.round((180 - between) * 1e6) / 1e6;
    return asg === 'V' ? ang : -ang;
  });

  const out: FoldFormat = {
    ...fold,
    file_spec: 1.1,
    frame_classes: ['creasePattern'],
    vertices_coords: coords2,
    edges_foldAngle,
    faces_vertices: facesCP,
  };
  return { fold: out, mismatch };
}
