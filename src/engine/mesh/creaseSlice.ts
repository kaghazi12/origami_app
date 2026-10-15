import { TriMesh, EdgeAssignment, FoldFormat } from '../types';
import { edgeKey } from './topology';
import { assertFinite } from '../physics';

export interface BisectorPlane {
  midpoint: [number, number, number];
  normal: [number, number, number];
  distance: number;
}

export interface CutIntersection {
  uv: [number, number];
  pos3d: [number, number, number];
  existingVertex?: number;
}

export interface TriangleSlice {
  triIndex: number;
  p0: CutIntersection;
  p1: CutIntersection;
}

export interface CreasePreviewResult {
  plane: BisectorPlane;
  segments3D: [ [number, number, number], [number, number, number] ][];
  segmentsUV: [ [number, number], [number, number] ][];
  polylinesUV: [number, number][][];
  creaseEdgeKeys: Set<string>;
  flapTriangles: Set<number>;
  flapVertexIndices: Set<number>;
  numFlapTriangles: number;
  assignment: EdgeAssignment;
  targetAngleDeg: number;
}

/**
 * Computes the perpendicular bisector plane between Q0 and Q'.
 * Contains P when the paper is inextensible.
 * Handles degeneracies (too close, far side of P, ill-defined normal).
 */
export function computeBisectorPlane(
  q0: [number, number, number],
  qPrime: [number, number, number],
  pinPos?: [number, number, number] | null
): BisectorPlane | null {
  const dx = qPrime[0] - q0[0];
  const dy = qPrime[1] - q0[1];
  const dz = qPrime[2] - q0[2];
  const dist = Math.hypot(dx, dy, dz);

  // Degeneracy 1: Q' too close to Q0 (< 1 mm)
  if (dist < 0.001 || !Number.isFinite(dist)) {
    return null;
  }

  // Degeneracy 2: Q' on the far side of Pin P
  if (pinPos) {
    const v0x = q0[0] - pinPos[0], v0y = q0[1] - pinPos[1], v0z = q0[2] - pinPos[2];
    const v1x = qPrime[0] - pinPos[0], v1y = qPrime[1] - pinPos[1], v1z = qPrime[2] - pinPos[2];
    const l0 = Math.hypot(v0x, v0y, v0z);
    const l1 = Math.hypot(v1x, v1y, v1z);
    if (l0 > 1e-4 && l1 > 1e-4) {
      const dot = (v0x * v1x + v0y * v1y + v0z * v1z) / (l0 * l1);
      if (dot < -0.999) {
        return null;
      }
    }
  }

  const midpoint: [number, number, number] = [
    (q0[0] + qPrime[0]) * 0.5,
    (q0[1] + qPrime[1]) * 0.5,
    (q0[2] + qPrime[2]) * 0.5,
  ];

  const normal: [number, number, number] = [
    dx / dist,
    dy / dist,
    dz / dist,
  ];

  if (!Number.isFinite(normal[0]) || !Number.isFinite(normal[1]) || !Number.isFinite(normal[2])) {
    return null;
  }

  return { midpoint, normal, distance: dist };
}

/**
 * Slices a TriMesh with a bisector plane in 3D, projecting cuts to UV.
 */
