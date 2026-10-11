import { EPS, type Vec2 } from './math';

export type Side = -1 | 0 | 1;

/** -1 right of the line, 0 on it, 1 left of it. */
export const sideOf = (distance: number): Side => (distance > EPS ? 1 : distance < -EPS ? -1 : 0);

export interface Piece {
  polygon: Vec2[];
  creaseEdges: boolean[];
}

/**
 * Cut a convex polygon with a line. `dist[i]` is the signed distance of vertex i from the
 * line (positive = left). Call this only when the polygon has vertices strictly on both sides.
 *
 * Because every face starts as a rectangle and is only ever cut by straight lines, faces stay
 * convex forever, which is what makes this simple clipping (and fan triangulation later) safe.
 *
 * `creaseEdges[i]` flags the edge i -> i+1. The new edge created along the cut is flagged true.
 */
export function splitConvexPolygon(
  polygon: readonly Vec2[],
  creaseEdges: readonly boolean[],
  dist: readonly number[],
): { left: Piece; right: Piece } {
  const n = polygon.length;
  const left: Piece = { polygon: [], creaseEdges: [] };
  const right: Piece = { polygon: [], creaseEdges: [] };
  const push = (piece: Piece, p: Vec2, flag: boolean) => {
    piece.polygon.push(p);
    piece.creaseEdges.push(flag);
  };

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = polygon[i];
    const b = polygon[j];
    const sa = sideOf(dist[i]);
    const sb = sideOf(dist[j]);
    const edge = creaseEdges[i];

    if (sa > 0) push(left, a, edge);
    else if (sa < 0) push(right, a, edge);
    else {
      // Vertex exactly on the line belongs to both pieces. If the polygon continues to the
      // other side, the next vertex of this piece is on the cut, so the outgoing edge is the cut.
      push(left, a, sb < 0 ? true : edge);
      push(right, a, sb > 0 ? true : edge);
    }

    if (sa * sb < 0) {
      const t = dist[i] / (dist[i] - dist[j]);
      const x: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (sa > 0) {
        push(left, x, true);
        push(right, x, edge);
      } else {
        push(left, x, edge);
        push(right, x, true);
      }
    }
  }
  return { left, right };
}
