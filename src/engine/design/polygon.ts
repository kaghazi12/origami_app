import { AREA_EPS, EPS, cross2, sub2, type Vec2 } from './math';

/** Signed area, positive for counter-clockwise polygons. */
export function signedArea(poly: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function centroid(poly: readonly Vec2[]): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-14) {
    let x = 0, y = 0;
    for (const p of poly) { x += p[0]; y += p[1]; }
    return [x / poly.length, y / poly.length];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const c = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function ensureCCW(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? poly.slice().reverse() : poly;
}

/** Remove consecutive duplicate points and points that lie on a straight run. */
export function cleanPolygon(poly: Vec2[]): Vec2[] {
  let pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return Math.abs(p[0] - q[0]) > EPS || Math.abs(p[1] - q[1]) > EPS;
  });
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const ac = sub2(c, a);
      const l = Math.sqrt(ac[0] * ac[0] + ac[1] * ac[1]);
      if (l > EPS && Math.abs(cross2(sub2(b, a), ac)) / l < EPS && (b[0] - a[0]) * ac[0] + (b[1] - a[1]) * ac[1] > 0) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

export const sideOf = (d: number): -1 | 0 | 1 => (d > EPS ? 1 : d < -EPS ? -1 : 0);

/**
 * Cut a convex polygon given the signed distance of each vertex to a line (positive = left).
 * Returns null when the polygon does not have vertices strictly on both sides.
 */
export function splitConvex(poly: readonly Vec2[], dist: readonly number[]): { left: Vec2[]; right: Vec2[] } | null {
  const sides = dist.map(sideOf);
  if (!sides.some((s) => s > 0) || !sides.some((s) => s < 0)) return null;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = poly[i];
    const sa = sides[i];
    const sb = sides[j];
    if (sa > 0) left.push(a);
    else if (sa < 0) right.push(a);
    else { left.push(a); right.push(a); }
    if (sa * sb < 0) {
      const t = dist[i] / (dist[i] - dist[j]);
      const b = poly[j];
      const x: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      left.push(x);
      right.push(x);
    }
  }
  const l = cleanPolygon(left);
  const r = cleanPolygon(right);
  if (l.length < 3 || r.length < 3) return null;
  if (Math.abs(signedArea(l)) < AREA_EPS || Math.abs(signedArea(r)) < AREA_EPS) return null;
  return { left: l, right: r };
}

/** Intersection of two convex counter-clockwise polygons (Sutherland-Hodgman). */
export function clipConvex(subject: readonly Vec2[], clip: readonly Vec2[]): Vec2[] {
  let out: Vec2[] = subject.slice();
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const input = out;
    out = [];
    const side = (p: Vec2) => ex * (p[1] - a[1]) - ey * (p[0] - a[0]);
    for (let k = 0; k < input.length; k++) {
      const p = input[k];
      const q = input[(k + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

export function overlapArea(a: readonly Vec2[], b: readonly Vec2[]): number {
  const c = clipConvex(a, b);
  return c.length < 3 ? 0 : Math.abs(signedArea(c));
}

/** Point strictly inside a convex CCW polygon (at least `eps` from every edge line). */
export function containsStrict(poly: readonly Vec2[], p: Vec2, eps = EPS): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l = Math.sqrt(ex * ex + ey * ey);
    if ((ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / l <= eps) return false;
  }
  return true;
}

/**
 * Part of segment p0-p1 that lies strictly inside a convex CCW polygon, as a parameter
 * range [t0, t1] on the segment, or null.
 */
export function segmentInside(poly: readonly Vec2[], p0: Vec2, p1: Vec2, eps = EPS): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l = Math.sqrt(ex * ex + ey * ey);
    // signed distance (left positive) of p0 + t*d: s0 + t*sd, need > eps
    const s0 = (ex * (p0[1] - a[1]) - ey * (p0[0] - a[0])) / l - eps;
    const sd = (ex * dy - ey * dx) / l;
    if (Math.abs(sd) < 1e-15) {
      if (s0 <= 0) return null;
      continue;
    }
    const t = -s0 / sd;
    if (sd > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return null;
  }
  return [t0, t1];
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export function bboxOf(poly: readonly Vec2[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

export function bboxOverlap(a: BBox, b: BBox, pad = EPS): boolean {
  return a.minX <= b.maxX + pad && b.minX <= a.maxX + pad && a.minY <= b.maxY + pad && b.minY <= a.maxY + pad;
}

/**
 * Candidate pairs (i < j) whose bounding boxes overlap, via a sweep along x.
 */
export function bboxPairs(boxes: readonly BBox[], pad = EPS): [number, number][] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].minX - boxes[b].minX);
  const pairs: [number, number][] = [];
  for (let s = 0; s < order.length; s++) {
    const i = order[s];
    const bi = boxes[i];
    for (let r = s + 1; r < order.length; r++) {
      const j = order[r];
      const bj = boxes[j];
      if (bj.minX > bi.maxX + pad) break;
      if (bboxOverlap(bi, bj, pad)) pairs.push(i < j ? [i, j] : [j, i]);
    }
  }
  return pairs;
}