export function sliceMeshWithPlane(
  mesh: TriMesh,
  plane: BisectorPlane,
  options: { snapEps?: number; triangleIndices?: number[] } = {}
): {
  slices: TriangleSlice[];
  segmentsUV: [ [number, number], [number, number] ][];
  segments3D: [ [number, number, number], [number, number, number] ][];
  polylinesUV: [number, number][][];
  creaseEdgeKeys: Set<string>;
} {
  const snapEps = options.snapEps ?? 1e-4;
  const { midpoint: M, normal: n } = plane;

  const numV = mesh.numVertices;
  const signedDists = new Float64Array(numV);
  for (let i = 0; i < numV; i++) {
    const x = mesh.positions[i * 3 + 0] - M[0];
    const y = mesh.positions[i * 3 + 1] - M[1];
    const z = mesh.positions[i * 3 + 2] - M[2];
    signedDists[i] = n[0] * x + n[1] * y + n[2] * z;
  }

  const trianglesToProcess = options.triangleIndices ?? Array.from({ length: mesh.numTriangles }, (_, i) => i);
  const slices: TriangleSlice[] = [];
  const segmentsUV: [ [number, number], [number, number] ][] = [];
  const segments3D: [ [number, number, number], [number, number, number] ][] = [];
  const creaseEdgeKeys = new Set<string>();
  const edgeCutCache = new Map<string, CutIntersection>();

  // Helper to test and compute intersection on edge
  const getEdgeIntersection = (v0: number, v1: number): CutIntersection | null => {
    const k = edgeKey(v0, v1);
    if (edgeCutCache.has(k)) return edgeCutCache.get(k)!;

    const d0 = signedDists[v0];
    const d1 = signedDists[v1];

    // If both endpoints are snapped to plane, entire edge lies on plane
    if (Math.abs(d0) < snapEps && Math.abs(d1) < snapEps) {
      creaseEdgeKeys.add(k);
      return null;
    }

    // Vertex snap on v0
    if (Math.abs(d0) < snapEps) {
      const res: CutIntersection = {
        uv: [mesh.uvs[v0 * 2 + 0], mesh.uvs[v0 * 2 + 1]],
        pos3d: [mesh.positions[v0 * 3 + 0], mesh.positions[v0 * 3 + 1], mesh.positions[v0 * 3 + 2]],
        existingVertex: v0,
      };
      edgeCutCache.set(k, res);
      return res;
    }

    // Vertex snap on v1
    if (Math.abs(d1) < snapEps) {
      const res: CutIntersection = {
        uv: [mesh.uvs[v1 * 2 + 0], mesh.uvs[v1 * 2 + 1]],
        pos3d: [mesh.positions[v1 * 3 + 0], mesh.positions[v1 * 3 + 1], mesh.positions[v1 * 3 + 2]],
        existingVertex: v1,
      };
      edgeCutCache.set(k, res);
      return res;
    }

    // Edge crossing
    if (d0 * d1 < 0) {
      const t = -d0 / (d1 - d0);
      if (t < snapEps) {
        const res: CutIntersection = {
          uv: [mesh.uvs[v0 * 2 + 0], mesh.uvs[v0 * 2 + 1]],
          pos3d: [mesh.positions[v0 * 3 + 0], mesh.positions[v0 * 3 + 1], mesh.positions[v0 * 3 + 2]],
          existingVertex: v0,
        };
        edgeCutCache.set(k, res);
        return res;
      }
      if (t > 1.0 - snapEps) {
        const res: CutIntersection = {
          uv: [mesh.uvs[v1 * 2 + 0], mesh.uvs[v1 * 2 + 1]],
          pos3d: [mesh.positions[v1 * 3 + 0], mesh.positions[v1 * 3 + 1], mesh.positions[v1 * 3 + 2]],
          existingVertex: v1,
        };
        edgeCutCache.set(k, res);
        return res;
      }

      const uv0_x = mesh.uvs[v0 * 2 + 0], uv0_y = mesh.uvs[v0 * 2 + 1];
      const uv1_x = mesh.uvs[v1 * 2 + 0], uv1_y = mesh.uvs[v1 * 2 + 1];
      const p0_x = mesh.positions[v0 * 3 + 0], p0_y = mesh.positions[v0 * 3 + 1], p0_z = mesh.positions[v0 * 3 + 2];
      const p1_x = mesh.positions[v1 * 3 + 0], p1_y = mesh.positions[v1 * 3 + 1], p1_z = mesh.positions[v1 * 3 + 2];

      const res: CutIntersection = {
        uv: [uv0_x + t * (uv1_x - uv0_x), uv0_y + t * (uv1_y - uv0_y)],
        pos3d: [p0_x + t * (p1_x - p0_x), p0_y + t * (p1_y - p0_y), p0_z + t * (p1_z - p0_z)],
      };
      edgeCutCache.set(k, res);
      return res;
    }

    return null;
  };

  for (const tri of trianglesToProcess) {
    const a = mesh.indices[tri * 3 + 0];
    const b = mesh.indices[tri * 3 + 1];
    const c = mesh.indices[tri * 3 + 2];

    const cutAB = getEdgeIntersection(a, b);
    const cutBC = getEdgeIntersection(b, c);
    const cutCA = getEdgeIntersection(c, a);

    const cuts: CutIntersection[] = [];
    if (cutAB) cuts.push(cutAB);
    if (cutBC) {
      if (!cuts.some((pt) => Math.hypot(pt.uv[0] - cutBC.uv[0], pt.uv[1] - cutBC.uv[1]) < 1e-5)) {
        cuts.push(cutBC);
      }
    }
    if (cutCA) {
      if (!cuts.some((pt) => Math.hypot(pt.uv[0] - cutCA.uv[0], pt.uv[1] - cutCA.uv[1]) < 1e-5)) {
        cuts.push(cutCA);
      }
    }

    if (cuts.length === 2) {
      slices.push({ triIndex: tri, p0: cuts[0], p1: cuts[1] });
      segmentsUV.push([cuts[0].uv, cuts[1].uv]);
      segments3D.push([cuts[0].pos3d, cuts[1].pos3d]);
      if (cuts[0].existingVertex !== undefined && cuts[1].existingVertex !== undefined) {
        creaseEdgeKeys.add(edgeKey(cuts[0].existingVertex, cuts[1].existingVertex));
      }
    }
  }

  // Also collect any edges whose both endpoints lie directly on the plane
  for (let tri of trianglesToProcess) {
    const a = mesh.indices[tri * 3 + 0];
    const b = mesh.indices[tri * 3 + 1];
    const c = mesh.indices[tri * 3 + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (Math.abs(signedDists[u]) < snapEps && Math.abs(signedDists[v]) < snapEps) {
        creaseEdgeKeys.add(edgeKey(u, v));
        const uv0: [number, number] = [mesh.uvs[u * 2 + 0], mesh.uvs[u * 2 + 1]];
        const uv1: [number, number] = [mesh.uvs[v * 2 + 0], mesh.uvs[v * 2 + 1]];
        const p0: [number, number, number] = [mesh.positions[u * 3 + 0], mesh.positions[u * 3 + 1], mesh.positions[u * 3 + 2]];
        const p1: [number, number, number] = [mesh.positions[v * 3 + 0], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
        // Avoid duplicate UV segments
        if (!segmentsUV.some((s) => (Math.hypot(s[0][0] - uv0[0], s[0][1] - uv0[1]) < 1e-5 && Math.hypot(s[1][0] - uv1[0], s[1][1] - uv1[1]) < 1e-5) ||
                                     (Math.hypot(s[0][0] - uv1[0], s[0][1] - uv1[1]) < 1e-5 && Math.hypot(s[1][0] - uv0[0], s[1][1] - uv0[1]) < 1e-5))) {
          segmentsUV.push([uv0, uv1]);
          segments3D.push([p0, p1]);
        }
      }
    }
  }

  // Chain segments into polylines
  const polylinesUV = chainSegmentsToPolylines(segmentsUV);

  return { slices, segmentsUV, segments3D, polylinesUV, creaseEdgeKeys };
}

/**
 * Chains a list of unordered 2D segments into ordered polylines.
 */
export function chainSegmentsToPolylines(
  segments: [ [number, number], [number, number] ][],
  eps = 1e-4
): [number, number][][] {
  if (segments.length === 0) return [];

  const remaining = segments.map((s) => ({
    p0: s[0],
    p1: s[1],
    used: false,
  }));

  const ptDist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  const polylines: [number, number][][] = [];

  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].used) continue;

    const currentPolyline: [number, number][] = [remaining[i].p0, remaining[i].p1];
    remaining[i].used = true;

    // Grow polyline forward
    let extended = true;
    while (extended) {
      extended = false;
      const tail = currentPolyline[currentPolyline.length - 1];
      for (let j = 0; j < remaining.length; j++) {
        if (remaining[j].used) continue;
        if (ptDist(tail, remaining[j].p0) < eps) {
          currentPolyline.push(remaining[j].p1);
          remaining[j].used = true;
          extended = true;
          break;
        } else if (ptDist(tail, remaining[j].p1) < eps) {
          currentPolyline.push(remaining[j].p0);
          remaining[j].used = true;
          extended = true;
          break;
        }
      }
    }

    // Grow polyline backward
    extended = true;
    while (extended) {
      extended = false;
      const head = currentPolyline[0];
      for (let j = 0; j < remaining.length; j++) {
        if (remaining[j].used) continue;
        if (ptDist(head, remaining[j].p1) < eps) {
          currentPolyline.unshift(remaining[j].p0);
          remaining[j].used = true;
          extended = true;
          break;
        } else if (ptDist(head, remaining[j].p0) < eps) {
          currentPolyline.unshift(remaining[j].p1);
          remaining[j].used = true;
          extended = true;
          break;
        }
      }
    }

    if (currentPolyline.length >= 2) {
      polylines.push(currentPolyline);
    }
  }

  return polylines;
}

