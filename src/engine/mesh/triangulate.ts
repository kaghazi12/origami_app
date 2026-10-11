import { FoldFormat, EdgeAssignment } from '../types';

export interface TriangulatedFace {
  /** Array of [v0, v1, v2] triangle indices */
  triangles: [number, number, number][];
  /** Virtual diagonal edges added by triangulation (v0 < v1) */
  virtualEdges: [number, number][];
}

/**
 * Signed area of a 2D polygon (positive when counter-clockwise)
 */
export function polygonArea2D(coords: [number, number][], indices: number[]): number {
  let area = 0;
  const n = indices.length;
  for (let i = 0; i < n; i++) {
    const a = coords[indices[i]];
    const b = coords[indices[(i + 1) % n]];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/**
 * Checks if point P lies inside triangle (A, B, C) in 2D
 */
function pointInTriangle2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = px - ax;
  const v2y = py - ay;

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;

  const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;

  // Strict interior test
  return u > 1e-6 && v > 1e-6 && u + v < 1 - 1e-6;
}

/**
 * Triangulate a simple 2D polygon using Ear Clipping
 */
export function triangulatePolygon(
  coords: [number, number][] | [number, number, number][],
  faceIndices: number[]
): { triangles: [number, number, number][]; diagonals: [number, number][] } {
  const n = faceIndices.length;
  if (n < 3) return { triangles: [], diagonals: [] };
  if (n === 3) {
    return {
      triangles: [[faceIndices[0], faceIndices[1], faceIndices[2]]],
      diagonals: [],
    };
  }

  // Ensure vertices are counter-clockwise
  const flat2D: [number, number][] = faceIndices.map((idx) => [coords[idx][0], coords[idx][1]]);
  let indices = [...faceIndices];
  const area = polygonArea2D(coords as [number, number][], indices);
  if (area < 0) {
    indices.reverse();
  }

  const triangles: [number, number, number][] = [];
  const diagonals: [number, number][] = [];

  let count = indices.length;
  let attempts = 0;
  const maxAttempts = count * count * 2;

  let i = 0;
  while (indices.length > 3 && attempts < maxAttempts) {
    attempts++;
    const prevIdx = (i - 1 + indices.length) % indices.length;
    const currIdx = i;
    const nextIdx = (i + 1) % indices.length;

    const u = indices[prevIdx];
    const v = indices[currIdx];
    const w = indices[nextIdx];

    const ax = coords[u][0];
    const ay = coords[u][1];
    const bx = coords[v][0];
    const by = coords[v][1];
    const cx = coords[w][0];
    const cy = coords[w][1];

    // Check if convex corner
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (cross > 1e-7) {
      // Check if any other vertex lies inside this triangle
      let isEar = true;
      for (let k = 0; k < indices.length; k++) {
        if (k === prevIdx || k === currIdx || k === nextIdx) continue;
        const p = indices[k];
        if (pointInTriangle2D(coords[p][0], coords[p][1], ax, ay, bx, by, cx, cy)) {
          isEar = false;
          break;
        }
      }

      if (isEar) {
        triangles.push([u, v, w]);
        const minEdge = Math.min(u, w);
        const maxEdge = Math.max(u, w);
        diagonals.push([minEdge, maxEdge]);
        indices.splice(currIdx, 1);
        count = indices.length;
        i = prevIdx % count;
        continue;
      }
    }

    i = (i + 1) % indices.length;
  }

  // Final remaining triangle
  if (indices.length === 3) {
    triangles.push([indices[0], indices[1], indices[2]]);
  }

  return { triangles, diagonals };
}