/**
 * Flood-fills the moving flap of triangles starting from Q, stopping at crease edges.
 */
export function floodFillFlap(
  mesh: TriMesh,
  startTriangle: number,
  creaseEdgeKeys: Set<string>
): { flapTriangles: Set<number>; flapVertexIndices: Set<number> } {
  // Build edge-to-triangle adjacency map
  const edgeToTriangles = new Map<string, number[]>();
  for (let t = 0; t < mesh.numTriangles; t++) {
    const i0 = mesh.indices[t * 3 + 0];
    const i1 = mesh.indices[t * 3 + 1];
    const i2 = mesh.indices[t * 3 + 2];
    for (const [u, v] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = edgeKey(u, v);
      let arr = edgeToTriangles.get(k);
      if (!arr) {
        arr = [];
        edgeToTriangles.set(k, arr);
      }
      arr.push(t);
    }
  }

  const flapTriangles = new Set<number>();
  const flapVertexIndices = new Set<number>();

  if (startTriangle < 0 || startTriangle >= mesh.numTriangles) {
    return { flapTriangles, flapVertexIndices };
  }

  const queue = [startTriangle];
  flapTriangles.add(startTriangle);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const i0 = mesh.indices[curr * 3 + 0];
    const i1 = mesh.indices[curr * 3 + 1];
    const i2 = mesh.indices[curr * 3 + 2];
    flapVertexIndices.add(i0);
    flapVertexIndices.add(i1);
    flapVertexIndices.add(i2);

    for (const [u, v] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = edgeKey(u, v);
      if (creaseEdgeKeys.has(k)) {
        continue; // Boundary of crease
      }
      const nbrs = edgeToTriangles.get(k) || [];
      for (const nbr of nbrs) {
        if (!flapTriangles.has(nbr)) {
          flapTriangles.add(nbr);
          queue.push(nbr);
        }
      }
    }
  }

  return { flapTriangles, flapVertexIndices };
}

/**
 * Computes triangle geometric quality (min/max interior angle, shortest/longest edge).
 */
export function computeMeshQuality3D(mesh: TriMesh): {
  minAngleDeg: number;
  maxAngleDeg: number;
  shortestEdge: number;
  longestEdge: number;
} {
  let minAngle = Infinity;
  let maxAngle = -Infinity;
  let shortestEdge = Infinity;
  let longestEdge = -Infinity;

  const radToDeg = 180 / Math.PI;

  for (let t = 0; t < mesh.numTriangles; t++) {
    const i0 = mesh.indices[t * 3 + 0];
    const i1 = mesh.indices[t * 3 + 1];
    const i2 = mesh.indices[t * 3 + 2];

    const x0 = mesh.positions[i0 * 3 + 0], y0 = mesh.positions[i0 * 3 + 1], z0 = mesh.positions[i0 * 3 + 2];
    const x1 = mesh.positions[i1 * 3 + 0], y1 = mesh.positions[i1 * 3 + 1], z1 = mesh.positions[i1 * 3 + 2];
    const x2 = mesh.positions[i2 * 3 + 0], y2 = mesh.positions[i2 * 3 + 1], z2 = mesh.positions[i2 * 3 + 2];

    const d01 = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const d12 = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
    const d20 = Math.hypot(x0 - x2, y0 - y2, z0 - z2);

    shortestEdge = Math.min(shortestEdge, d01, d12, d20);
    longestEdge = Math.max(longestEdge, d01, d12, d20);

    const c0 = Math.max(-1, Math.min(1, (d01 * d01 + d20 * d20 - d12 * d12) / Math.max(1e-12, 2 * d01 * d20)));
    const c1 = Math.max(-1, Math.min(1, (d01 * d01 + d12 * d12 - d20 * d20) / Math.max(1e-12, 2 * d01 * d12)));
    const c2 = Math.max(-1, Math.min(1, (d12 * d12 + d20 * d20 - d01 * d01) / Math.max(1e-12, 2 * d12 * d20)));

    const a0 = Math.acos(c0) * radToDeg;
    const a1 = Math.acos(c1) * radToDeg;
    const a2 = Math.acos(c2) * radToDeg;

    minAngle = Math.min(minAngle, a0, a1, a2);
    maxAngle = Math.max(maxAngle, a0, a1, a2);
  }

  return { minAngleDeg: minAngle, maxAngleDeg: maxAngle, shortestEdge, longestEdge };
}

export const computeMeshQuality = computeMeshQuality3D;

function getTriangleInteriorAngles(mesh: TriMesh, i0: number, i1: number, i2: number): [number, number, number] {
  const x0 = mesh.positions[i0 * 3 + 0], y0 = mesh.positions[i0 * 3 + 1], z0 = mesh.positions[i0 * 3 + 2];
  const x1 = mesh.positions[i1 * 3 + 0], y1 = mesh.positions[i1 * 3 + 1], z1 = mesh.positions[i1 * 3 + 2];
  const x2 = mesh.positions[i2 * 3 + 0], y2 = mesh.positions[i2 * 3 + 1], z2 = mesh.positions[i2 * 3 + 2];

  const d01 = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const d12 = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
  const d20 = Math.hypot(x0 - x2, y0 - y2, z0 - z2);

  const radToDeg = 180 / Math.PI;
  const c0 = Math.max(-1, Math.min(1, (d01 * d01 + d20 * d20 - d12 * d12) / Math.max(1e-12, 2 * d01 * d20)));
  const c1 = Math.max(-1, Math.min(1, (d01 * d01 + d12 * d12 - d20 * d20) / Math.max(1e-12, 2 * d01 * d12)));
  const c2 = Math.max(-1, Math.min(1, (d12 * d12 + d20 * d20 - d01 * d01) / Math.max(1e-12, 2 * d12 * d20)));

  return [Math.acos(c0) * radToDeg, Math.acos(c1) * radToDeg, Math.acos(c2) * radToDeg];
}

/**
 * Quality guard: checks min triangle angle; flips non-crease edges when min angle < threshold.
 * Guarantees XPBD hinge gradients stay finite.
 */
export function cleanupMeshQuality(
  mesh: TriMesh,
  creaseEdgeKeys: Set<string>,
  minAngleThresholdDeg = 10
): TriMesh {
  assertFinite(mesh);

  let q = computeMeshQuality3D(mesh);
  if (q.minAngleDeg >= minAngleThresholdDeg) {
    return mesh;
  }

  // Iterative Delaunay edge flips on non-crease interior edges
  interface EdgeUse {
    tri: number;
    opp: number;
    u: number;
    v: number;
  }

  for (let pass = 0; pass < 5; pass++) {
    const edgeMap = new Map<string, EdgeUse[]>();
    for (let t = 0; t < mesh.numTriangles; t++) {
      const i0 = mesh.indices[t * 3 + 0];
      const i1 = mesh.indices[t * 3 + 1];
      const i2 = mesh.indices[t * 3 + 2];
      for (const [u, v, opp] of [[i0, i1, i2], [i1, i2, i0], [i2, i0, i1]]) {
        const k = edgeKey(u, v);
        let arr = edgeMap.get(k);
        if (!arr) {
          arr = [];
          edgeMap.set(k, arr);
        }
        arr.push({ tri: t, opp, u, v });
      }
    }

    let flippedAny = false;
    for (const [k, uses] of edgeMap.entries()) {
      if (creaseEdgeKeys.has(k)) continue; // Never flip a crease edge!
      if (uses.length !== 2) continue; // Boundary edge

      const u1 = uses[0], u2 = uses[1];
      const a = u1.u, b = u1.v, c = u1.opp, d = u2.opp;

      const oldAngles1 = getTriangleInteriorAngles(mesh, a, b, c);
      const oldAngles2 = getTriangleInteriorAngles(mesh, b, a, d);
      const oldMin = Math.min(...oldAngles1, ...oldAngles2);

      if (oldMin >= minAngleThresholdDeg) continue;

      // Proposed flipped triangles
      const newAngles1 = getTriangleInteriorAngles(mesh, a, d, c);
      const newAngles2 = getTriangleInteriorAngles(mesh, b, c, d);
      const newMin = Math.min(...newAngles1, ...newAngles2);

      if (newMin > oldMin + 0.5) {
        mesh.indices[u1.tri * 3 + 0] = a;
        mesh.indices[u1.tri * 3 + 1] = d;
        mesh.indices[u1.tri * 3 + 2] = c;

        mesh.indices[u2.tri * 3 + 0] = b;
        mesh.indices[u2.tri * 3 + 1] = c;
        mesh.indices[u2.tri * 3 + 2] = d;
        flippedAny = true;
      }
    }

    if (!flippedAny) break;
  }

  assertFinite(mesh);
  return mesh;
}

/**
 * Bakes committed crease lines into the FOLD 1.1 structure.
 */
export function bakeCreasesToFold(
  baseFold: FoldFormat,
  creasePolylines: [number, number][][],
  assignment: EdgeAssignment = 'V',
  foldAngleDeg: number = 177
): FoldFormat {
  const vertices_coords = [...baseFold.vertices_coords.map((v) => [...v] as [number, number])];
  const edges_vertices = [...baseFold.edges_vertices.map((e) => [...e] as [number, number])];
  const edges_assignment = [...baseFold.edges_assignment];
  const edges_foldAngle = baseFold.edges_foldAngle ? [...baseFold.edges_foldAngle] : edges_assignment.map(() => 0);

  const findOrAddVertex = (p: [number, number], eps = 1e-4): number => {
    for (let i = 0; i < vertices_coords.length; i++) {
      const v = vertices_coords[i];
      if (Math.hypot(v[0] - p[0], v[1] - p[1]) < eps) {
        return i;
      }
    }
    const newIdx = vertices_coords.length;
    vertices_coords.push([p[0], p[1]]);
    return newIdx;
  };

  for (const poly of creasePolylines) {
    for (let i = 0; i < poly.length - 1; i++) {
      const v0 = findOrAddVertex(poly[i]);
      const v1 = findOrAddVertex(poly[i + 1]);
      if (v0 === v1) continue;

      // Check if edge already exists
      let existingEdgeIdx = -1;
      for (let e = 0; e < edges_vertices.length; e++) {
        const [a, b] = edges_vertices[e];
        if ((a === v0 && b === v1) || (a === v1 && b === v0)) {
          existingEdgeIdx = e;
          break;
        }
      }

      if (existingEdgeIdx >= 0) {
        edges_assignment[existingEdgeIdx] = assignment;
        edges_foldAngle[existingEdgeIdx] = foldAngleDeg;
      } else {
        edges_vertices.push([v0, v1]);
        edges_assignment.push(assignment);
        edges_foldAngle.push(foldAngleDeg);
      }
    }
  }

  return {
    ...baseFold,
    vertices_coords,
    edges_vertices,
    edges_assignment,
    edges_foldAngle,
  };
}
